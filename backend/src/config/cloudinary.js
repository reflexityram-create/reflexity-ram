const cloudinary = require('cloudinary').v2;
const crypto = require('crypto');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Multer upload for product images (max 5 images, 10MB each)
const uploadProductImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WebP, and AVIF images are allowed'), false);
    }
  },
});

// Wholesale uses a separate, one-image folder. It never shares a public ID
// namespace with retail product assets.
const uploadWholesaleImageFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WebP, and AVIF images are allowed'), false);
  },
});

const uploadProductImage = (file) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'reflexity-ram/products',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'avif'],
        transformation: [
          { width: 1200, height: 960, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' },
        ],
        public_id: `product-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(file.buffer);
  });

const uploadWholesaleImage = (file) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'reflexity-ram/wholesale',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'avif'],
        transformation: [
          { width: 1600, height: 1200, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' },
        ],
        // Wholesale media participates in a durable Mongo ownership registry.
        // A cryptographic ID plus overwrite:false makes a collision fail closed
        // instead of replacing an asset already owned by another listing.
        public_id: `wholesale-${crypto.randomUUID()}`,
        overwrite: false,
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(file.buffer);
  });

/**
 * Delete a Cloudinary image by public_id
 */
const deleteImage = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (err) {
    console.error('Cloudinary delete error:', err);
    throw err;
  }
};

/**
 * Generate a signed upload URL for direct client-side uploads (optional)
 */
const generateSignedUploadParams = () => {
  const timestamp = Math.round(Date.now() / 1000);
  const params = {
    timestamp,
    folder: 'reflexity-ram/products',
    upload_preset: process.env.CLOUDINARY_UPLOAD_PRESET || undefined,
  };
  const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);
  return {
    signature,
    timestamp,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    folder: params.folder,
  };
};

module.exports = {
  cloudinary,
  uploadProductImages,
  uploadProductImage,
  uploadWholesaleImageFile,
  uploadWholesaleImage,
  deleteImage,
  generateSignedUploadParams,
};
