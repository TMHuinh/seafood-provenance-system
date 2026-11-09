const { Readable } = require('node:stream')
const { v2: cloudinary } = require('cloudinary')
const env = require('../../config/env')

async function uploadImage(file, folder) {
  if (!env.cloudinaryName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    throw Object.assign(new Error('Chưa cấu hình Cloudinary trên máy chủ'), { status: 503 })
  }

  cloudinary.config({
    cloud_name: env.cloudinaryName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true,
  })

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `seafood-provenance/${folder}`,
        resource_type: 'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      },
      (error, result) => {
        if (error || !result?.secure_url) {
          return reject(Object.assign(new Error('Không thể tải ảnh lên Cloudinary. Vui lòng thử lại'), { status: 502 }))
        }
        resolve(result.secure_url)
      },
    )
    Readable.from(file.buffer).pipe(stream)
  })
}

module.exports = {
  uploadFarmingLogImage: (file) => uploadImage(file, 'farming-logs'),
  uploadTransportDeliveryImage: (file) => uploadImage(file, 'transport-deliveries'),
}
