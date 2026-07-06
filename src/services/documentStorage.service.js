const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { PutObjectCommand, GetObjectCommand, HeadBucketCommand, S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { createLogger } = require('../utils/logger');

const log = createLogger('storage');

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');

function storageDriver() {
  if (process.env.STORAGE_DRIVER === 'local') return 'local';
  if (process.env.STORAGE_DRIVER === 's3') return 's3';
  return process.env.S3_BUCKET ? 's3' : 'local';
}

function useLocalStorage() {
  return storageDriver() === 'local';
}

function isAwsS3() {
  return !resolveS3Endpoint();
}

function resolveS3Endpoint() {
  const endpoint = (process.env.S3_ENDPOINT || '').trim();
  if (!endpoint) return undefined;

  // Real AWS keys + localhost endpoint = misconfiguration; use AWS default endpoint
  const keyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '';
  if (keyId.startsWith('AKIA') && /localhost|127\.0\.0\.1/i.test(endpoint)) {
    log.warn('Ignoring S3_ENDPOINT localhost because AWS access key is configured');
    return undefined;
  }

  return endpoint;
}

function resolveForcePathStyle() {
  if (process.env.S3_FORCE_PATH_STYLE === 'true') return true;
  if (process.env.S3_FORCE_PATH_STYLE === 'false') return false;
  return Boolean(resolveS3Endpoint());
}

function s3Credentials() {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    return { accessKeyId, secretAccessKey };
  }
  return undefined;
}

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    log.info('Created local uploads directory', { path: UPLOADS_DIR });
  }
}

function s3Client() {
  const config = {
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: resolveForcePathStyle()
  };
  const endpoint = resolveS3Endpoint();
  if (endpoint) config.endpoint = endpoint;
  const credentials = s3Credentials();
  if (credentials) config.credentials = credentials;
  return new S3Client(config);
}

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9.-]/g, '_');
}

function buildPublicUrl(key) {
  if (process.env.S3_PUBLIC_BASE_URL?.trim()) {
    const baseUrl = process.env.S3_PUBLIC_BASE_URL.trim().replace(/\/$/, '');
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return `${baseUrl}/${encodedKey}`;
  }
  const region = process.env.S3_REGION || 'us-east-1';
  const bucket = process.env.S3_BUCKET;
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  if (isAwsS3()) {
    return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
  }
  const endpoint = resolveS3Endpoint().replace(/\/$/, '');
  return `${endpoint}/${bucket}/${encodedKey}`;
}

function validateS3Config() {
  if (!process.env.S3_BUCKET) {
    throw new Error(
      'S3 is not configured. Set S3_BUCKET in your .env file, or use STORAGE_DRIVER=local for filesystem storage.'
    );
  }
  if (!s3Credentials() && isAwsS3()) {
    log.debug('No explicit S3 credentials — using AWS default credential provider chain');
  }
}

function extractStorageKey(fileUrl, storageKey) {
  if (storageKey) return storageKey;
  if (!fileUrl) return null;
  if (fileUrl.startsWith('local://')) return fileUrl.slice('local://'.length);

  try {
    const url = new URL(fileUrl);
    let pathKey = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const bucket = process.env.S3_BUCKET;

    // Path-style: /bucket/key or MinIO /bucket/key
    if (bucket && pathKey.startsWith(`${bucket}/`)) {
      pathKey = pathKey.slice(bucket.length + 1);
    }

    // AWS path-style: s3.region.amazonaws.com/bucket/key (already handled above)
    // Virtual-hosted: bucket.s3.region.amazonaws.com/key — path is already the key
    return pathKey || null;
  } catch {
    return null;
  }
}

function localFilePath(storageKey) {
  const resolved = path.resolve(UPLOADS_DIR, storageKey);
  if (!resolved.startsWith(UPLOADS_DIR)) {
    throw new Error('Invalid storage key');
  }
  return resolved;
}

async function uploadLocal(file, folder) {
  ensureUploadsDir();
  const key = `${folder}/${Date.now()}-${safeName(file.originalname)}`;
  const filePath = localFilePath(key);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, file.buffer);
  log.info('File saved locally', { key, size: file.size });
  return {
    fileUrl: `local://${key}`,
    storageProvider: 'local',
    storageKey: key,
    mimeType: file.mimetype,
    size: file.size
  };
}

async function uploadS3(file, folder) {
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
  log.info('File uploaded to S3', { key, bucket: process.env.S3_BUCKET, backend: isAwsS3() ? 'aws' : 'custom', size: file.size });
  return {
    fileUrl: buildPublicUrl(key),
    storageProvider: 's3',
    storageKey: key,
    mimeType: file.mimetype,
    size: file.size
  };
}

exports.uploadDocument = async function uploadDocument(file, folder = 'documents') {
  if (useLocalStorage()) {
    return uploadLocal(file, folder);
  }
  return uploadS3(file, folder);
};

exports.extractStorageKey = extractStorageKey;

exports.getSignedDocumentUrl = async function getSignedDocumentUrl(storageKey, expiresIn = 900) {
  validateS3Config();
  if (!storageKey) {
    throw new Error('Storage key is required to generate a signed URL');
  }
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: storageKey
  });
  return getSignedUrl(s3Client(), command, { expiresIn });
};

async function readLocal(storageKey) {
  ensureUploadsDir();
  const filePath = localFilePath(storageKey);
  if (!fs.existsSync(filePath)) {
    const error = new Error(`Local file not found: ${storageKey}`);
    error.code = 'NotFound';
    throw error;
  }
  const buffer = await fsp.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeByExt = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp'
  };
  return {
    body: buffer,
    contentType: mimeByExt[ext] || 'application/octet-stream',
    contentLength: buffer.length
  };
}

async function readS3(storageKey) {
  validateS3Config();
  const response = await s3Client().send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: storageKey
    })
  );
  return {
    body: response.Body,
    contentType: response.ContentType || 'application/octet-stream',
    contentLength: response.ContentLength
  };
}

function formatStorageError(error) {
  const msg = error.message || '';
  const code = error.name || error.Code || error.code;

  if (code === 'NotFound' || code === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
    return 'Document file not found in S3. The object may have been deleted or the storage key is incorrect.';
  }
  if (code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch' || code === 'InvalidToken') {
    return 'Invalid S3 credentials. Check S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in backend/.env.';
  }
  if (code === 'AccessDenied' || error.$metadata?.httpStatusCode === 403) {
    return 'S3 access denied. Ensure the IAM user has s3:GetObject and s3:PutObject on the bucket.';
  }
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('connect')
  ) {
    if (isAwsS3()) {
      return `Cannot reach AWS S3 (region: ${process.env.S3_REGION}, bucket: ${process.env.S3_BUCKET}). Check network and IAM credentials.`;
    }
    const endpoint = resolveS3Endpoint();
    return `Storage server is not reachable (${endpoint}). Start MinIO or switch to AWS S3 by clearing S3_ENDPOINT in backend/.env.`;
  }
  return msg || 'Unable to retrieve document from storage';
}

exports.readDocument = async function readDocument(storageKey, storageProvider) {
  if (!storageKey) {
    const error = new Error('Document storage key not found');
    error.code = 'NotFound';
    throw error;
  }
  const provider = storageProvider || (useLocalStorage() ? 'local' : 's3');
  try {
    if (provider === 'local') {
      return readLocal(storageKey);
    }
    return await readS3(storageKey);
  } catch (error) {
    if (provider === 's3') {
      try {
        const local = await readLocal(storageKey);
        log.warn('S3 read failed; served from local fallback', { key: storageKey });
        return local;
      } catch {
        // ignore
      }
    }
    const wrapped = new Error(formatStorageError(error));
    wrapped.code = error.code || error.name;
    wrapped.cause = error;
    throw wrapped;
  }
};

exports.checkStorageHealth = async function checkStorageHealth() {
  if (useLocalStorage()) {
    ensureUploadsDir();
    return { driver: 'local', ok: true, path: UPLOADS_DIR };
  }
  validateS3Config();
  try {
    await s3Client().send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
    return {
      driver: 's3',
      ok: true,
      backend: isAwsS3() ? 'aws' : 'custom',
      region: process.env.S3_REGION,
      bucket: process.env.S3_BUCKET,
      endpoint: resolveS3Endpoint() || `https://s3.${process.env.S3_REGION}.amazonaws.com`
    };
  } catch (error) {
    return {
      driver: 's3',
      ok: false,
      backend: isAwsS3() ? 'aws' : 'custom',
      region: process.env.S3_REGION,
      bucket: process.env.S3_BUCKET,
      message: formatStorageError(error)
    };
  }
};

exports.getStorageInfo = function getStorageInfo() {
  return {
    driver: storageDriver(),
    backend: useLocalStorage() ? 'local' : (isAwsS3() ? 'aws' : 'custom'),
    uploadsDir: UPLOADS_DIR
  };
};

if (useLocalStorage()) {
  ensureUploadsDir();
}
