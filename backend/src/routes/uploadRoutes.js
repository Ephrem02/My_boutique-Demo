const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { uploadProductImage } = require('../controllers/uploadController');

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'products');
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, WEBP or GIF images are allowed'));
    }
    cb(null, true);
  },
});

const router = express.Router();
router.use(authenticate);

router.post('/product-image', requirePermission('products.manage'), (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, uploadProductImage);

module.exports = router;
