const { createReadStream } = require('fs');
const { stat } = require('fs/promises');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const env = require('../config/env');

const s3Config = {
  region: env.S3_REGION || 'us-east-1',
  ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT }),
  forcePathStyle: true,
};

// Static keys are optional: when both are absent, the AWS SDK resolves
// credentials from its default chain (IAM role, SSO, environment, etc.).
if (env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
  s3Config.credentials = {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  };
}

const s3 = new S3Client(s3Config);

const BUCKET = env.S3_BUCKET || 'lottrace-attachments';

const generatePresignedUploadUrl = async (key, contentType, expiresIn = 3600) => {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return await getSignedUrl(s3, command, { expiresIn });
};

const generatePresignedDownloadUrl = async (
  key,
  { expiresIn = 3600, filename, contentType } = {},
) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(filename && { ResponseContentDisposition: `attachment; filename="${filename}"` }),
    ...(contentType && { ResponseContentType: contentType }),
  });
  return await getSignedUrl(s3, command, { expiresIn });
};

const headObject = async (key) => {
  const result = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  return {
    contentLength: result.ContentLength,
    contentType: result.ContentType,
  };
};

const uploadBuffer = async (key, buffer, contentType) => {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });
  await s3.send(command);
  return key;
};

const uploadFile = async (key, filePath, contentType) => {
  const { size } = await stat(filePath);
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: createReadStream(filePath),
    ContentLength: size,
    ContentType: contentType,
  });
  await s3.send(command);
  return key;
};

const deleteObject = async (key) => {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  return key;
};

module.exports = {
  s3,
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
  headObject,
  uploadBuffer,
  uploadFile,
  deleteObject,
};
