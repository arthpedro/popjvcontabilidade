import {
  normalizeDocumentsBySector,
  readCloudState,
  writeCloudState,
} from '../_lib/cloud-store.js'

function parseBody(req) {
  if (!req.body) {
    return null
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return null
    }
  }

  return req.body
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  try {
    if (req.method === 'GET') {
      const state = await readCloudState()
      res.status(200).json({ documentsBySector: state.documentsBySector })
      return
    }

    if (req.method === 'PUT') {
      const body = parseBody(req)

      if (!body || typeof body.documentsBySector !== 'object' || Array.isArray(body.documentsBySector)) {
        res.status(400).json({ message: 'Corpo invalido. Use { documentsBySector: { ... } }.' })
        return
      }

      const state = await readCloudState()

      const nextState = await writeCloudState({
        ...state,
        documentsBySector: normalizeDocumentsBySector(body.documentsBySector),
      })

      res.status(200).json({ documentsBySector: nextState.documentsBySector })
      return
    }

    res.setHeader('Allow', 'GET, PUT')
    res.status(405).json({ message: 'Metodo nao permitido.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao acessar nuvem.'
    res.status(500).json({ message })
  }
}
