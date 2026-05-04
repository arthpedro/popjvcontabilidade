import { del } from '@vercel/blob'

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
    const url = body && typeof body.url === 'string' ? body.url : ''

    if (!url || url.startsWith('data:')) {
      res.status(200).json({ ok: true })
      return
    }

    await del(url)
    res.status(200).json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao remover arquivo.'
    res.status(500).json({ message })
  }
}
