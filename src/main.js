import {
  deleteCloudBlob,
  getCloudDocumentsBySector,
  getCloudSectors,
  getCloudStaffUsers,
  saveCloudDocumentsBySector,
  saveCloudSectors,
  saveCloudStaffUsers,
} from './cloud.js'
import { uploadPublicBlob } from './blob-upload.js'

const ACCEPTED_DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx']
const MAX_DOCUMENT_SIZE_MB = 300
const MAX_DOCUMENT_SIZE_BYTES = MAX_DOCUMENT_SIZE_MB * 1024 * 1024
const DEFAULT_NOTIFICATION_DURATION_MS = 4200
const LEGACY_CORE_SECTOR_PATHS = new Set(['/', '/documentos', '/clientes', '/configuracoes'])
const LEGACY_CORE_SECTOR_VIEWS = new Set(['dashboard', 'documents', 'clients', 'settings'])
const DEFAULT_STAFF_USERS = [
  {
    id: 'admin',
    username: 'admin',
    password: '123456',
    displayName: 'Administrador',
  },
]

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Elemento #root nao encontrado.')
}

const state = {
  sectors: [],
  workingSectors: [],
  staffUsers: [...DEFAULT_STAFF_USERS],
  documentsBySector: {},
  currentUser: null,
  isSectorsLoading: true,
  isUsersLoading: true,
  isDocumentsLoading: true,
  loadError: null,
  notifications: [],
  notificationTimeouts: new Map(),
  ui: {
    staffModal: {
      open: false,
      username: '',
      password: '',
      error: null,
      isSubmitting: false,
    },
    staffPageLogin: {
      username: '',
      password: '',
      message: null,
    },
    addSectorModal: {
      open: false,
      name: '',
      error: null,
    },
    filesModal: {
      open: false,
      sectorId: null,
      messages: [],
    },
    fileNameModal: {
      open: false,
      displayName: '',
      error: null,
      files: [],
      isSubmitting: false,
    },
    isSavingSectors: false,
    staffUsers: {
      createOpen: false,
      createError: null,
      newDisplayName: '',
      newUsername: '',
      newPassword: '',
      editOpen: false,
      editError: null,
      editingUserId: null,
      editDisplayName: '',
      editUsername: '',
      editPassword: '',
      removeUserId: null,
    },
    viewer: {
      open: false,
      documentId: null,
      docxHtml: null,
      docxError: null,
      isLoading: false,
      requestId: null,
    },
  },
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value) {
  return escapeHtml(value)
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 KB'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  const value = bytes / 1024 ** unitIndex
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function cloneSectors(sectors) {
  return sectors.map((sector) => ({ ...sector }))
}

function isStaffRoute(route) {
  return route.name === 'staff-root' || route.name === 'staff-sectors' || route.name === 'staff-users'
}

function getRoute(pathname = window.location.pathname) {
  if (pathname === '/') {
    return { name: 'home' }
  }

  if (pathname === '/staff') {
    return { name: 'staff-root' }
  }

  if (pathname === '/staff/setores') {
    return { name: 'staff-sectors' }
  }

  if (pathname === '/staff/usuarios') {
    return { name: 'staff-users' }
  }

  const sectorMatch = pathname.match(/^\/setores\/([^/]+)$/)
  if (sectorMatch) {
    return {
      name: 'sector',
      sectorId: decodeURIComponent(sectorMatch[1]),
    }
  }

  return { name: 'not-found' }
}

function getCurrentDateLabel() {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'full',
  }).format(new Date())
}

function getDefaultUserReference() {
  return DEFAULT_STAFF_USERS[0] ?? {
    username: 'admin',
    password: '123456',
  }
}

function isValidStaffUser(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return false
  }

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.username === 'string' &&
    typeof candidate.password === 'string' &&
    typeof candidate.displayName === 'string'
  )
}

function normalizeStaffUsers(users) {
  const validUsers = Array.isArray(users) ? users.filter(isValidStaffUser) : []
  return validUsers.length > 0 ? validUsers : [...DEFAULT_STAFF_USERS]
}

function syncSessionWithUsers(session, users) {
  if (!session) {
    return null
  }

  const matchedUser = users.find((user) => user.id === session.id)

  if (!matchedUser) {
    return null
  }

  return {
    id: matchedUser.id,
    username: matchedUser.username,
    displayName: matchedUser.displayName,
  }
}

function normalizeSector(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return null
  }

  if (
    candidate.isCore === true ||
    (typeof candidate.view === 'string' && LEGACY_CORE_SECTOR_VIEWS.has(candidate.view)) ||
    (typeof candidate.path === 'string' && LEGACY_CORE_SECTOR_PATHS.has(candidate.path))
  ) {
    return null
  }

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.path !== 'string'
  ) {
    return null
  }

  const id = candidate.id.trim()
  const name = candidate.name.trim()
  const path = candidate.path.trim()

  if (!id || !name || !path) {
    return null
  }

  if (path !== `/setores/${id}`) {
    return null
  }

  return { id, name, path }
}

function normalizeSectors(nextSectors) {
  if (!Array.isArray(nextSectors)) {
    return []
  }

  return nextSectors.map(normalizeSector).filter(Boolean)
}

function hasPendingSectorChanges() {
  return JSON.stringify(state.workingSectors) !== JSON.stringify(state.sectors)
}

function getWorkingSectorById(sectorId) {
  return state.workingSectors.find((sector) => sector.id === sectorId) ?? null
}

function getSectorById(sectorId) {
  return state.sectors.find((sector) => sector.id === sectorId) ?? null
}

function getSectorDocuments(sectorId) {
  return state.documentsBySector[sectorId] ?? []
}

function getExtension(fileName) {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

function makeDocumentSignature(file) {
  return `${file.name}-${file.size}-${file.lastModified}`
}

function validateDocument(file) {
  const extension = getExtension(file.name)

  if (!ACCEPTED_DOCUMENT_EXTENSIONS.includes(extension)) {
    return {
      isValid: false,
      extension,
      message: `${file.name}: extensao nao suportada.`,
    }
  }

  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return {
      isValid: false,
      extension,
      message: `${file.name}: tamanho acima de ${MAX_DOCUMENT_SIZE_MB} MB.`,
    }
  }

  return {
    isValid: true,
    extension,
  }
}

function removeExtension(fileName) {
  const lastDot = fileName.lastIndexOf('.')

  if (lastDot <= 0) {
    return fileName
  }

  return fileName.slice(0, lastDot)
}

function buildDisplayFileName(baseName, extension, index, totalFiles) {
  const trimmedBaseName = baseName.trim()
  const normalizedExtension = extension.toLowerCase()
  const extensionSuffix = normalizedExtension ? `.${normalizedExtension}` : ''
  const hasExtension = extensionSuffix
    ? trimmedBaseName.toLowerCase().endsWith(extensionSuffix)
    : false
  const normalizedBaseName = hasExtension
    ? trimmedBaseName.slice(0, -extensionSuffix.length)
    : trimmedBaseName

  if (totalFiles === 1) {
    return hasExtension ? trimmedBaseName : `${trimmedBaseName}${extensionSuffix}`
  }

  return `${normalizedBaseName} (${index + 1})${extensionSuffix}`
}

function buildBlobPath(sectorId, fileName) {
  const normalizedFileName = fileName
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `setores/${sectorId}/${crypto.randomUUID()}-${normalizedFileName || 'documento'}`
}

function getNextCustomSectorId(currentSectors, sectorName) {
  let baseId = slugify(sectorName)

  if (!baseId) {
    baseId = `setor-${Date.now()}`
  }

  let nextId = baseId
  let suffix = 1

  while (
    currentSectors.some((item) => item.id === nextId || item.path === `/setores/${nextId}`)
  ) {
    suffix += 1
    nextId = `${baseId}-${suffix}`
  }

  return nextId
}

function getThumbBadge(documentItem) {
  const extension = (documentItem.extension ?? '').toLowerCase()

  if (extension === 'pdf') {
    return { label: 'PDF', tone: 'pdf' }
  }

  if (extension === 'doc' || extension === 'docx') {
    return { label: 'Word', tone: 'word' }
  }

  if (extension === 'xls' || extension === 'xlsx' || extension === 'csv') {
    return { label: 'Excel', tone: 'excel' }
  }

  if (extension === 'ppt' || extension === 'pptx') {
    return { label: 'PPT', tone: 'powerpoint' }
  }

  if (['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(extension)) {
    return { label: 'IMG', tone: 'image' }
  }

  if (['zip', 'rar', '7z'].includes(extension)) {
    return { label: 'ZIP', tone: 'archive' }
  }

  return {
    label: (extension || 'doc').toUpperCase(),
    tone: 'other',
  }
}

function getSelectedViewerDocument(route) {
  if (route.name !== 'sector' || !state.ui.viewer.documentId) {
    return null
  }

  return (
    getSectorDocuments(route.sectorId).find(
      (documentItem) => documentItem.id === state.ui.viewer.documentId,
    ) ?? null
  )
}

function closeStaffModal({ preserveUsername = true } = {}) {
  state.ui.staffModal.open = false
  state.ui.staffModal.password = ''
  state.ui.staffModal.error = null
  state.ui.staffModal.isSubmitting = false

  if (!preserveUsername) {
    state.ui.staffModal.username = ''
  }
}

function closeAddSectorModal() {
  state.ui.addSectorModal.open = false
  state.ui.addSectorModal.name = ''
  state.ui.addSectorModal.error = null
}

function resetFileNameModal() {
  state.ui.fileNameModal.open = false
  state.ui.fileNameModal.displayName = ''
  state.ui.fileNameModal.error = null
  state.ui.fileNameModal.files = []
  state.ui.fileNameModal.isSubmitting = false
}

function closeFilesModal() {
  state.ui.filesModal.open = false
  state.ui.filesModal.sectorId = null
  state.ui.filesModal.messages = []
  resetFileNameModal()
}

function closeUserModals() {
  state.ui.staffUsers.createOpen = false
  state.ui.staffUsers.createError = null
  state.ui.staffUsers.newDisplayName = ''
  state.ui.staffUsers.newUsername = ''
  state.ui.staffUsers.newPassword = ''
  state.ui.staffUsers.editOpen = false
  state.ui.staffUsers.editError = null
  state.ui.staffUsers.editingUserId = null
  state.ui.staffUsers.editDisplayName = ''
  state.ui.staffUsers.editUsername = ''
  state.ui.staffUsers.editPassword = ''
  state.ui.staffUsers.removeUserId = null
}

function resetViewer() {
  state.ui.viewer.open = false
  state.ui.viewer.documentId = null
  state.ui.viewer.docxHtml = null
  state.ui.viewer.docxError = null
  state.ui.viewer.isLoading = false
  state.ui.viewer.requestId = null
}

function closeRouteScopedUi() {
  closeStaffModal()
  closeAddSectorModal()
  closeFilesModal()
  closeUserModals()
  resetViewer()
}

function addNotification(input) {
  const id = crypto.randomUUID()
  const durationMs = input.durationMs ?? DEFAULT_NOTIFICATION_DURATION_MS
  const notification = {
    id,
    type: input.type,
    message: input.message,
    durationMs,
  }

  state.notifications = [...state.notifications, notification]

  const timeoutId = window.setTimeout(() => {
    dismissNotification(id)
  }, durationMs)

  state.notificationTimeouts.set(id, timeoutId)
  renderApp()
}

function dismissNotification(notificationId) {
  const timeoutId = state.notificationTimeouts.get(notificationId)
  if (timeoutId) {
    window.clearTimeout(timeoutId)
    state.notificationTimeouts.delete(notificationId)
  }

  state.notifications = state.notifications.filter(
    (notification) => notification.id !== notificationId,
  )

  renderApp()
}

async function loadSectors() {
  state.isSectorsLoading = true
  renderApp()

  try {
    const cloudSectors = await getCloudSectors()
    state.sectors = normalizeSectors(cloudSectors)
    state.workingSectors = cloneSectors(state.sectors)
  } catch {
    state.sectors = []
    state.workingSectors = []
  } finally {
    state.isSectorsLoading = false
    renderApp()
  }
}

async function loadStaffUsers() {
  state.isUsersLoading = true
  renderApp()

  try {
    const cloudUsers = await getCloudStaffUsers()
    const normalizedUsers = normalizeStaffUsers(cloudUsers)
    state.staffUsers = normalizedUsers
    state.loadError = null
    state.currentUser = syncSessionWithUsers(state.currentUser, normalizedUsers)
  } catch (error) {
    state.staffUsers = []
    state.currentUser = null
    state.loadError =
      error instanceof Error
        ? error.message
        : 'Nao foi possivel carregar os usuarios da nuvem.'
  } finally {
    state.isUsersLoading = false
    renderApp()
  }
}

async function loadDocuments() {
  state.isDocumentsLoading = true
  renderApp()

  try {
    const cloudDocuments = await getCloudDocumentsBySector()
    state.documentsBySector =
      cloudDocuments && typeof cloudDocuments === 'object' ? cloudDocuments : {}
  } catch {
    state.documentsBySector = {}
  } finally {
    state.isDocumentsLoading = false
    renderApp()
  }
}

async function replaceSectors(nextSectors) {
  const normalizedSectors = normalizeSectors(nextSectors)

  if (normalizedSectors.length !== nextSectors.length) {
    return {
      ok: false,
      message: 'A lista contem setores invalidos.',
    }
  }

  const idSet = new Set()
  const pathSet = new Set()

  for (const sector of normalizedSectors) {
    if (idSet.has(sector.id)) {
      return {
        ok: false,
        message: 'IDs de setor duplicados detectados.',
      }
    }

    if (pathSet.has(sector.path)) {
      return {
        ok: false,
        message: 'Rotas de setor duplicadas detectadas.',
      }
    }

    idSet.add(sector.id)
    pathSet.add(sector.path)
  }

  try {
    const savedSectors = normalizeSectors(await saveCloudSectors(normalizedSectors))
    state.sectors = savedSectors
    state.workingSectors = cloneSectors(savedSectors)

    return {
      ok: true,
      message: 'Alteracoes salvas com sucesso na nuvem.',
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : 'Nao foi possivel salvar alteracoes na nuvem.',
    }
  }
}

async function login(username, password) {
  const normalizedUsername = username.trim()
  const normalizedPassword = password.trim()

  if (!normalizedUsername || !normalizedPassword) {
    return {
      ok: false,
      message: 'Informe usuario e senha.',
    }
  }

  if (state.isUsersLoading) {
    return {
      ok: false,
      message: 'Aguarde. Usuarios ainda estao sendo carregados da nuvem.',
    }
  }

  if (state.loadError) {
    return {
      ok: false,
      message: state.loadError,
    }
  }

  const matchedUser = state.staffUsers.find(
    (user) =>
      user.username.toLowerCase() === normalizedUsername.toLowerCase() &&
      user.password === normalizedPassword,
  )

  if (!matchedUser) {
    return {
      ok: false,
      message: 'Credenciais invalidas.',
    }
  }

  state.currentUser = {
    id: matchedUser.id,
    username: matchedUser.username,
    displayName: matchedUser.displayName,
  }

  return {
    ok: true,
    message: 'Login realizado com sucesso.',
  }
}

async function createUser(input) {
  const normalizedDisplayName = input.displayName.trim()
  const normalizedUsername = input.username.trim().toLowerCase()
  const normalizedPassword = input.password.trim()

  if (!normalizedDisplayName || !normalizedUsername || !normalizedPassword) {
    return {
      ok: false,
      message: 'Informe nome, usuario e senha.',
    }
  }

  if (normalizedUsername.length < 3) {
    return {
      ok: false,
      message: 'O usuario deve ter pelo menos 3 caracteres.',
    }
  }

  if (normalizedPassword.length < 6) {
    return {
      ok: false,
      message: 'A senha deve ter pelo menos 6 caracteres.',
    }
  }

  if (state.staffUsers.some((user) => user.username.toLowerCase() === normalizedUsername)) {
    return {
      ok: false,
      message: 'Ja existe um usuario com este login.',
    }
  }

  let baseId = slugify(normalizedUsername)
  if (!baseId) {
    baseId = `staff-${Date.now()}`
  }

  let nextId = baseId
  let suffix = 1

  while (state.staffUsers.some((user) => user.id === nextId)) {
    suffix += 1
    nextId = `${baseId}-${suffix}`
  }

  const nextUsers = [
    ...state.staffUsers,
    {
      id: nextId,
      username: normalizedUsername,
      password: normalizedPassword,
      displayName: normalizedDisplayName,
    },
  ]

  try {
    const savedUsers = normalizeStaffUsers(await saveCloudStaffUsers(nextUsers))
    state.staffUsers = savedUsers

    return {
      ok: true,
      message: 'Usuario criado com permissao administrativa.',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Nao foi possivel criar o usuario na nuvem.',
    }
  }
}

async function updateUser(input) {
  const normalizedDisplayName = input.displayName.trim()
  const normalizedUsername = input.username.trim().toLowerCase()
  const normalizedPassword = input.password.trim()

  if (!normalizedDisplayName || !normalizedUsername) {
    return {
      ok: false,
      message: 'Informe nome e usuario.',
    }
  }

  if (normalizedUsername.length < 3) {
    return {
      ok: false,
      message: 'O usuario deve ter pelo menos 3 caracteres.',
    }
  }

  if (normalizedPassword && normalizedPassword.length < 6) {
    return {
      ok: false,
      message: 'A senha deve ter pelo menos 6 caracteres.',
    }
  }

  const targetUser = state.staffUsers.find((user) => user.id === input.id)

  if (!targetUser) {
    return {
      ok: false,
      message: 'Usuario nao encontrado.',
    }
  }

  if (
    state.staffUsers.some(
      (user) => user.id !== input.id && user.username.toLowerCase() === normalizedUsername,
    )
  ) {
    return {
      ok: false,
      message: 'Ja existe um usuario com este login.',
    }
  }

  const nextUsers = state.staffUsers.map((user) =>
    user.id === input.id
      ? {
          ...user,
          displayName: normalizedDisplayName,
          username: normalizedUsername,
          password: normalizedPassword || user.password,
        }
      : user,
  )

  try {
    const savedUsers = normalizeStaffUsers(await saveCloudStaffUsers(nextUsers))
    state.staffUsers = savedUsers

    if (state.currentUser?.id === input.id) {
      const updatedCurrentUser = savedUsers.find((user) => user.id === input.id)

      if (updatedCurrentUser) {
        state.currentUser = {
          id: updatedCurrentUser.id,
          username: updatedCurrentUser.username,
          displayName: updatedCurrentUser.displayName,
        }
      }
    }

    return {
      ok: true,
      message: 'Usuario atualizado com sucesso.',
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : 'Nao foi possivel atualizar o usuario na nuvem.',
    }
  }
}

async function removeUser(userId) {
  if (state.staffUsers.length <= 1) {
    return {
      ok: false,
      message: 'Pelo menos um usuario administrador deve permanecer.',
    }
  }

  if (state.currentUser?.id === userId) {
    return {
      ok: false,
      message: 'Nao e possivel remover o usuario atualmente logado.',
    }
  }

  const targetUser = state.staffUsers.find((user) => user.id === userId)

  if (!targetUser) {
    return {
      ok: false,
      message: 'Usuario nao encontrado.',
    }
  }

  const nextUsers = state.staffUsers.filter((user) => user.id !== userId)

  try {
    const savedUsers = normalizeStaffUsers(await saveCloudStaffUsers(nextUsers))
    state.staffUsers = savedUsers

    return {
      ok: true,
      message: 'Usuario removido com sucesso.',
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : 'Nao foi possivel remover o usuario na nuvem.',
    }
  }
}

function appendFileMessages(messages) {
  if (!messages.length) {
    return
  }

  state.ui.filesModal.messages = [...state.ui.filesModal.messages, ...messages]
}

function openFileNameModal(files) {
  if (!files.length) {
    return
  }

  state.ui.fileNameModal.files = files
  state.ui.fileNameModal.displayName = removeExtension(files[0].name)
  state.ui.fileNameModal.error = null
  state.ui.fileNameModal.open = true
}

async function handleSelectedFiles(files) {
  if (!state.ui.filesModal.open || !state.ui.filesModal.sectorId) {
    return
  }

  const validFiles = []
  const messages = []

  for (const file of files) {
    const validation = validateDocument(file)

    if (!validation.isValid) {
      if (validation.message) {
        messages.push(validation.message)
      }
      continue
    }

    validFiles.push(file)
  }

  appendFileMessages(messages)

  if (validFiles.length > 0) {
    openFileNameModal(validFiles)
  }

  renderApp()
}

async function uploadFilesToSector(targetSectorId, files, baseDisplayName) {
  const currentDocuments = getSectorDocuments(targetSectorId)
  const signatures = new Set(currentDocuments.map((item) => item.uniqueSignature))
  const nextDocuments = []
  const uploadedBlobUrls = []
  const nextMessages = []

  for (const [index, file] of files.entries()) {
    const validation = validateDocument(file)

    if (!validation.isValid) {
      if (validation.message) {
        nextMessages.push(validation.message)
      }
      continue
    }

    const uniqueSignature = makeDocumentSignature(file)

    if (signatures.has(uniqueSignature)) {
      nextMessages.push(`${file.name}: este arquivo ja foi carregado neste setor.`)
      continue
    }

    signatures.add(uniqueSignature)

    const displayFileName = buildDisplayFileName(
      baseDisplayName,
      validation.extension ?? '',
      index,
      files.length,
    )

    try {
      const blob = await uploadPublicBlob(buildBlobPath(targetSectorId, displayFileName), file)
      uploadedBlobUrls.push(blob.url)

      nextDocuments.push({
        id: crypto.randomUUID(),
        name: displayFileName,
        size: file.size,
        extension: validation.extension ?? '',
        mimeType: file.type || 'application/octet-stream',
        previewDataUrl: blob.url,
        uploadedAt: new Date().toISOString(),
        status: 'pronto',
        uniqueSignature,
      })
    } catch (error) {
      nextMessages.push(
        error instanceof Error
          ? `${file.name}: ${error.message}`
          : `${file.name}: nao foi possivel enviar para a nuvem.`,
      )
    }
  }

  if (nextMessages.length > 0) {
    appendFileMessages(nextMessages)
  }

  if (nextDocuments.length === 0) {
    return 0
  }

  const nextStore = {
    ...state.documentsBySector,
    [targetSectorId]: [...nextDocuments, ...currentDocuments],
  }

  try {
    state.documentsBySector = await saveCloudDocumentsBySector(nextStore)
  } catch {
    await Promise.allSettled(uploadedBlobUrls.map((url) => deleteCloudBlob(url)))
    appendFileMessages(['Nao foi possivel salvar os arquivos na nuvem. Tente novamente.'])
    return 0
  }

  return nextDocuments.length
}

async function renderDocxPreviewIfNeeded(route) {
  const selectedDocument = getSelectedViewerDocument(route)

  if (!selectedDocument) {
    return
  }

  if ((selectedDocument.extension ?? '').toLowerCase() !== 'docx') {
    return
  }

  if (!selectedDocument.previewDataUrl) {
    state.ui.viewer.docxHtml = null
    state.ui.viewer.docxError = 'Nao foi possivel carregar o arquivo DOCX para visualizacao.'
    state.ui.viewer.isLoading = false
    renderApp()
    return
  }

  const requestId = crypto.randomUUID()
  state.ui.viewer.requestId = requestId
  state.ui.viewer.isLoading = true
  state.ui.viewer.docxHtml = null
  state.ui.viewer.docxError = null
  renderApp()

  try {
    if (!window.mammoth || typeof window.mammoth.convertToHtml !== 'function') {
      throw new Error('Visualizador DOCX indisponivel.')
    }

    const response = await fetch(selectedDocument.previewDataUrl)
    const arrayBuffer = await response.arrayBuffer()
    const result = await window.mammoth.convertToHtml({ arrayBuffer })

    if (
      state.ui.viewer.requestId !== requestId ||
      !state.ui.viewer.open ||
      state.ui.viewer.documentId !== selectedDocument.id
    ) {
      return
    }

    state.ui.viewer.docxHtml = result.value
    state.ui.viewer.docxError = null
  } catch {
    if (
      state.ui.viewer.requestId !== requestId ||
      !state.ui.viewer.open ||
      state.ui.viewer.documentId !== selectedDocument.id
    ) {
      return
    }

    state.ui.viewer.docxHtml = null
    state.ui.viewer.docxError = 'Nao foi possivel renderizar este DOCX no navegador.'
  } finally {
    if (state.ui.viewer.requestId === requestId) {
      state.ui.viewer.isLoading = false
      renderApp()
    }
  }
}

function navigate(path, options = {}) {
  const nextPath = path || '/'
  const shouldReplace = Boolean(options.replace)

  if (window.location.pathname === nextPath && !shouldReplace) {
    renderApp()
    return
  }

  closeRouteScopedUi()

  if (shouldReplace) {
    window.history.replaceState({}, '', nextPath)
  } else {
    window.history.pushState({}, '', nextPath)
  }

  renderApp()
}

function updateDocumentTitle(route) {
  if (route.name === 'sector') {
    const sector = getSectorById(route.sectorId)
    document.title = sector
      ? `${sector.name} | Portal POPS`
      : 'Setor nao encontrado | Portal POPS'
    return
  }

  if (isStaffRoute(route)) {
    document.title = 'Painel administrativo | Portal POPS'
    return
  }

  if (route.name === 'not-found') {
    document.title = 'Pagina nao encontrada | Portal POPS'
    return
  }

  document.title = 'Portal POPS | Escritorio Contabil'
}

function renderPageHeader(title, description = '', actionsHtml = '') {
  return `
    <header class="page-header">
      <div>
        <h2>${escapeHtml(title)}</h2>
        ${description ? `<p class="page-description">${escapeHtml(description)}</p>` : ''}
      </div>
      ${actionsHtml ? `<div class="page-actions">${actionsHtml}</div>` : ''}
    </header>
  `
}

function renderNotifications() {
  if (state.notifications.length === 0) {
    return ''
  }

  return `
    <div class="staff-toast-viewport" aria-live="polite" aria-atomic="false">
      ${state.notifications
        .map(
          (notification) => `
            <article
              class="staff-toast staff-toast-${escapeAttribute(notification.type)}"
              role="status"
              style="--staff-toast-duration: ${notification.durationMs}ms;"
            >
              <p class="staff-toast-message">${escapeHtml(notification.message)}</p>
              <div class="staff-toast-progress"></div>
            </article>
          `,
        )
        .join('')}
    </div>
  `
}

function renderSidebarLinks(route) {
  if (state.sectors.length === 0) {
    return '<p class="sidebar-empty">Nenhum setor criado.</p>'
  }

  return state.sectors
    .map((item) => {
      const isActive = route.name === 'sector' && route.sectorId === item.id

      return `
        <a
          href="${escapeAttribute(item.path)}"
          class="main-nav-link${isActive ? ' is-active' : ''}"
          data-link
        >
          ${escapeHtml(item.name)}
        </a>
      `
    })
    .join('')
}

function renderTopbar() {
  return `
    <header class="topbar">
      <div class="topbar-left">
        <p class="topbar-kicker">Bem-vindo ao POPS</p>
        <p class="topbar-caption">Central de operacoes e documentos por setor</p>
      </div>

      <div class="topbar-right">
        <p class="topbar-date">${escapeHtml(getCurrentDateLabel())}</p>
        <button type="button" class="staff-button" data-action="open-staff-modal">
          Staff
        </button>
      </div>
    </header>
  `
}

function renderContentCard(title, description, extraHtml = '') {
  return `
    <section class="content-card">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      ${extraHtml}
    </section>
  `
}

function renderHomePage() {
  if (state.isSectorsLoading) {
    return renderContentCard(
      'Carregando setores',
      'Sincronizando a lista criada no painel Staff.',
    )
  }

  return renderContentCard(
    'Nenhum setor criado',
    'Crie setores no painel Staff para que eles aparecam na navegacao.',
    `
      <p>
        <a class="inline-link" href="/staff" data-link>Ir para Staff</a>
      </p>
    `,
  )
}

function renderNotFoundPage() {
  return renderContentCard(
    'Pagina nao encontrada',
    'O endereco solicitado nao existe nesta aplicacao.',
    `
      <p>
        <a class="inline-link" href="/" data-link>Voltar ao inicio</a>
      </p>
    `,
  )
}

function renderStaffLoginPanel() {
  const defaultUser = getDefaultUserReference()
  const loginMessage =
    state.ui.staffPageLogin.message ??
    (state.loadError ? { type: 'error', text: state.loadError } : null)

  return `
    <section class="content-card staff-login-card">
      <div class="staff-login-head">
        <h3>Acesso do Staff</h3>
        <p>Entre para editar setores, organizar arquivos e aplicar alteracoes administrativas.</p>
      </div>

      <div class="staff-login-credentials">
        <p class="staff-login-credentials-title">Credenciais de referencia</p>
        <p><strong>Usuario:</strong> ${escapeHtml(defaultUser.username)}</p>
        <p><strong>Senha:</strong> ${escapeHtml(defaultUser.password)}</p>
      </div>

      <form class="staff-form" data-form="staff-panel-login">
        <label class="field">
          <span>Usuario</span>
          <input
            value="${escapeAttribute(state.ui.staffPageLogin.username)}"
            data-model="staff-panel-username"
            autocomplete="username"
            placeholder="Digite o usuario"
          />
        </label>

        <label class="field">
          <span>Senha</span>
          <input
            type="password"
            value="${escapeAttribute(state.ui.staffPageLogin.password)}"
            data-model="staff-panel-password"
            autocomplete="current-password"
            placeholder="Digite a senha"
          />
        </label>

        <button type="submit" class="primary-button">Entrar</button>
      </form>

      ${
        loginMessage
          ? `<p class="staff-feedback ${
              loginMessage.type === 'error' ? 'feedback-error' : 'feedback-success'
            }">${escapeHtml(loginMessage.text)}</p>`
          : ''
      }
    </section>
  `
}

function renderStaffSectionNav(route) {
  const activeSection = route.name === 'staff-users' ? 'users' : 'sectors'

  return `
    <nav class="staff-section-nav" aria-label="Navegacao do staff">
      <a
        href="/staff/setores"
        class="staff-section-link${activeSection === 'sectors' ? ' is-active' : ''}"
        data-link
      >
        Manutencao de setores
      </a>
      <a
        href="/staff/usuarios"
        class="staff-section-link${activeSection === 'users' ? ' is-active' : ''}"
        data-link
      >
        Manutencao de usuarios
      </a>
    </nav>
  `
}

function renderStaffOverview() {
  return `
    <section class="staff-overview">
      <article class="surface-card staff-overview-card">
        <p class="staff-overview-label">Setores ativos</p>
        <p class="staff-overview-value">${state.workingSectors.length}</p>
      </article>
      <article class="surface-card staff-overview-card">
        <p class="staff-overview-label">Status</p>
        <p class="staff-overview-value staff-overview-value-text">
          ${
            state.isSectorsLoading || state.isDocumentsLoading
              ? 'Sincronizando nuvem...'
              : hasPendingSectorChanges()
                ? 'Alteracoes pendentes'
                : 'Tudo sincronizado'
          }
        </p>
      </article>
    </section>
  `
}

function renderStaffSectorsPage() {
  return `
    ${renderStaffOverview()}

    <section class="table-card staff-management-card">
      <div class="staff-management-head">
        <div>
          <h3>Gestao de setores</h3>
        </div>
        <div class="staff-toolbar-main">
          <button type="button" class="primary-button" data-action="open-add-sector-modal">
            Novo setor
          </button>
          <button
            type="button"
            class="ghost-button"
            data-action="discard-sectors"
            ${!hasPendingSectorChanges() || state.ui.isSavingSectors ? 'disabled' : ''}
          >
            Descartar
          </button>
          <button
            type="button"
            class="primary-button"
            data-action="save-sectors"
            ${!hasPendingSectorChanges() || state.ui.isSavingSectors ? 'disabled' : ''}
          >
            ${state.ui.isSavingSectors ? 'Salvando...' : 'Salvar alteracoes'}
          </button>
        </div>
      </div>

      <div class="staff-sectors-list" role="list" aria-label="Lista de setores">
        ${
          state.workingSectors.length === 0
            ? `
              <article class="empty-card" role="listitem">
                <h3>Nenhum setor criado</h3>
                <p>Use Novo setor para criar a primeira area operacional.</p>
              </article>
            `
            : state.workingSectors
                .map(
                  (sector) => `
                    <article class="staff-sector-item" role="listitem">
                      <label class="field staff-sector-field">
                        <span>Nome do setor</span>
                        <input
                          value="${escapeAttribute(sector.name)}"
                          data-model="sector-name"
                          data-sector-id="${escapeAttribute(sector.id)}"
                        />
                      </label>

                      <div class="staff-sector-actions">
                        <button
                          type="button"
                          class="ghost-button"
                          data-action="open-files-modal"
                          data-sector-id="${escapeAttribute(sector.id)}"
                        >
                          Arquivos
                        </button>
                        <button
                          type="button"
                          class="danger-button"
                          data-action="remove-sector"
                          data-sector-id="${escapeAttribute(sector.id)}"
                        >
                          Remover
                        </button>
                      </div>
                    </article>
                  `,
                )
                .join('')
        }
      </div>
    </section>
  `
}

function renderStaffUsersPage() {
  return `
    <section class="table-card staff-users-card">
      <div class="staff-users-head staff-users-head-row">
        <div>
          <h3>Usuarios administrativos</h3>
        </div>
        <button type="button" class="primary-button" data-action="open-create-user-modal">
          Novo usuario
        </button>
      </div>

      <div class="staff-users-list" role="list" aria-label="Usuarios administrativos">
        ${state.staffUsers
          .map(
            (user) => `
              <article class="staff-user-item" role="listitem">
                <p class="staff-user-name">${escapeHtml(user.displayName)}</p>
                <p class="staff-user-username">@${escapeHtml(user.username)}</p>
                <p class="staff-user-role">Permissao: Admin</p>
                <div class="staff-user-actions">
                  <button
                    type="button"
                    class="ghost-button"
                    data-action="open-edit-user-modal"
                    data-user-id="${escapeAttribute(user.id)}"
                  >
                    Editar
                  </button>
                  ${
                    state.currentUser?.id !== user.id
                      ? `
                        <button
                          type="button"
                          class="danger-button"
                          data-action="open-remove-user-modal"
                          data-user-id="${escapeAttribute(user.id)}"
                        >
                          Remover
                        </button>
                      `
                      : ''
                  }
                </div>
              </article>
            `,
          )
          .join('')}
      </div>
    </section>
  `
}

function renderStaffPage(route) {
  if (state.isUsersLoading) {
    return `
      <div class="page-stack">
        ${renderPageHeader(
          'Painel administrativo',
          'Carregando usuarios administrativos na nuvem...',
        )}
      </div>
    `
  }

  if (!state.currentUser) {
    return `
      <div class="page-stack">
        ${renderPageHeader(
          'Painel administrativo',
          'Autenticacao necessaria para gerenciar setores e configuracoes administrativas.',
        )}
        ${renderStaffLoginPanel()}
      </div>
    `
  }

  const activeRoute = route.name === 'staff-users' ? route : { name: 'staff-sectors' }
  const pageHtml =
    activeRoute.name === 'staff-users' ? renderStaffUsersPage() : renderStaffSectorsPage()

  return `
    <div class="page-stack">
      ${renderPageHeader(
        'Painel administrativo',
        '',
        `
          <button type="button" class="ghost-button" data-action="logout">
            Sair (${escapeHtml(state.currentUser.displayName)})
          </button>
        `,
      )}
      ${renderStaffSectionNav(activeRoute)}
      ${pageHtml}
    </div>
  `
}

function renderDocumentThumbnail(documentItem) {
  const badge = getThumbBadge(documentItem)

  return `
    <div class="sector-doc-thumb-label sector-doc-thumb-label-${escapeAttribute(badge.tone)}">
      ${escapeHtml(badge.label)}
    </div>
  `
}

function renderSectorPage(route) {
  if (state.isSectorsLoading || state.isDocumentsLoading) {
    return renderContentCard('Carregando...', 'Sincronizando dados do setor na nuvem.')
  }

  const sector = getSectorById(route.sectorId)

  if (!sector) {
    return renderContentCard(
      'Setor nao encontrado',
      'O setor pode ter sido removido pelo painel Staff.',
      `
        <p>
          <a class="inline-link" href="/staff" data-link>Ir para Staff</a>
        </p>
      `,
    )
  }

  const sectorDocuments = getSectorDocuments(sector.id)

  return `
    <div class="page-stack sector-page-stack">
      ${renderPageHeader(sector.name)}

      ${
        sectorDocuments.length === 0
          ? renderContentCard(
              'Nenhum arquivo neste setor',
              'Va para a pagina Staff, abra o setor e realize upload de PDF ou Word.',
            )
          : `
            <section class="sector-documents-layout">
              <p class="muted-text">
                Clique no arquivo para abrir a visualizacao em tela cheia.
              </p>

              <aside class="sector-documents-list">
                ${sectorDocuments
                  .map((documentItem) => {
                    const isActive = state.ui.viewer.documentId === documentItem.id

                    return `
                      <button
                        type="button"
                        class="sector-doc-item${isActive ? ' is-active' : ''}"
                        data-action="open-viewer"
                        data-document-id="${escapeAttribute(documentItem.id)}"
                      >
                        <div class="sector-doc-thumb">
                          ${renderDocumentThumbnail(documentItem)}
                        </div>
                        <span class="sector-doc-name">${escapeHtml(documentItem.name)}</span>
                      </button>
                    `
                  })
                  .join('')}
              </aside>
            </section>
          `
      }
    </div>
  `
}

function renderRouteContent(route) {
  if (route.name === 'home') {
    return renderHomePage()
  }

  if (route.name === 'sector') {
    return renderSectorPage(route)
  }

  if (isStaffRoute(route)) {
    return renderStaffPage(route)
  }

  return renderNotFoundPage()
}

function renderStaffModal() {
  if (!state.ui.staffModal.open) {
    return ''
  }

  return `
    <div class="modal-backdrop" data-action="close-staff-modal">
      <section
        class="staff-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-modal-title"
      >
        <div class="alert-headline">
          <h3 id="staff-modal-title">Login Staff</h3>
        </div>

        <p class="modal-description">
          Acesse com suas credenciais para gerenciar setores e configuracoes administrativas.
        </p>

        <form class="staff-form" data-form="staff-modal-login">
          <label class="field">
            <span>Usuario</span>
            <input
              value="${escapeAttribute(state.ui.staffModal.username)}"
              data-model="staff-modal-username"
              autocomplete="username"
              placeholder="Digite o usuario"
            />
          </label>

          <label class="field">
            <span>Senha</span>
            <input
              type="password"
              value="${escapeAttribute(state.ui.staffModal.password)}"
              data-model="staff-modal-password"
              autocomplete="current-password"
              placeholder="Digite a senha"
            />
          </label>

          ${
            state.ui.staffModal.error
              ? `<p class="feedback-error">${escapeHtml(state.ui.staffModal.error)}</p>`
              : ''
          }

          <div class="modal-actions">
            <button type="button" class="ghost-button" data-action="close-staff-modal">
              Cancelar
            </button>
            <button
              type="submit"
              class="primary-button"
              ${state.ui.staffModal.isSubmitting ? 'disabled' : ''}
            >
              ${state.ui.staffModal.isSubmitting ? 'Entrando...' : 'Entrar'}
            </button>
          </div>
        </form>
      </section>
    </div>
  `
}

function renderAddSectorModal() {
  if (!state.ui.addSectorModal.open) {
    return ''
  }

  return `
    <div class="modal-backdrop" data-action="close-add-sector-modal">
      <section
        class="staff-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-sector-modal-title"
      >
        <div class="alert-headline">
          <h3 id="add-sector-modal-title">Novo setor</h3>
        </div>

        <p class="modal-description">
          Informe o nome do setor. A mudanca vai para rascunho e so sera aplicada ao clicar em
          Salvar alteracoes.
        </p>

        <form class="staff-form" data-form="add-sector">
          <label class="field">
            <span>Nome do setor</span>
            <input
              value="${escapeAttribute(state.ui.addSectorModal.name)}"
              data-model="add-sector-name"
              placeholder="Digite o nome do setor"
              autofocus
            />
          </label>

          ${
            state.ui.addSectorModal.error
              ? `<p class="feedback-error">${escapeHtml(state.ui.addSectorModal.error)}</p>`
              : ''
          }

          <div class="modal-actions">
            <button type="button" class="ghost-button" data-action="close-add-sector-modal">
              Cancelar
            </button>
            <button type="submit" class="primary-button">Criar setor</button>
          </div>
        </form>
      </section>
    </div>
  `
}

function renderUploadedDocumentsList(documents) {
  if (documents.length === 0) {
    return `
      <article class="empty-card">
        <h3>Nenhum documento carregado</h3>
        <p>
          Assim que voce enviar um arquivo, ele sera listado aqui com tamanho,
          extensao e horario de entrada.
        </p>
      </article>
    `
  }

  return `
    <section class="table-card" aria-label="Lista de documentos carregados">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Arquivo</th>
              <th>Tipo</th>
              <th>Tamanho</th>
              <th>Acao</th>
            </tr>
          </thead>
          <tbody>
            ${documents
              .map(
                (documentItem) => `
                  <tr>
                    <td>${escapeHtml(documentItem.name)}</td>
                    <td>${escapeHtml((documentItem.extension ?? '').toUpperCase())}</td>
                    <td>${escapeHtml(formatFileSize(documentItem.size))}</td>
                    <td>
                      <button
                        type="button"
                        class="link-button"
                        data-action="remove-document"
                        data-document-id="${escapeAttribute(documentItem.id)}"
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>
  `
}

function renderFilesModal() {
  if (!state.ui.filesModal.open || !state.ui.filesModal.sectorId) {
    return ''
  }

  const activeSector = getWorkingSectorById(state.ui.filesModal.sectorId)

  if (!activeSector) {
    return ''
  }

  const activeDocuments = getSectorDocuments(activeSector.id)

  return `
    <div class="modal-backdrop" data-action="close-files-modal">
      <section
        class="staff-modal staff-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="files-modal-title"
      >
        <div class="alert-headline">
          <h3 id="files-modal-title">Arquivos do setor: ${escapeHtml(activeSector.name)}</h3>
          <button type="button" class="link-button" data-action="close-files-modal">
            Fechar
          </button>
        </div>

        <section class="add-file-area" data-file-dropzone>
          <input
            id="sector-upload-input"
            type="file"
            multiple
            accept=".pdf,.doc,.docx"
            hidden
            data-file-input="sector"
          />
          <p class="add-file-hint">Arraste arquivos ou clique em adicionar.</p>
          <button type="button" class="add-file-button" data-action="open-file-picker">
            Adicionar
          </button>
        </section>

        ${
          state.ui.filesModal.messages.length > 0
            ? `
              <article class="alert-card" role="alert">
                <div class="alert-headline">
                  <h3>Validacao</h3>
                  <button type="button" class="link-button" data-action="clear-file-messages">
                    Limpar alertas
                  </button>
                </div>
                <ul class="list">
                  ${state.ui.filesModal.messages
                    .map((message, index) => `<li data-message-index="${index}">${escapeHtml(message)}</li>`)
                    .join('')}
                </ul>
              </article>
            `
            : ''
        }

        ${renderUploadedDocumentsList(activeDocuments)}
      </section>
    </div>
  `
}

function renderFileNameModal() {
  if (!state.ui.fileNameModal.open) {
    return ''
  }

  return `
    <div class="modal-backdrop" data-action="close-file-name-modal">
      <section
        class="staff-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-name-modal-title"
      >
        <div class="alert-headline">
          <h3 id="file-name-modal-title">Nome do arquivo</h3>
        </div>

        <form class="staff-form" data-form="save-file-name">
          <label class="field">
            <span>Nome</span>
            <input
              value="${escapeAttribute(state.ui.fileNameModal.displayName)}"
              data-model="file-display-name"
              placeholder="Ex.: Balancete Marco 2026"
              autofocus
            />
          </label>

          ${
            state.ui.fileNameModal.error
              ? `<p class="feedback-error">${escapeHtml(state.ui.fileNameModal.error)}</p>`
              : ''
          }

          <div class="modal-actions">
            <button type="button" class="ghost-button" data-action="close-file-name-modal">
              Cancelar
            </button>
            <button
              type="submit"
              class="primary-button"
              ${state.ui.fileNameModal.isSubmitting ? 'disabled' : ''}
            >
              ${state.ui.fileNameModal.isSubmitting ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </section>
    </div>
  `
}

function renderCreateUserModal() {
  if (!state.ui.staffUsers.createOpen) {
    return ''
  }

  return `
    <div class="modal-backdrop" data-action="close-create-user-modal">
      <section
        class="staff-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-user-modal-title"
      >
        <div class="alert-headline">
          <h3 id="create-user-modal-title">Novo usuario administrativo</h3>
        </div>

        <p class="modal-description">
          O usuario criado tera as mesmas permissoes administrativas do perfil principal.
        </p>

        <form class="staff-form" data-form="create-user">
          <label class="field">
            <span>Nome de exibicao</span>
            <input
              value="${escapeAttribute(state.ui.staffUsers.newDisplayName)}"
              data-model="create-user-display-name"
              placeholder="Ex.: Maria Oliveira"
              autofocus
            />
          </label>

          <label class="field">
            <span>Usuario</span>
            <input
              value="${escapeAttribute(state.ui.staffUsers.newUsername)}"
              data-model="create-user-username"
              placeholder="Ex.: maria.oliveira"
              autocomplete="off"
            />
          </label>

          <label class="field">
            <span>Senha</span>
            <input
              type="password"
              value="${escapeAttribute(state.ui.staffUsers.newPassword)}"
              data-model="create-user-password"
              placeholder="Minimo de 6 caracteres"
              autocomplete="new-password"
            />
          </label>

          ${
            state.ui.staffUsers.createError
              ? `<p class="feedback-error">${escapeHtml(state.ui.staffUsers.createError)}</p>`
              : ''
          }

          <div class="modal-actions">
            <button type="button" class="ghost-button" data-action="close-create-user-modal">
              Cancelar
            </button>
            <button type="submit" class="primary-button">Criar usuario</button>
          </div>
        </form>
      </section>
    </div>
  `
}

function renderEditUserModal() {
  if (!state.ui.staffUsers.editOpen || !state.ui.staffUsers.editingUserId) {
    return ''
  }

  return `
    <div class="modal-backdrop" data-action="close-edit-user-modal">
      <section
        class="staff-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-user-modal-title"
      >
        <div class="alert-headline">
          <h3 id="edit-user-modal-title">Editar usuario</h3>
        </div>

        <form class="staff-form" data-form="edit-user">
          <label class="field">
            <span>Nome de exibicao</span>
            <input
              value="${escapeAttribute(state.ui.staffUsers.editDisplayName)}"
              data-model="edit-user-display-name"
              placeholder="Ex.: Maria Oliveira"
              autofocus
            />
          </label>

          <label class="field">
            <span>Usuario</span>
            <input
              value="${escapeAttribute(state.ui.staffUsers.editUsername)}"
              data-model="edit-user-username"
              placeholder="Ex.: maria.oliveira"
              autocomplete="off"
            />
          </label>

          <label class="field">
            <span>Nova senha (opcional)</span>
            <input
              type="password"
              value="${escapeAttribute(state.ui.staffUsers.editPassword)}"
              data-model="edit-user-password"
              placeholder="Somente se desejar alterar"
              autocomplete="new-password"
            />
          </label>

          ${
            state.ui.staffUsers.editError
              ? `<p class="feedback-error">${escapeHtml(state.ui.staffUsers.editError)}</p>`
              : ''
          }

          <div class="modal-actions">
            <button type="button" class="ghost-button" data-action="close-edit-user-modal">
              Cancelar
            </button>
            <button type="submit" class="primary-button">Salvar alteracoes</button>
          </div>
        </form>
      </section>
    </div>
  `
}

function renderRemoveUserModal() {
  if (!state.ui.staffUsers.removeUserId) {
    return ''
  }

  const targetUser =
    state.staffUsers.find((user) => user.id === state.ui.staffUsers.removeUserId) ?? null

  if (!targetUser) {
    return ''
  }

  return `
    <div class="modal-backdrop" data-action="close-remove-user-modal">
      <section
        class="staff-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-user-modal-title"
      >
        <div class="alert-headline">
          <h3 id="remove-user-modal-title">Confirmar exclusao</h3>
        </div>

        <p class="modal-description">
          Deseja remover o usuario <strong>${escapeHtml(targetUser.displayName)}</strong>?
        </p>

        <div class="modal-actions">
          <button type="button" class="ghost-button" data-action="close-remove-user-modal">
            Cancelar
          </button>
          <button type="button" class="danger-button" data-action="confirm-remove-user">
            Remover usuario
          </button>
        </div>
      </section>
    </div>
  `
}

function renderViewerContent(selectedDocument) {
  if (!selectedDocument) {
    return '<p>Selecione um arquivo para visualizar.</p>'
  }

  const selectedExtension = (selectedDocument.extension ?? '').toLowerCase()
  const canPreviewPdf = selectedExtension === 'pdf' && Boolean(selectedDocument.previewDataUrl)

  if (canPreviewPdf) {
    return `
      <iframe
        src="${escapeAttribute(selectedDocument.previewDataUrl)}"
        class="sector-viewer-frame"
        title="Visualizacao ${escapeAttribute(selectedDocument.name)}"
      ></iframe>
    `
  }

  if (selectedExtension === 'docx') {
    if (state.ui.viewer.isLoading) {
      return '<p>Carregando visualizacao do DOCX...</p>'
    }

    if (state.ui.viewer.docxError) {
      return `<p>${escapeHtml(state.ui.viewer.docxError)}</p>`
    }

    if (state.ui.viewer.docxHtml) {
      return `<article class="sector-viewer-docx">${state.ui.viewer.docxHtml}</article>`
    }
  }

  return '<p>Este formato ainda nao possui renderizacao inline. Use o botao Baixar.</p>'
}

function renderDocumentViewerModal(route) {
  if (route.name !== 'sector' || !state.ui.viewer.open) {
    return ''
  }

  const selectedDocument = getSelectedViewerDocument(route)

  if (!selectedDocument) {
    return ''
  }

  return `
    <div class="modal-backdrop" data-action="close-viewer">
      <section
        class="sector-viewer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sector-viewer-title"
      >
        <header class="sector-viewer-header">
          <h3 id="sector-viewer-title">${escapeHtml(selectedDocument.name)}</h3>
          <div class="sector-viewer-actions">
            ${
              selectedDocument.previewDataUrl
                ? `
                  <a
                    class="inline-link"
                    href="${escapeAttribute(selectedDocument.previewDataUrl)}"
                    download="${escapeAttribute(selectedDocument.name)}"
                  >
                    Baixar
                  </a>
                `
                : ''
            }
            <button type="button" class="link-button" data-action="close-viewer">
              Fechar
            </button>
          </div>
        </header>

        ${renderViewerContent(selectedDocument)}
      </section>
    </div>
  `
}

function renderApp() {
  const route = getRoute()

  if (route.name === 'home' && !state.isSectorsLoading && state.sectors.length > 0) {
    navigate(state.sectors[0].path, { replace: true })
    return
  }

  updateDocumentTitle(route)

  rootElement.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand-card">
          <div class="brand-logo-wrapper">
            <a href="/" class="brand-logo-link" aria-label="Ir para pagina inicial" data-link>
              <img src="/public/logo.jpg" alt="Logo do escritorio" class="brand-logo" />
            </a>
          </div>
          <p class="brand-description">
            <strong>Setores</strong>
          </p>
        </div>

        <nav class="main-nav" aria-label="Navegacao principal">
          ${renderSidebarLinks(route)}
        </nav>

        <div class="compliance-note">
          <p class="note-title">Equipe de T.I.</p>
          <p>
            Desenvolvido pelo setor de T.I. da JV Contabilidade em 2026.
            Solucao interna para apoiar as rotinas operacionais do escritorio.
          </p>
        </div>
      </aside>

      <section class="content-shell">
        ${renderTopbar()}

        <main class="page-content">
          <div class="page-content-body">
            ${renderRouteContent(route)}
          </div>
        </main>
      </section>
    </div>

    ${renderStaffModal()}
    ${renderAddSectorModal()}
    ${renderFilesModal()}
    ${renderFileNameModal()}
    ${renderCreateUserModal()}
    ${renderEditUserModal()}
    ${renderRemoveUserModal()}
    ${renderDocumentViewerModal(route)}
    ${renderNotifications()}
  `
}

function shouldHandleInternalNavigation(link) {
  if (!link) {
    return false
  }

  if (link.hasAttribute('download') || link.target === '_blank') {
    return false
  }

  const href = link.getAttribute('href') ?? ''

  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return false
  }

  const url = new URL(link.href, window.location.origin)
  return url.origin === window.location.origin
}

async function handleDocumentClick(event) {
  const link = event.target.closest('a[href]')
  if (link && shouldHandleInternalNavigation(link)) {
    const url = new URL(link.href, window.location.origin)
    event.preventDefault()
    navigate(`${url.pathname}${url.search}`)
    return true
  }

  let actionTarget = event.target.closest('[data-action]')
  if (
    actionTarget &&
    actionTarget.classList.contains('modal-backdrop') &&
    event.target !== actionTarget
  ) {
    actionTarget = null
  }

  if (!actionTarget) {
    return false
  }

  const action = actionTarget.dataset.action

  switch (action) {
    case 'open-staff-modal': {
      if (state.currentUser) {
        navigate('/staff/setores')
      } else {
        state.ui.staffModal.open = true
        state.ui.staffModal.error = null
        renderApp()
      }
      return true
    }
    case 'close-staff-modal':
      closeStaffModal()
      renderApp()
      return true
    case 'logout':
      state.currentUser = null
      if (isStaffRoute(getRoute())) {
        navigate('/staff')
      } else {
        renderApp()
      }
      return true
    case 'open-add-sector-modal':
      state.ui.addSectorModal.open = true
      state.ui.addSectorModal.error = null
      renderApp()
      return true
    case 'close-add-sector-modal':
      closeAddSectorModal()
      renderApp()
      return true
    case 'discard-sectors':
      state.workingSectors = cloneSectors(state.sectors)
      addNotification({
        type: 'success',
        message: 'Alteracoes locais descartadas.',
      })
      return true
    case 'save-sectors':
      void handleSaveSectors()
      return true
    case 'remove-sector': {
      const { sectorId } = actionTarget.dataset
      if (!sectorId) {
        return true
      }

      state.workingSectors = state.workingSectors.filter((sector) => sector.id !== sectorId)
      addNotification({
        type: 'success',
        message: 'Setor removido do rascunho. Clique em Salvar alteracoes para confirmar.',
      })
      return true
    }
    case 'open-files-modal': {
      const { sectorId } = actionTarget.dataset
      if (!sectorId) {
        return true
      }

      state.ui.filesModal.open = true
      state.ui.filesModal.sectorId = sectorId
      state.ui.filesModal.messages = []
      resetFileNameModal()
      renderApp()
      return true
    }
    case 'close-files-modal':
      closeFilesModal()
      renderApp()
      return true
    case 'clear-file-messages':
      state.ui.filesModal.messages = []
      renderApp()
      return true
    case 'open-file-picker':
      document.getElementById('sector-upload-input')?.click()
      return true
    case 'close-file-name-modal':
      resetFileNameModal()
      renderApp()
      return true
    case 'remove-document': {
      const { documentId } = actionTarget.dataset
      if (documentId) {
        void handleRemoveDocument(documentId)
      }
      return true
    }
    case 'open-create-user-modal':
      state.ui.staffUsers.createOpen = true
      state.ui.staffUsers.createError = null
      renderApp()
      return true
    case 'close-create-user-modal':
      state.ui.staffUsers.createOpen = false
      state.ui.staffUsers.createError = null
      state.ui.staffUsers.newDisplayName = ''
      state.ui.staffUsers.newUsername = ''
      state.ui.staffUsers.newPassword = ''
      renderApp()
      return true
    case 'open-edit-user-modal': {
      const { userId } = actionTarget.dataset
      const targetUser = state.staffUsers.find((user) => user.id === userId)
      if (!targetUser) {
        return true
      }

      state.ui.staffUsers.editOpen = true
      state.ui.staffUsers.editError = null
      state.ui.staffUsers.editingUserId = targetUser.id
      state.ui.staffUsers.editDisplayName = targetUser.displayName
      state.ui.staffUsers.editUsername = targetUser.username
      state.ui.staffUsers.editPassword = ''
      renderApp()
      return true
    }
    case 'close-edit-user-modal':
      state.ui.staffUsers.editOpen = false
      state.ui.staffUsers.editError = null
      state.ui.staffUsers.editingUserId = null
      state.ui.staffUsers.editDisplayName = ''
      state.ui.staffUsers.editUsername = ''
      state.ui.staffUsers.editPassword = ''
      renderApp()
      return true
    case 'open-remove-user-modal': {
      const { userId } = actionTarget.dataset
      if (userId) {
        state.ui.staffUsers.removeUserId = userId
        renderApp()
      }
      return true
    }
    case 'close-remove-user-modal':
      state.ui.staffUsers.removeUserId = null
      renderApp()
      return true
    case 'confirm-remove-user':
      void handleConfirmRemoveUser()
      return true
    case 'open-viewer': {
      const { documentId } = actionTarget.dataset
      if (documentId) {
        void handleOpenViewer(documentId)
      }
      return true
    }
    case 'close-viewer':
      resetViewer()
      renderApp()
      return true
    default:
      return false
  }
}

function clearInputError(model) {
  switch (model) {
    case 'staff-modal-username':
    case 'staff-modal-password':
      if (state.ui.staffModal.error) {
        state.ui.staffModal.error = null
        return true
      }
      return false
    case 'add-sector-name':
      if (state.ui.addSectorModal.error) {
        state.ui.addSectorModal.error = null
        return true
      }
      return false
    case 'file-display-name':
      if (state.ui.fileNameModal.error) {
        state.ui.fileNameModal.error = null
        return true
      }
      return false
    case 'create-user-display-name':
    case 'create-user-username':
    case 'create-user-password':
      if (state.ui.staffUsers.createError) {
        state.ui.staffUsers.createError = null
        return true
      }
      return false
    case 'edit-user-display-name':
    case 'edit-user-username':
    case 'edit-user-password':
      if (state.ui.staffUsers.editError) {
        state.ui.staffUsers.editError = null
        return true
      }
      return false
    case 'staff-panel-username':
    case 'staff-panel-password':
      if (state.ui.staffPageLogin.message) {
        state.ui.staffPageLogin.message = null
        return true
      }
      return false
    default:
      return false
  }
}

function handleInput(event) {
  const model = event.target.dataset.model
  if (!model) {
    return
  }

  let shouldRender = false

  switch (model) {
    case 'staff-modal-username':
      state.ui.staffModal.username = event.target.value
      break
    case 'staff-modal-password':
      state.ui.staffModal.password = event.target.value
      break
    case 'staff-panel-username':
      state.ui.staffPageLogin.username = event.target.value
      break
    case 'staff-panel-password':
      state.ui.staffPageLogin.password = event.target.value
      break
    case 'add-sector-name':
      state.ui.addSectorModal.name = event.target.value
      break
    case 'file-display-name':
      state.ui.fileNameModal.displayName = event.target.value
      break
    case 'create-user-display-name':
      state.ui.staffUsers.newDisplayName = event.target.value
      break
    case 'create-user-username':
      state.ui.staffUsers.newUsername = event.target.value
      break
    case 'create-user-password':
      state.ui.staffUsers.newPassword = event.target.value
      break
    case 'edit-user-display-name':
      state.ui.staffUsers.editDisplayName = event.target.value
      break
    case 'edit-user-username':
      state.ui.staffUsers.editUsername = event.target.value
      break
    case 'edit-user-password':
      state.ui.staffUsers.editPassword = event.target.value
      break
    case 'sector-name': {
      const sectorId = event.target.dataset.sectorId
      if (!sectorId) {
        break
      }

      state.workingSectors = state.workingSectors.map((sector) =>
        sector.id === sectorId ? { ...sector, name: event.target.value } : sector,
      )
      break
    }
    default:
      return
  }

  if (clearInputError(model)) {
    shouldRender = true
  }

  if (shouldRender) {
    renderApp()
  }
}

async function handleChange(event) {
  if (event.target.dataset.fileInput !== 'sector') {
    return
  }

  const files = Array.from(event.target.files ?? [])
  event.target.value = ''
  await handleSelectedFiles(files)
}

function handleDragOver(event) {
  if (!event.target.closest('[data-file-dropzone]')) {
    return
  }

  event.preventDefault()
}

function handleDrop(event) {
  if (!event.target.closest('[data-file-dropzone]')) {
    return
  }

  event.preventDefault()
  const files = Array.from(event.dataTransfer?.files ?? [])
  void handleSelectedFiles(files)
}

async function handleStaffModalLoginSubmit() {
  state.ui.staffModal.isSubmitting = true
  renderApp()

  const result = await login(state.ui.staffModal.username, state.ui.staffModal.password)
  state.ui.staffModal.isSubmitting = false

  if (!result.ok) {
    state.ui.staffModal.error = result.message ?? 'Falha ao autenticar.'
    renderApp()
    return
  }

  closeStaffModal()
  navigate('/staff/setores')
}

async function handleStaffPanelLoginSubmit() {
  const result = await login(
    state.ui.staffPageLogin.username,
    state.ui.staffPageLogin.password,
  )

  state.ui.staffPageLogin.message = {
    type: result.ok ? 'success' : 'error',
    text: result.message ?? 'Nao foi possivel autenticar.',
  }

  if (result.ok) {
    state.ui.staffPageLogin.password = ''
  }

  renderApp()
}

function handleAddSectorSubmit() {
  const trimmedName = state.ui.addSectorModal.name.trim()

  if (!trimmedName) {
    state.ui.addSectorModal.error = 'Informe um nome para o setor.'
    renderApp()
    return
  }

  const nextId = getNextCustomSectorId(state.workingSectors, trimmedName)

  state.workingSectors = [
    ...state.workingSectors,
    {
      id: nextId,
      name: trimmedName,
      path: `/setores/${nextId}`,
    },
  ]

  closeAddSectorModal()
  addNotification({
    type: 'success',
    message: 'Setor adicionado ao rascunho. Clique em Salvar alteracoes para confirmar.',
  })
}

async function handleSaveSectors() {
  if (state.ui.isSavingSectors) {
    return
  }

  state.ui.isSavingSectors = true
  renderApp()

  const previousDocuments = state.documentsBySector
  const result = await replaceSectors(state.workingSectors)
  state.ui.isSavingSectors = false

  if (result.ok) {
    const savedSectorIds = new Set(state.sectors.map((sector) => sector.id))
    const removedDocumentUrls = Object.entries(previousDocuments)
      .filter(([sectorId]) => !savedSectorIds.has(sectorId))
      .flatMap(([, documents]) =>
        documents
          .map((documentItem) => documentItem.previewDataUrl)
          .filter((url) => typeof url === 'string' && url.trim()),
      )

    state.documentsBySector = Object.fromEntries(
      Object.entries(state.documentsBySector).filter(([sectorId]) => savedSectorIds.has(sectorId)),
    )

    if (
      state.ui.filesModal.sectorId &&
      !savedSectorIds.has(state.ui.filesModal.sectorId)
    ) {
      closeFilesModal()
    }

    if (removedDocumentUrls.length > 0) {
      await Promise.allSettled(removedDocumentUrls.map((url) => deleteCloudBlob(url)))
    }
  }

  addNotification({
    type: result.ok ? 'success' : 'error',
    message: result.message ?? 'Nao foi possivel salvar as alteracoes.',
  })
}

async function handleSaveNamedUpload() {
  const trimmedName = state.ui.fileNameModal.displayName.trim()

  if (!trimmedName) {
    state.ui.fileNameModal.error = 'Informe o nome do arquivo.'
    renderApp()
    return
  }

  if (!state.ui.filesModal.sectorId || state.ui.fileNameModal.files.length === 0) {
    state.ui.fileNameModal.error = 'Nenhum arquivo selecionado.'
    renderApp()
    return
  }

  state.ui.fileNameModal.isSubmitting = true
  renderApp()

  const addedDocumentsCount = await uploadFilesToSector(
    state.ui.filesModal.sectorId,
    state.ui.fileNameModal.files,
    trimmedName,
  )

  state.ui.fileNameModal.isSubmitting = false

  if (addedDocumentsCount > 0) {
    addNotification({
      type: 'success',
      message:
        addedDocumentsCount === 1
          ? '1 arquivo adicionado ao setor.'
          : `${addedDocumentsCount} arquivos adicionados ao setor.`,
    })
  } else {
    renderApp()
  }

  resetFileNameModal()
  renderApp()
}

async function handleRemoveDocument(documentId) {
  const activeSectorId = state.ui.filesModal.sectorId

  if (!activeSectorId) {
    return
  }

  const currentDocuments = getSectorDocuments(activeSectorId)
  const targetDocument = currentDocuments.find((documentItem) => documentItem.id === documentId)
  const nextStore = {
    ...state.documentsBySector,
    [activeSectorId]: currentDocuments.filter((documentItem) => documentItem.id !== documentId),
  }

  try {
    state.documentsBySector = await saveCloudDocumentsBySector(nextStore)

    if (targetDocument?.previewDataUrl) {
      try {
        await deleteCloudBlob(targetDocument.previewDataUrl)
      } catch {
        appendFileMessages([
          `${targetDocument.name}: metadados removidos, mas o arquivo nao foi apagado do Blob.`,
        ])
      }
    }

    addNotification({
      type: 'success',
      message: 'Arquivo removido do setor.',
    })
  } catch {
    addNotification({
      type: 'error',
      message: 'Nao foi possivel remover o arquivo na nuvem.',
    })
  }
}

async function handleCreateUserSubmit() {
  const result = await createUser({
    displayName: state.ui.staffUsers.newDisplayName,
    username: state.ui.staffUsers.newUsername,
    password: state.ui.staffUsers.newPassword,
  })

  if (!result.ok) {
    state.ui.staffUsers.createError = result.message ?? 'Nao foi possivel criar o usuario.'
    renderApp()
    return
  }

  state.ui.staffUsers.createOpen = false
  state.ui.staffUsers.createError = null
  state.ui.staffUsers.newDisplayName = ''
  state.ui.staffUsers.newUsername = ''
  state.ui.staffUsers.newPassword = ''

  addNotification({
    type: 'success',
    message: result.message ?? 'Usuario criado com sucesso.',
  })
}

async function handleEditUserSubmit() {
  if (!state.ui.staffUsers.editingUserId) {
    state.ui.staffUsers.editError = 'Usuario nao encontrado.'
    renderApp()
    return
  }

  const result = await updateUser({
    id: state.ui.staffUsers.editingUserId,
    displayName: state.ui.staffUsers.editDisplayName,
    username: state.ui.staffUsers.editUsername,
    password: state.ui.staffUsers.editPassword,
  })

  if (!result.ok) {
    state.ui.staffUsers.editError = result.message ?? 'Nao foi possivel atualizar o usuario.'
    renderApp()
    return
  }

  state.ui.staffUsers.editOpen = false
  state.ui.staffUsers.editError = null
  state.ui.staffUsers.editingUserId = null
  state.ui.staffUsers.editDisplayName = ''
  state.ui.staffUsers.editUsername = ''
  state.ui.staffUsers.editPassword = ''

  addNotification({
    type: 'success',
    message: result.message ?? 'Usuario atualizado com sucesso.',
  })
}

async function handleConfirmRemoveUser() {
  if (!state.ui.staffUsers.removeUserId) {
    return
  }

  const result = await removeUser(state.ui.staffUsers.removeUserId)
  state.ui.staffUsers.removeUserId = null

  addNotification({
    type: result.ok ? 'success' : 'error',
    message: result.message ?? 'Nao foi possivel remover o usuario.',
  })
}

async function handleOpenViewer(documentId) {
  state.ui.viewer.open = true
  state.ui.viewer.documentId = documentId
  state.ui.viewer.docxHtml = null
  state.ui.viewer.docxError = null
  state.ui.viewer.isLoading = false
  state.ui.viewer.requestId = null
  renderApp()

  const route = getRoute()
  await renderDocxPreviewIfNeeded(route)
}

function handleSubmit(event) {
  const formName = event.target.dataset.form

  if (!formName) {
    return
  }

  event.preventDefault()

  switch (formName) {
    case 'staff-modal-login':
      void handleStaffModalLoginSubmit()
      return
    case 'staff-panel-login':
      void handleStaffPanelLoginSubmit()
      return
    case 'add-sector':
      handleAddSectorSubmit()
      return
    case 'save-file-name':
      void handleSaveNamedUpload()
      return
    case 'create-user':
      void handleCreateUserSubmit()
      return
    case 'edit-user':
      void handleEditUserSubmit()
      return
    default:
      return
  }
}

document.addEventListener('click', (event) => {
  void handleDocumentClick(event)
})

document.addEventListener('submit', handleSubmit)
document.addEventListener('input', handleInput)
document.addEventListener('change', (event) => {
  void handleChange(event)
})
document.addEventListener('dragover', handleDragOver)
document.addEventListener('drop', handleDrop)

window.addEventListener('popstate', () => {
  closeRouteScopedUi()
  renderApp()
})

window.addEventListener('beforeunload', () => {
  state.notificationTimeouts.forEach((timeoutId) => {
    window.clearTimeout(timeoutId)
  })
  state.notificationTimeouts.clear()
})

async function initializeApp() {
  renderApp()
  await Promise.allSettled([loadSectors(), loadStaffUsers(), loadDocuments()])
  renderApp()
}

void initializeApp()
