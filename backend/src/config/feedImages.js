// Google Merchant Center requires images made with generative AI to keep the IPTC DigitalSourceType property
// "trainedAlgorithmicMedia" (https://support.google.com/merchants/answer/14743464). These product pictures are
// AI-generated (their 1254px originals carry an OpenAI C2PA credential) and the Cloudinary copies lost the label,
// so the Google feed points at labeled copies served from frontend/public/feed-images/ instead. They are made by
// Reflexity-RAM-Product-Photos/tools/make_feed_images.py.
//
// Keyed by the Cloudinary asset the product currently shows first, not by SKU: the day a real photo replaces the AI
// picture the key stops matching and the feed uses the real photo, so the labeled copy can never override it.
// Delete the entry (and the file) once its AI picture is gone.
const AI_LABELED_FEED_IMAGES = {
  'product-1787350961905-tqcstyq0i': '/feed-images/rfx-samsung-16gb-ddr4-3200-ecc-rdi.jpg',
  'product-1787350684119-9h9uobzbd': '/feed-images/rfx-lenovo-16gb-ddr4-3200-ecc-rdim.jpg',
  'product-1787350172844-r4hhb2chy': '/feed-images/rfx-sk-hynix-16gb-ddr4-3200-ecc-rd.jpg',
};

const CLOUDINARY_ASSET = /\/(product-\d+-[a-z0-9]+)\.[a-z0-9]+(?:\?.*)?$/i;

const labeledFeedImagePath = (url) => {
  const match = CLOUDINARY_ASSET.exec(String(url || ''));
  return (match && AI_LABELED_FEED_IMAGES[match[1]]) || null;
};

module.exports = { AI_LABELED_FEED_IMAGES, labeledFeedImagePath };
