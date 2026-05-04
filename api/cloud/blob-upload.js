import { handleUpload } from '@vercel/blob/client'

const MAX_DOCUMENT_SIZE_MB = 300
const MAX_DOCUMENT_SIZE_BYTES = MAX_DOCUMENT_SIZE_MB * 1024 * 1024
const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

async function parseBody(req) {
  if (req.body) {
    if (typeof req.body !== 'string') {
      return req.body
    }

    try {
      return JSON.parse(req.body)
    } catch {
      return null
    }
  }

  let rawBody = ''

  for await (const chunk of req) {
    rawBody += chunk
  }

  if (!rawBody) {
    return null
  }

  try {
    return JSON.parse(rawBody)
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ message: 'Metodo nao permitido.' })
    return
  }

  try {
    const body = await parseBody(req)

    if (!body) {
      res.status(400).json({ message: 'Corpo invalido.' })
      return
    }

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        maximumSizeInBytes: MAX_DOCUMENT_SIZE_BYTES,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // Metadata is saved by the client after upload returns successfully.
      },
    })

    res.status(200).json(jsonResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao enviar arquivo.'
    res.status(400).json({ message })
  }
}
