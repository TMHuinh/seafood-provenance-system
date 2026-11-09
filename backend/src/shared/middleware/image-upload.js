const multer = require('multer')

module.exports = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(request, file, callback) {
    void request
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return callback(Object.assign(new Error('Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP'), { status: 400 }))
    }
    callback(null, true)
  },
})
