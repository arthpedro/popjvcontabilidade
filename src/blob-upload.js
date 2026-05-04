const BLOB_API_URL = 'https://vercel.com/api/blob'
const BLOB_API_VERSION = '12'

async function getClientToken(pathname) {
  const response = await fetch('/api/cloud/blob-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'blob.generate-client-token',
      payload: {
        pathname,
        clientPayload: null,
        multipart: false,
      },
    }),
  })

  if (!response.ok) {
    let message = 'Nao foi possivel gerar permissao de upload.'

    try {
      const payload = await response.json()
      if (payload && typeof payload.message === 'string' && payload.message.trim()) {
        message = payload.message
      }
    } catch {
      // Keep the fallback message.
    }

    throw new Error(message)
  }

  const payload = await response.json()

  if (!payload || typeof payload.clientToken !== 'string' || !payload.clientToken.trim()) {
    throw new Error('Resposta invalida ao solicitar permissao de upload.')
  }

  return payload.clientToken
}

async function parseBlobError(response) {
  try {
    const payload = await response.json()

    if (payload?.error?.message) {
      return payload.error.message
    }

    if (payload?.message) {
      return payload.message
    }
  } catch {
    // Ignore parse failures and use the fallback message.
  }

  if (response.status === 413) {
    return 'Arquivo grande demais para o upload.'
  }

  return 'Nao foi possivel enviar o arquivo para o Blob.'
}

export async function uploadPublicBlob(pathname, file) {
  const clientToken = await getClientToken(pathname)
  const uploadUrl = `${BLOB_API_URL}/?pathname=${encodeURIComponent(pathname)}`
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${clientToken}`,
      'x-api-version': BLOB_API_VERSION,
      'x-vercel-blob-access': 'public',
      'x-content-type': file.type || 'application/octet-stream',
      'x-content-length': String(file.size),
    },
    body: file,
  })

  if (!response.ok) {
    throw new Error(await parseBlobError(response))
  }

  const payload = await response.json()

  if (!payload || typeof payload.url !== 'string' || !payload.url.trim()) {
    throw new Error('Upload concluido sem URL valida retornada pelo Blob.')
  }

  return payload
}
