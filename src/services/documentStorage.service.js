const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { createLogger } = require('../utils/logger');

const log = createLogger('storage');

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

function validateS3Config() {
  if (!process.env.S3_BUCKET || !process.env.S3_REGION) {
    throw new Error(
      'S3 is not configured. Set S3_BUCKET and S3_REGION in your .env file. ' +
      'An AWS account (or S3-compatible service like MinIO/Cloudflare R2) is required for file uploads.'
    );
  }
}

exports.uploadDocument = async function uploadDocument(file, folder = 'documents') {
  validateS3Config();

  const key = `${folder}/${Date.now()}-${safeName(file.originalname)}`;

  await s3Client().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype
    })
  );

  const baseUrl = (
    process.env.S3_PUBLIC_BASE_URL ||
    `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION}.amazonaws.com`
  ).replace(/\/$/, '');

  log.info('File uploaded to S3', { key, bucket: process.env.S3_BUCKET, size: file.size });

  return {
    fileUrl: `${baseUrl}/${encodeURIComponent(key)}`,
    storageProvider: 's3',
    storageKey: key,
    mimeType: file.mimetype,
    size: file.size
  };
};
