// POST /api/uploads/product-image - multer has already saved the file to disk
// (see routes/uploadRoutes.js); this just reports back where it landed.
// Returns a fully-qualified URL (not a relative path) since the frontend is
// commonly served from a different origin/port than the API in dev.
function uploadProductImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No image file was provided' });
  const url = `${req.protocol}://${req.get('host')}/uploads/products/${req.file.filename}`;
  res.status(201).json({ url });
}

module.exports = { uploadProductImage };
