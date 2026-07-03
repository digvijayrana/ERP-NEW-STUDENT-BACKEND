const fs = require('fs/promises');
const path = require('path');
const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');

const uploadRoot = path.join(__dirname, '..', '..', 'uploads');

function isS3Enabled() {
  return process.env.STORAGE_DRIVER === 's3' && process.env.S3_BUCKET && process.env.S3_REGION;
}

function s3Client() {
  return new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
          }
        : undefined
  });
}

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9.-]/g, '_');
}

exports.uploadDocument = async function uploadDocument(file, folder = 'documents') {
  const key = `${folder}/${Date.now()}-${safeName(file.originalname)}`;

  if (isS3Enabled()) {
    await s3Client().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype
      })
    );

    const baseUrl = (process.env.S3_PUBLIC_BASE_URL || `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION}.amazonaws.com`).replace(/\/$/, '');
    return {
      fileUrl: `${baseUrl}/${encodeURIComponent(key)}`,
      storageProvider: 's3',
      storageKey: key,
      mimeType: file.mimetype,
      size: file.size
    };
  }

  await fs.mkdir(path.join(uploadRoot, folder), { recursive: true });
  const diskPath = path.join(uploadRoot, key);
  await fs.writeFile(diskPath, file.buffer);
  return {
    fileUrl: `/uploads/${key}`,
    storageProvider: 'local',
    storageKey: key,
    mimeType: file.mimetype,
    size: file.size
  };
};
