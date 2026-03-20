import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getEnv } from '@/lib/env'

function getR2Config() {
  const accountId = getEnv('R2_ACCOUNT_ID')
  const accessKeyId = getEnv('R2_ACCESS_KEY_ID')
  const secretAccessKey = getEnv('R2_SECRET_ACCESS_KEY')

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing one or more R2 env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY'
    )
  }

  return { accountId, accessKeyId, secretAccessKey }
}

function createR2Client() {
  const { accountId, accessKeyId, secretAccessKey } = getR2Config()

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  })
}

export const R2_BUCKET = getEnv('R2_BUCKET_NAME') || 'po-checkin-photos'
export const R2_PUBLIC_URL = getEnv('R2_PUBLIC_URL') || ''

export function generateR2Key(poNumber: string): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const timestamp = now.getTime()
  const uuid = crypto.randomUUID().split('-')[0]
  const safePo = poNumber.replace(/[^a-zA-Z0-9-_]/g, '_')
  return `submissions/${year}/${month}/${safePo}/${timestamp}-${uuid}.jpg`
}

export async function uploadToR2(
  key: string,
  body: Buffer,
  contentType: string = 'image/jpeg'
): Promise<string> {
  const r2Client = createR2Client()

  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  )
  return `${R2_PUBLIC_URL}/${key}`
}

export async function deleteFromR2(key: string): Promise<void> {
  const r2Client = createR2Client()

  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    })
  )
}
