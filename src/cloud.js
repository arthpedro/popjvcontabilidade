function isLocalDevelopment() {
  return (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === ''
  )
}

function getInvalidApiResponseMessage() {
  if (isLocalDevelopment()) {
    return 'A rota /api/* nao esta sendo executada neste servidor local. Use vercel dev para testar a versao final com Serverless Functions.'
  }

  return 'A API retornou uma resposta invalida. Verifique a configuracao das rotas /api/* no deploy.'
}

async function requestJson(path, init = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  })

  const responseText = await response.text()

  const parsePayload = () => {
    try {
      return JSON.parse(responseText)
    } catch {
      throw new Error(getInvalidApiResponseMessage())
    }
  }

  if (!response.ok) {
    let message = 'Falha ao acessar dados em nuvem.'

    try {
      const payload = parsePayload()
      if (payload && typeof payload.message === 'string' && payload.message.trim()) {
        message = payload.message
      }
    } catch (error) {
      message = error instanceof Error ? error.message : message
    }

    if (response.status === 404 && isLocalDevelopment()) {
      message =
        'API em nuvem nao encontrada no servidor local. Use vercel dev para testar /api/* ou publique no Vercel com Upstash Redis configurado.'
    }

    throw new Error(message)
  }

  return parsePayload()
}

export async function getCloudSectors() {
  const payload = await requestJson('/api/cloud/sectors')
  return Array.isArray(payload.sectors) ? payload.sectors : []
}

export async function saveCloudSectors(sectors) {
  const payload = await requestJson('/api/cloud/sectors', {
    method: 'PUT',
    body: JSON.stringify({ sectors }),
  })

  return Array.isArray(payload.sectors) ? payload.sectors : []
}

export async function getCloudStaffUsers() {
  const payload = await requestJson('/api/cloud/staff-users')
  return Array.isArray(payload.staffUsers) ? payload.staffUsers : []
}

export async function saveCloudStaffUsers(staffUsers) {
  const payload = await requestJson('/api/cloud/staff-users', {
    method: 'PUT',
    body: JSON.stringify({ staffUsers }),
  })

  return Array.isArray(payload.staffUsers) ? payload.staffUsers : []
}

export async function getCloudDocumentsBySector() {
  const payload = await requestJson('/api/cloud/documents')
  return payload.documentsBySector && typeof payload.documentsBySector === 'object'
    ? payload.documentsBySector
    : {}
}

export async function saveCloudDocumentsBySector(documentsBySector) {
  const payload = await requestJson('/api/cloud/documents', {
    method: 'PUT',
    body: JSON.stringify({ documentsBySector }),
  })

  return payload.documentsBySector && typeof payload.documentsBySector === 'object'
    ? payload.documentsBySector
    : {}
}

export async function deleteCloudBlob(url) {
  const payload = await requestJson('/api/cloud/blob-delete', {
    method: 'POST',
    body: JSON.stringify({ url }),
  })

  return Boolean(payload.ok)
}
