const crypto = require('crypto');

const CLAIM_LEASE_MS = 5 * 60 * 1000;
const DELETE_LEASE_MS = 5 * 60 * 1000;

function asLean(query) {
  return typeof query?.lean === 'function' ? query.lean() : query;
}

function idsEqual(left, right) {
  return String(left) === String(right);
}

function newOperationId() {
  return crypto.randomUUID();
}

async function findWholesaleReference(WholesaleLotModel, publicId) {
  const query = WholesaleLotModel.findOne({ 'image.publicId': publicId });
  if (typeof query?.select === 'function') query.select('_id');
  return asLean(query);
}

async function getMedia(MediaModel, publicId) {
  return asLean(MediaModel.findOne({ publicId }));
}

async function reconcileWholesaleMedia({ MediaModel, WholesaleLotModel, publicId, now = new Date() }) {
  const media = await getMedia(MediaModel, publicId);
  if (!media) return null;

  // A lot write can commit even when its client receives a transport error.
  // Repair an apparently available registry row before any new claim or delete
  // can win. The partial unique lot index is the database backstop.
  if (media.state === 'available') {
    const reference = await findWholesaleReference(WholesaleLotModel, publicId);
    if (reference) {
      await asLean(MediaModel.findOneAndUpdate(
        { _id: media._id, state: 'available' },
        { $set: { state: 'attached', lotId: reference._id } },
        { new: true },
      ));
      return getMedia(MediaModel, publicId);
    }
  }

  if (media.state === 'claiming') {
    const reference = await findWholesaleReference(WholesaleLotModel, publicId);
    if (reference) {
      await asLean(MediaModel.findOneAndUpdate(
        { _id: media._id, state: 'claiming', claimId: media.claimId },
        { $set: { state: 'attached', lotId: reference._id, claimId: null, claimExpiresAt: null } },
        { new: true },
      ));
      return getMedia(MediaModel, publicId);
    }
    if (media.claimExpiresAt && new Date(media.claimExpiresAt) <= now) {
      await asLean(MediaModel.findOneAndUpdate(
        {
          _id: media._id,
          state: 'claiming',
          claimId: media.claimId,
          claimExpiresAt: { $lte: now },
        },
        { $set: { state: 'available', lotId: null, claimId: null, claimExpiresAt: null } },
        { new: true },
      ));
      return getMedia(MediaModel, publicId);
    }
  }

  // A successful lot write followed by a process interruption can leave a media
  // row attached/claiming. The lot is authoritative for ownership; this repair
  // lets later delete/attach requests recover without an in-process lock.
  if (media.state === 'attached') {
    const reference = await findWholesaleReference(WholesaleLotModel, publicId);
    if (!reference || !idsEqual(reference._id, media.lotId)) {
      const update = reference
        ? { $set: { lotId: reference._id } }
        : { $set: { state: 'available', lotId: null } };
      await asLean(MediaModel.findOneAndUpdate(
        { _id: media._id, state: 'attached', lotId: media.lotId }, update, { new: true },
      ));
      return getMedia(MediaModel, publicId);
    }
  }

  return media;
}

async function claimWholesaleMedia({ MediaModel, WholesaleLotModel, image, lotId, now = new Date() }) {
  await reconcileWholesaleMedia({ MediaModel, WholesaleLotModel, publicId: image.publicId, now });
  const claimId = newOperationId();
  const claimed = await asLean(MediaModel.findOneAndUpdate(
    { publicId: image.publicId, url: image.url, state: 'available' },
    {
      $set: {
        state: 'claiming',
        claimId,
        claimExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
        lotId: null,
      },
    },
    { new: true },
  ));
  return claimed ? { claimId, media: claimed } : null;
}

async function finalizeWholesaleMediaClaim({ MediaModel, publicId, claimId, lotId }) {
  const media = await asLean(MediaModel.findOneAndUpdate(
    { publicId, state: 'claiming', claimId },
    { $set: { state: 'attached', lotId, claimId: null, claimExpiresAt: null } },
    { new: true },
  ));
  return Boolean(media);
}

async function releaseWholesaleMediaClaim({ MediaModel, publicId, claimId }) {
  const media = await asLean(MediaModel.findOneAndUpdate(
    { publicId, state: 'claiming', claimId },
    { $set: { state: 'available', lotId: null, claimId: null, claimExpiresAt: null } },
    { new: true },
  ));
  return Boolean(media);
}

async function releaseAttachedWholesaleMedia({ MediaModel, WholesaleLotModel, publicId, lotId }) {
  // The conditional lot ID prevents a stale editor from releasing media that a
  // newer, successful mutation has already claimed for another lot.
  await reconcileWholesaleMedia({ MediaModel, WholesaleLotModel, publicId });
  const media = await asLean(MediaModel.findOneAndUpdate(
    { publicId, state: 'attached', lotId },
    { $set: { state: 'available', lotId: null } },
    { new: true },
  ));
  return Boolean(media);
}

async function reserveWholesaleMediaDeletion({ MediaModel, WholesaleLotModel, publicId, now = new Date() }) {
  let media = await reconcileWholesaleMedia({ MediaModel, WholesaleLotModel, publicId, now });
  if (!media) return { state: 'missing' };
  if (media.state === 'deleted') return { state: 'deleted' };

  if (media.state === 'deleting') {
    const expired = media.deleteExpiresAt && new Date(media.deleteExpiresAt) <= now;
    if (!expired) return { state: 'busy' };
    const deleteId = newOperationId();
    const retried = await asLean(MediaModel.findOneAndUpdate(
      { _id: media._id, state: 'deleting', deleteId: media.deleteId, deleteExpiresAt: { $lte: now } },
      { $set: { deleteId, deleteExpiresAt: new Date(now.getTime() + DELETE_LEASE_MS) } },
      { new: true },
    ));
    return retried ? { state: 'reserved', deleteId } : { state: 'busy' };
  }

  // Recheck the lot immediately before the compare-and-set. If another request
  // claims the media first, the state predicate below fails and deletion stops.
  const reference = await findWholesaleReference(WholesaleLotModel, publicId);
  if (reference) {
    await asLean(MediaModel.findOneAndUpdate(
      { _id: media._id, state: { $in: ['available', 'attached'] } },
      { $set: { state: 'attached', lotId: reference._id } },
      { new: true },
    ));
    return { state: 'attached' };
  }

  const deleteId = newOperationId();
  const reserved = await asLean(MediaModel.findOneAndUpdate(
    { _id: media._id, state: 'available' },
    { $set: { state: 'deleting', deleteId, deleteExpiresAt: new Date(now.getTime() + DELETE_LEASE_MS) } },
    { new: true },
  ));
  if (reserved) return { state: 'reserved', deleteId };

  media = await getMedia(MediaModel, publicId);
  if (media?.state === 'deleted') return { state: 'deleted' };
  return { state: media?.state === 'attached' ? 'attached' : 'busy' };
}

async function finishWholesaleMediaDeletion({ MediaModel, publicId, deleteId }) {
  const media = await asLean(MediaModel.findOneAndUpdate(
    { publicId, state: 'deleting', deleteId },
    { $set: { state: 'deleted', deleteId: null, deleteExpiresAt: null, deletedAt: new Date() } },
    { new: true },
  ));
  return Boolean(media);
}

module.exports = {
  CLAIM_LEASE_MS,
  DELETE_LEASE_MS,
  claimWholesaleMedia,
  finalizeWholesaleMediaClaim,
  finishWholesaleMediaDeletion,
  reconcileWholesaleMedia,
  releaseAttachedWholesaleMedia,
  releaseWholesaleMediaClaim,
  reserveWholesaleMediaDeletion,
};
