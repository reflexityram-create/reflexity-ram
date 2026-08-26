const crypto = require('crypto');
const RateLimitEntry = require('../models/RateLimitEntry');

const safePrefix = (value) => {
  const prefix = String(value || '').trim();
  if (!/^[a-z0-9_-]{1,32}$/i.test(prefix)) throw new Error('A bounded rate-limit prefix is required');
  return prefix;
};

class MongoRateLimitStore {
  constructor({ prefix, Model = RateLimitEntry, now = Date.now } = {}) {
    this.prefix = `${safePrefix(prefix)}:`;
    this.Model = Model;
    this.now = now;
    this.windowMs = 60_000;
    this.localKeys = false;
  }

  init(options) {
    const windowMs = Number(options?.windowMs);
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) throw new Error('Invalid rate-limit window');
    this.windowMs = windowMs;
  }

  bucketFor(key) {
    const timestamp = this.now();
    const bucket = Math.floor(timestamp / this.windowMs);
    const digest = crypto.createHash('sha256').update(String(key)).digest('hex');
    return {
      id: `${this.prefix}${bucket}:${digest}`,
      resetTime: new Date((bucket + 1) * this.windowMs),
    };
  }

  async increment(key) {
    const { id, resetTime } = this.bucketFor(key);
    const entry = await this.Model.findOneAndUpdate(
      { _id: id },
      {
        $inc: { hits: 1 },
        $setOnInsert: { expiresAt: resetTime },
      },
      {
        upsert: true,
        returnDocument: 'after',
        setDefaultsOnInsert: false,
      },
    );
    return { totalHits: entry.hits, resetTime };
  }

  async decrement(key) {
    const { id } = this.bucketFor(key);
    await this.Model.updateOne({ _id: id, hits: { $gt: 0 } }, { $inc: { hits: -1 } });
  }

  async resetKey(key) {
    const { id } = this.bucketFor(key);
    await this.Model.deleteOne({ _id: id });
  }
}

module.exports = { MongoRateLimitStore, safePrefix };
