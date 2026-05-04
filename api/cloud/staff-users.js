import {
  normalizeStaffUsers,
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
      res.status(200).json({ staffUsers: state.staffUsers })
      return
    }

    if (req.method === 'PUT') {
      const body = parseBody(req)

      if (!body || !Array.isArray(body.staffUsers)) {
        res.status(400).json({ message: 'Corpo invalido. Use { staffUsers: [...] }.' })
        return
      }

      const state = await readCloudState()

      const nextState = await writeCloudState({
        ...state,
        staffUsers: normalizeStaffUsers(body.staffUsers),
      })

      res.status(200).json({ staffUsers: nextState.staffUsers })
      return
    }

    res.setHeader('Allow', 'GET, PUT')
    res.status(405).json({ message: 'Metodo nao permitido.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao acessar nuvem.'
    res.status(500).json({ message })
  }
}
