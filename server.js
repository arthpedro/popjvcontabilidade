const crypto = require("crypto");
const fs = require("fs/promises");
const http = require("http");
const mammoth = require("mammoth");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// No ambiente Serverless (Vercel), não usamos caminhos locais para dados
const rootDir = __dirname;
const dataDir = path.join(rootDir, "dados");
const sectorsDir = path.join(dataDir, "setores");
const port = Number(process.env.PORT) || 3000;
const appShellRoutes = new Set(["/", "/index.html", "/arquivos.html", "/setores.html", "/staff.html"]);
const isServerless = process.env.VERCEL === '1';
const MAX_FILE_SIZE_MB = 50; // Limite do Supabase Free
const MAX_BODY_SIZE = isServerless ? 4.5 * 1024 * 1024 : 50 * 1024 * 1024;

// Configuração Supabase (Vão nas variáveis de ambiente do Vercel depois)
const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseKey = (process.env.SUPABASE_ANON_KEY || '').trim();

let supabase = null;
if (supabaseUrl && supabaseKey) {
  try {
    // Validação básica de URL para evitar crash na inicialização
    new URL(supabaseUrl);
    supabase = createClient(supabaseUrl, supabaseKey);
  } catch (e) {
    console.error("Erro ao inicializar Supabase: URL inválida ou malformada.");
  }
}

const defaultSectors = [
  { id: "departamento-pessoal", name: "Departamento Pessoal" },
  { id: "contabil", name: "Cont\u00e1bil" },
  { id: "fiscal", name: "Fiscal" },
  { id: "legalizacao-processos", name: "Legaliza\u00e7\u00e3o e Processos" },
  { id: "ti", name: "T.I" }
];

let sectors = new Set(defaultSectors.map((sector) => sector.id));

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip"
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-User-Id"
};

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders
  });
  response.end(JSON.stringify(data));
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders
  });
  response.end(html);
}

function publicUser(user) {
  return {
    id: user.id,
    nome: user.nome,
    usuario: user.usuario,
    perfil: user.perfil,
    ativo: user.ativo
  };
}

function normalizeProfile(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return ["administrador", "admin", "adm"].includes(normalized) ? "administrador" : "comum";
}

function resolveUserProfile(user) {
  if (normalizeProfile(user?.perfil) === "administrador" || normalizeProfile(user?.permissao) === "administrador") {
    return "administrador";
  }

  return "comum";
}

function userIsAdmin(user) {
  return resolveUserProfile(user) === "administrador";
}

/**
 * Gera um hash SHA-256 para a senha. 
 * Nota: Em produção real, prefira 'bcrypt'. Usando 'crypto' por ser nativo.
 */
function hashPassword(password) {
  if (!password) return "";
  return crypto.createHash("sha256").update(password).digest("hex");
}

function normalizeUser(user, index = 0) {
  return {
    id: Number(user.id) || Date.now() + index,
    nome: String(user.nome || "").trim(),
    usuario: String(user.usuario || "").trim(),
    senha: user.senha, // Mantém como está para validação posterior
    perfil: resolveUserProfile(user),
    ativo: user.ativo !== false
  };
}

async function readJson(filePath, fallback) {
  // Se estivermos no Vercel, aqui buscaríamos do Supabase/MongoDB em vez do FS
  if (isServerless) {
    // Mock de chamada ao banco de dados externo
    return fallback; 
  }

  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      if (!isServerless) await writeJson(filePath, fallback);
      return fallback;
    }

    throw error;
  }
}

async function writeJson(filePath, data) {
  if (isServerless) {
    // Aqui você faria um: await supabase.from('config').upsert({ id: filePath, data })
    return;
  }

  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  // Escrita Atômica: Escreve em um temporário e depois renomeia
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp`);
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
}

async function readUsers() {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('usuarios').select('*');
      if (!error && data) return data.map(normalizeUser);
    } catch (e) {
      console.error("Erro ao buscar usuários no Supabase:", e.message);
    }
  }

  const data = await readJson(path.join(rootDir, "usuarios.json"), { usuarios: [] });
  const rawUsers = Array.isArray(data.usuarios) ? data.usuarios : [];
  const users = rawUsers.map(normalizeUser);
  const needsRewrite = users.length !== data.usuarios?.length || rawUsers.some((user, index) => {
    return user.permissao !== undefined || user.perfil !== users[index].perfil;
  });

  if (needsRewrite && !isServerless) {
    await writeUsers(users);
  }

  return users;
}

async function writeUsers(users) {
  if (supabase) {
    // Upsert sincroniza os dados baseados na Primary Key (id)
    await supabase.from('usuarios').upsert(users.map(normalizeUser));
    return;
  }
  await writeJson(path.join(rootDir, "usuarios.json"), { usuarios: users.map(normalizeUser) });
}

function slugifySectorName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSector(sector) {
  const name = String(sector?.name || sector?.nome || "").trim().replace(/\s+/g, " ");
  const id = slugifySectorName(sector?.id || name);

  if (!id || !name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    return null;
  }

  return { id, name };
}

function normalizeSectorsList(sectorList) {
  const uniqueSectors = new Map();

  for (const sector of sectorList) {
    const normalized = normalizeSector(sector);

    if (normalized && !uniqueSectors.has(normalized.id)) {
      uniqueSectors.set(normalized.id, normalized);
    }
  }

  return Array.from(uniqueSectors.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function updateSectorCache(sectorList) {
  sectors = new Set(sectorList.map((sector) => sector.id));
}

function publicSector(sector) {
  return {
    id: sector.id,
    name: sector.name,
    nome: sector.name
  };
}

async function readSectors() {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('setores').select('*');
      if (!error && data && data.length > 0) {
        const sectorList = normalizeSectorsList(data);
        updateSectorCache(sectorList);
        return sectorList;
      }
    } catch (e) {
      console.error("Erro ao buscar setores no Supabase:", e.message);
    }
  }

  const data = await readJson(path.join(rootDir, "dados", "setores.json"), { setores: defaultSectors });
  let sectorList = normalizeSectorsList(Array.isArray(data.setores) ? data.setores : []);

  if (sectorList.length === 0) {
    sectorList = normalizeSectorsList(defaultSectors);
  }

  updateSectorCache(sectorList);
  return sectorList;
}

async function writeSectors(sectorList) {
  const normalizedSectors = normalizeSectorsList(sectorList);
  if (supabase) {
    await supabase.from('setores').upsert(normalizedSectors);
  } else {
    await writeJson(path.join(rootDir, "dados", "setores.json"), { setores: normalizedSectors });
  }
  updateSectorCache(normalizedSectors);
  return normalizedSectors;
}

function nextUserId(users) {
  return users.reduce((highestId, user) => Math.max(highestId, Number(user.id) || 0), 0) + 1;
}

function hasActiveAdmin(users) {
  return users.some((user) => user.ativo && userIsAdmin(user));
}

async function readBody(request) {
  let body = "";

  for await (const chunk of request) {
    body += chunk;

    if (body.length > 1024 * 1024) {
      throw new Error("Payload muito grande.");
    }
  }

  return body ? JSON.parse(body) : {};
}

async function readRawBody(request, limit = 50 * 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > limit) {
      throw new Error("Arquivo muito grande.");
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function requireAdmin(request, response) {
  const userId = Number(request.headers["x-user-id"]);
  const users = await readUsers();
  const user = users.find((item) => item.id === userId && item.ativo && userIsAdmin(item));

  if (!user) {
    sendJson(response, 403, { message: "Acesso restrito a administradores." });
    return null;
  }

  return user;
}

function validateUserPayload(payload, { creating = false } = {}) {
  const nome = String(payload.nome || "").trim();
  const usuario = String(payload.usuario || "").trim();
  const senha = String(payload.senha || "");

  if (!nome || !usuario) {
    return "Preencha nome e usuário.";
  }

  if (creating && !senha) {
    return "Informe uma senha para o novo usuário.";
  }

  return "";
}

function validateSectorPayload(payload) {
  const name = String(payload?.nome || payload?.name || "").trim().replace(/\s+/g, " ");

  if (!name) {
    return { error: "Informe o nome do setor." };
  }

  if (name.length > 80) {
    return { error: "Use um nome de setor com ate 80 caracteres." };
  }

  if (/[<>:"/\\|?*\x00-\x1F]/.test(name)) {
    return { error: "O nome do setor contem caracteres invalidos." };
  }

  const sector = normalizeSector({ id: payload?.id, name });

  if (!sector) {
    return { error: "Informe um nome de setor valido." };
  }

  return { sector };
}

async function ensureSectorRoots() {
  if (isServerless) return;

  await fs.mkdir(sectorsDir, { recursive: true });

  const sectorList = await readSectors();

  for (const sector of sectorList) {
    await fs.mkdir(path.join(sectorsDir, sector.id), { recursive: true });
  }
}

function getSectorRoot(sectorId) {
  if (!sectors.has(sectorId)) {
    return null;
  }

  return path.join(sectorsDir, sectorId);
}

function validateFolderName(value) {
  const folderName = String(value || "").trim();
  const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  if (!folderName) {
    return { error: "Informe o nome da pasta." };
  }

  if (folderName.length > 80) {
    return { error: "Use um nome de pasta com até 80 caracteres." };
  }

  if (/[<>:"/\\|?*\x00-\x1F]/.test(folderName) || folderName === "." || folderName === "..") {
    return { error: "O nome da pasta contém caracteres inválidos." };
  }

  if (/[. ]$/.test(folderName) || reservedNames.test(folderName)) {
    return { error: "O nome da pasta não é permitido pelo sistema." };
  }

  return { folderName };
}

function validateItemName(value) {
  const validation = validateFolderName(value);

  if (validation.error) {
    return validation;
  }

  return { itemName: validation.folderName };
}

function normalizeRelativePath(value) {
  const rawPath = String(value || "").replace(/\\/g, "/").trim();

  if (!rawPath) {
    return { relativePath: "" };
  }

  const parts = rawPath.split("/").filter(Boolean);
  const normalizedParts = [];

  for (const part of parts) {
    const validation = validateItemName(part);

    if (validation.error) {
      return { error: "O caminho contem nomes invalidos." };
    }

    normalizedParts.push(validation.itemName);
  }

  return { relativePath: normalizedParts.join("/") };
}

function getFolderPath(sectorId, folderName) {
  const sectorRoot = getSectorRoot(sectorId);

  if (!sectorRoot) {
    return null;
  }

  const resolvedRoot = path.resolve(sectorRoot);
  const resolvedFolder = path.resolve(sectorRoot, folderName);

  if (!resolvedFolder.startsWith(`${resolvedRoot}${path.sep}`)) {
    return null;
  }

  return resolvedFolder;
}

function getExplorerPath(sectorId, relativePath = "") {
  const sectorRoot = getSectorRoot(sectorId);

  if (!sectorRoot) {
    return null;
  }

  const normalized = normalizeRelativePath(relativePath);

  if (normalized.error) {
    return null;
  }

  const resolvedRoot = path.resolve(sectorRoot);
  const resolvedItem = path.resolve(sectorRoot, normalized.relativePath);
  const isInsideRoot = resolvedItem === resolvedRoot || resolvedItem.startsWith(`${resolvedRoot}${path.sep}`);

  if (!isInsideRoot) {
    return null;
  }

  return {
    absolutePath: resolvedItem,
    relativePath: normalized.relativePath
  };
}

function joinRelativePath(basePath, itemName) {
  return [basePath, itemName].filter(Boolean).join("/");
}

function parentRelativePath(relativePath) {
  const parts = String(relativePath || "").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

async function listExplorerItems(sectorId, relativePath = "") {
  const current = getExplorerPath(sectorId, relativePath);

  if (!current) {
    return null;
  }

  if (supabase) {
    const folderPath = current.relativePath;
    const { data, error } = await supabase.storage.from('setores').list(folderPath);
    
    if (error) throw error;

    return {
      caminho: current.relativePath,
      pai: parentRelativePath(current.relativePath),
      itens: data.map(item => ({
        id: joinRelativePath(current.relativePath, item.name),
        nome: item.name,
        tipo: item.id ? "file" : "folder",
        caminho: joinRelativePath(current.relativePath, item.name),
        tamanho: item.metadata?.size || null,
        atualizadoEm: item.updated_at || item.created_at,
        criadoEm: item.created_at
      })).sort((a, b) => (a.tipo === b.tipo ? a.nome.localeCompare(b.nome) : a.tipo === "folder" ? -1 : 1))
    };
  }

  try {
    const stat = await fs.stat(current.absolutePath);

    if (!stat.isDirectory()) {
      return null;
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }

  const entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    const entryPath = path.join(current.absolutePath, entry.name);
    const stat = await fs.stat(entryPath);
    const type = entry.isDirectory() ? "folder" : "file";

    items.push({
      id: joinRelativePath(current.relativePath, entry.name),
      nome: entry.name,
      tipo: type,
      caminho: joinRelativePath(current.relativePath, entry.name),
      tamanho: type === "file" ? stat.size : null,
      atualizadoEm: stat.mtime.toISOString(),
      criadoEm: (stat.birthtime || stat.ctime).toISOString()
    });
  }

  items.sort((a, b) => {
    if (a.tipo !== b.tipo) {
      return a.tipo === "folder" ? -1 : 1;
    }

    return a.nome.localeCompare(b.nome, "pt-BR");
  });

  return {
    caminho: current.relativePath,
    pai: parentRelativePath(current.relativePath),
    itens: items
  };
}

async function sendExplorerDownload(response, sectorId, filePath) {
  const item = getExplorerPath(sectorId, filePath);

  if (!item) {
    sendJson(response, 404, { message: "Arquivo nao encontrado." });
    return;
  }

  if (supabase) {
    const { data, error } = await supabase.storage.from('setores').download(item.relativePath);
    if (error) {
      sendJson(response, 404, { message: "Arquivo não encontrado no Storage." });
      return;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    const extension = path.extname(item.relativePath).toLowerCase();
    response.writeHead(200, { "Content-Type": mimeTypes[extension] || "application/octet-stream", "Content-Length": buffer.length });
    response.end(buffer);
    return;
  }

  try {
    const stat = await fs.stat(item.absolutePath);

    if (!stat.isFile()) {
      sendJson(response, 400, { message: "O item selecionado nao e um arquivo." });
      return;
    }

    const extension = path.extname(item.absolutePath).toLowerCase();
    const filename = path.basename(item.absolutePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Content-Length": stat.size,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      ...corsHeaders
    });

    const content = await fs.readFile(item.absolutePath);
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, { message: "Arquivo nao encontrado." });
      return;
    }

    throw error;
  }
}

async function sendExplorerPreview(response, sectorId, filePath) {
  const item = getExplorerPath(sectorId, filePath);

  if (!item) {
    sendJson(response, 404, { message: "Arquivo nao encontrado." });
    return;
  }

  const extension = path.extname(item.absolutePath).toLowerCase();

  if (supabase) {
    const { data, error } = await supabase.storage.from('setores').download(item.relativePath);
    if (error) {
      sendJson(response, 404, { message: "Arquivo não encontrado." });
      return;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    const result = await mammoth.convertToHtml({ buffer });
    sendHtml(response, 200, result.value || "<p>Sem conteúdo.</p>");
    return;
  }

  if (extension !== ".docx") {
    sendJson(response, 415, { message: "A visualizacao de Word esta disponivel para arquivos .docx." });
    return;
  }

  try {
    const stat = await fs.stat(item.absolutePath);

    if (!stat.isFile()) {
      sendJson(response, 400, { message: "O item selecionado nao e um arquivo." });
      return;
    }

    const result = await mammoth.convertToHtml({ path: item.absolutePath });
    sendHtml(response, 200, result.value || "<p>Documento sem conteudo para visualizacao.</p>");
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, { message: "Arquivo nao encontrado." });
      return;
    }

    throw error;
  }
}

function parseMultipartFile(request, body) {
  const contentType = request.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

  if (!boundaryMatch) {
    return null;
  }

  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
  const bodyText = body.toString("latin1");
  const parts = bodyText.split(boundary);

  for (const part of parts) {
    if (!part.includes("Content-Disposition") || !part.includes("filename=")) {
      continue;
    }

    const headerEnd = part.indexOf("\r\n\r\n");

    if (headerEnd === -1) {
      continue;
    }

    const headers = part.slice(0, headerEnd);
    const filenameMatch = headers.match(/filename="([^"]*)"/i);
    const fallbackNameMatch = headers.match(/filename=([^;\r\n]*)/i);
    const filename = filenameMatch ? filenameMatch[1] : String(fallbackNameMatch?.[1] || "").trim();
    let content = part.slice(headerEnd + 4);

    if (content.endsWith("\r\n")) {
      content = content.slice(0, -2);
    }

    return {
      filename: path.basename(filename.replace(/\\/g, "/")),
      content: Buffer.from(content, "latin1")
    };
  }

  return null;
}

async function listSectorFolders(sectorId) {
  const sectorRoot = getSectorRoot(sectorId);

  if (!sectorRoot) {
    return null;
  }

  await fs.mkdir(sectorRoot, { recursive: true });
  const entries = await fs.readdir(sectorRoot, { withFileTypes: true });
  const folders = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const folderPath = path.join(sectorRoot, entry.name);
    const stat = await fs.stat(folderPath);

    folders.push({
      id: entry.name,
      nome: entry.name,
      criadoEm: (stat.birthtime || stat.ctime).toISOString()
    });
  }

  return folders.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

async function handleLogin(request, response) {
  const payload = await readBody(request);
  const usuario = String(payload.usuario || "").trim().toLowerCase();
  const senha = String(payload.senha || "");
  const users = await readUsers();
  const hashedPassword = hashPassword(senha);

  const user = users.find((item) => {
    // Aceita senha em texto puro (migração) ou hash
    return item.ativo && item.usuario.toLowerCase() === usuario && (item.senha === senha || item.senha === hashedPassword);
  });

  if (!user) {
    sendJson(response, 401, { message: "Usuário ou senha inválidos." });
    return;
  }

  sendJson(response, 200, { usuario: publicUser(user) });
}

async function handleUsersApi(request, response, pathname) {
  const admin = await requireAdmin(request, response);

  if (!admin) {
    return;
  }

  const users = await readUsers();

  if (request.method === "GET" && pathname === "/api/usuarios") {
    sendJson(response, 200, { usuarios: users.map(publicUser) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/usuarios") {
    const payload = await readBody(request);
    const error = validateUserPayload(payload, { creating: true });

    if (error) {
      sendJson(response, 400, { message: error });
      return;
    }

    const usuario = String(payload.usuario).trim();
    const duplicate = users.some((user) => user.usuario.toLowerCase() === usuario.toLowerCase());

    if (duplicate) {
      sendJson(response, 409, { message: "Já existe um usuário com esse login." });
      return;
    }

    const user = normalizeUser({
      id: nextUserId(users),
      nome: payload.nome,
      usuario,
      senha: hashPassword(payload.senha),
      perfil: normalizeProfile(payload.perfil),
      ativo: payload.ativo !== false
    });

    const nextUsers = [...users, user];

    if (!hasActiveAdmin(nextUsers)) {
      sendJson(response, 400, { message: "Mantenha pelo menos um administrador ativo." });
      return;
    }

    await writeUsers(nextUsers);
    sendJson(response, 201, { usuario: publicUser(user) });
    return;
  }

  const userMatch = pathname.match(/^\/api\/usuarios\/(\d+)$/);

  if (!userMatch) {
    sendJson(response, 404, { message: "Rota não encontrada." });
    return;
  }

  const userId = Number(userMatch[1]);
  const existingUser = users.find((user) => user.id === userId);

  if (!existingUser) {
    sendJson(response, 404, { message: "Usuário não encontrado." });
    return;
  }

  if (request.method === "PUT") {
    const payload = await readBody(request);
    const error = validateUserPayload(payload);

    if (error) {
      sendJson(response, 400, { message: error });
      return;
    }

    const usuario = String(payload.usuario).trim();
    const duplicate = users.some((user) => {
      return user.id !== userId && user.usuario.toLowerCase() === usuario.toLowerCase();
    });

    if (duplicate) {
      sendJson(response, 409, { message: "Já existe um usuário com esse login." });
      return;
    }

    const nextUsers = users.map((user) => {
      if (user.id !== userId) {
        return user;
      }

      return normalizeUser({
        ...user,
        nome: payload.nome,
        usuario,
        senha: payload.senha ? hashPassword(payload.senha) : user.senha,
        perfil: normalizeProfile(payload.perfil),
        ativo: payload.ativo !== false
      });
    });

    if (!hasActiveAdmin(nextUsers)) {
      sendJson(response, 400, { message: "Mantenha pelo menos um administrador ativo." });
      return;
    }

    await writeUsers(nextUsers);
    sendJson(response, 200, { usuario: publicUser(nextUsers.find((user) => user.id === userId)) });
    return;
  }

  if (request.method === "DELETE") {
    if (admin.id === userId) {
      sendJson(response, 400, { message: "Não é possível excluir o usuário logado." });
      return;
    }

    const nextUsers = users.filter((user) => user.id !== userId);

    if (!hasActiveAdmin(nextUsers)) {
      sendJson(response, 400, { message: "Mantenha pelo menos um administrador ativo." });
      return;
    }

    await writeUsers(nextUsers);
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 405, { message: "Método não permitido." });
}

async function handleFoldersApi(request, response, pathname, searchParams) {
  const admin = await requireAdmin(request, response);

  if (!admin) {
    return;
  }

  const sectorsCollection = pathname === "/api/setores";
  const sectorMatch = pathname.match(/^\/api\/setores\/([^/]+)$/);
  const explorerMatch = pathname.match(/^\/api\/setores\/([^/]+)\/explorer$/);
  const uploadMatch = pathname.match(/^\/api\/setores\/([^/]+)\/upload$/);
  const renameMatch = pathname.match(/^\/api\/setores\/([^/]+)\/rename$/);
  const deleteFileMatch = pathname.match(/^\/api\/setores\/([^/]+)\/delete$/);
  const downloadMatch = pathname.match(/^\/api\/setores\/([^/]+)\/download$/);
  const previewMatch = pathname.match(/^\/api\/setores\/([^/]+)\/preview$/);
  const listMatch = pathname.match(/^\/api\/setores\/([^/]+)\/pastas$/);
  const deleteMatch = pathname.match(/^\/api\/setores\/([^/]+)\/pastas\/(.+)$/);

  if (sectorsCollection && request.method === "GET") {
    const sectorList = await readSectors();
    sendJson(response, 200, { setores: sectorList.map(publicSector) });
    return;
  }

  if (sectorsCollection && request.method === "POST") {
    const payload = await readBody(request);
    const validation = validateSectorPayload(payload);

    if (validation.error) {
      sendJson(response, 400, { message: validation.error });
      return;
    }

    const sectorList = await readSectors();

    if (sectorList.some((sector) => sector.id === validation.sector.id)) {
      sendJson(response, 409, { message: "Ja existe um setor com esse nome." });
      return;
    }

    const sectorRoot = path.join(sectorsDir, validation.sector.id);

    try {
      await fs.mkdir(sectorRoot);
    } catch (error) {
      if (error.code === "EEXIST") {
        sendJson(response, 409, { message: "Ja existe uma pasta para esse setor." });
        return;
      }

      throw error;
    }

    const nextSectors = await writeSectors([...sectorList, validation.sector]);
    sendJson(response, 201, {
      setor: publicSector(validation.sector),
      setores: nextSectors.map(publicSector)
    });
    return;
  }

  if (sectorMatch && request.method === "DELETE") {
    const sectorId = decodeURIComponent(sectorMatch[1]);
    const sectorList = await readSectors();
    const sector = sectorList.find((item) => item.id === sectorId);

    if (!sector) {
      sendJson(response, 404, { message: "Setor nao encontrado." });
      return;
    }

    const sectorRoot = getSectorRoot(sector.id);

    if (!sectorRoot) {
      sendJson(response, 404, { message: "Setor nao encontrado." });
      return;
    }

    const resolvedSectorsRoot = path.resolve(sectorsDir);
    const resolvedSectorRoot = path.resolve(sectorRoot);

    if (resolvedSectorRoot === resolvedSectorsRoot || !resolvedSectorRoot.startsWith(`${resolvedSectorsRoot}${path.sep}`)) {
      sendJson(response, 400, { message: "Setor invalido." });
      return;
    }

    await fs.rm(resolvedSectorRoot, { recursive: true, force: true });

    const nextSectors = await writeSectors(sectorList.filter((item) => item.id !== sector.id));
    sendJson(response, 200, {
      ok: true,
      setores: nextSectors.map(publicSector)
    });
    return;
  }

  if (explorerMatch && request.method === "GET") {
    const sectorId = decodeURIComponent(explorerMatch[1]);
    const currentPath = searchParams.get("path") || "";
    const result = await listExplorerItems(sectorId, currentPath);

    if (!result) {
      sendJson(response, 404, { message: "Pasta nao encontrada." });
      return;
    }

    sendJson(response, 200, result);
    return;
  }

  if (explorerMatch && request.method === "POST") {
    const sectorId = decodeURIComponent(explorerMatch[1]);
    const currentPath = searchParams.get("path") || "";
    const payload = await readBody(request);
    const nameValidation = validateItemName(payload.nome);
    const current = getExplorerPath(sectorId, currentPath);

    if (nameValidation.error) {
      sendJson(response, 400, { message: nameValidation.error });
      return;
    }

    if (!current) {
      sendJson(response, 404, { message: "Pasta nao encontrada." });
      return;
    }

    const targetPath = path.join(current.absolutePath, nameValidation.itemName);

    try {
      const currentStat = await fs.stat(current.absolutePath);

      if (!currentStat.isDirectory()) {
        sendJson(response, 400, { message: "O destino selecionado nao e uma pasta." });
        return;
      }

      await fs.mkdir(targetPath);
      sendJson(response, 201, { ok: true });
    } catch (error) {
      if (error.code === "EEXIST") {
        sendJson(response, 409, { message: "Ja existe um item com esse nome nesta pasta." });
        return;
      }

      if (error.code === "ENOENT") {
        sendJson(response, 404, { message: "Pasta nao encontrada." });
        return;
      }

      throw error;
    }
    return;
  }

  // Endpoint para gerar URL de Upload Assinada (Evita o limite de 4.5MB do Vercel)
  const uploadSignMatch = pathname.match(/^\/api\/setores\/([^/]+)\/sign-upload$/);
  if (uploadSignMatch && request.method === "POST") {
    const sectorId = decodeURIComponent(uploadSignMatch[1]);
    const currentPath = searchParams.get("path") || "";
    const payload = await readBody(request);
    const fileName = payload.filename;

    if (!supabase) {
      sendJson(response, 400, { message: "Cloud Storage não configurado." });
      return;
    }

    const normalized = normalizeRelativePath(currentPath);
    const fullPath = joinRelativePath(normalized.relativePath, fileName);
    
    const { data, error } = await supabase.storage.from('setores').createSignedUploadUrl(fullPath);

    if (error) {
      sendJson(response, 500, { message: "Erro ao gerar permissão de upload." });
      return;
    }

    sendJson(response, 200, { uploadUrl: data.signedUrl, token: data.token });
    return;
  }

  if (uploadMatch && request.method === "POST") {
    const sectorId = decodeURIComponent(uploadMatch[1]);
    const currentPath = searchParams.get("path") || "";
    const current = getExplorerPath(sectorId, currentPath);

    if (!current) {
      sendJson(response, 404, { message: "Pasta nao encontrada." });
      return;
    }

    try {
      const currentStat = await fs.stat(current.absolutePath);

      if (!currentStat.isDirectory()) {
        sendJson(response, 400, { message: "O destino selecionado nao e uma pasta." });
        return;
      }

      const body = await readRawBody(request);
      const upload = parseMultipartFile(request, body);
      const nameValidation = validateItemName(upload?.filename);

      if (!upload || nameValidation.error) {
        sendJson(response, 400, { message: "Selecione um arquivo com nome valido." });
        return;
      }

      const targetPath = path.join(current.absolutePath, nameValidation.itemName);

      if (supabase) {
        const fullPath = joinRelativePath(current.relativePath, nameValidation.itemName);
        await supabase.storage.from('setores').upload(fullPath, upload.content, { contentType: mimeTypes[path.extname(fullPath)] });
        sendJson(response, 201, { ok: true });
        return;
      }

      try {
        await fs.writeFile(targetPath, upload.content, { flag: "wx" });
      } catch (error) {
        if (error.code === "EEXIST") {
          sendJson(response, 409, { message: "Ja existe um arquivo com esse nome nesta pasta." });
          return;
        }

        throw error;
      }

      sendJson(response, 201, { ok: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        sendJson(response, 404, { message: "Pasta nao encontrada." });
        return;
      }

      throw error;
    }
    return;
  }

  if (renameMatch && request.method === "PUT") {
    const sectorId = decodeURIComponent(renameMatch[1]);
    const payload = await readBody(request);
    const item = getExplorerPath(sectorId, payload.caminho);
    const nameValidation = validateItemName(payload.nome);

    if (!item) {
      sendJson(response, 404, { message: "Item nao encontrado." });
      return;
    }

    if (nameValidation.error) {
      sendJson(response, 400, { message: nameValidation.error });
      return;
    }

    if (supabase) {
      const newPath = joinRelativePath(parentRelativePath(item.relativePath), nameValidation.itemName);
      await supabase.storage.from('setores').move(item.relativePath, newPath);
      sendJson(response, 200, { ok: true });
      return;
    }

    const targetPath = path.join(path.dirname(item.absolutePath), nameValidation.itemName);
    const resolvedRoot = path.resolve(getSectorRoot(sectorId));
    const resolvedTarget = path.resolve(targetPath);

    if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
      sendJson(response, 400, { message: "Nome invalido para este item." });
      return;
    }

    try {
      try {
        await fs.access(targetPath);
        sendJson(response, 409, { message: "Ja existe um item com esse nome nesta pasta." });
        return;
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }

      await fs.rename(item.absolutePath, targetPath);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        sendJson(response, 404, { message: "Item nao encontrado." });
        return;
      }

      if (error.code === "EEXIST") {
        sendJson(response, 409, { message: "Ja existe um item com esse nome nesta pasta." });
        return;
      }

      throw error;
    }
    return;
  }

  if (downloadMatch && request.method === "GET") {
    const sectorId = decodeURIComponent(downloadMatch[1]);
    const filePath = searchParams.get("path") || "";
    await sendExplorerDownload(response, sectorId, filePath);
    return;
  }

  if (deleteFileMatch && request.method === "DELETE") {
    const sectorId = decodeURIComponent(deleteFileMatch[1]);
    const filePath = searchParams.get("path") || "";

    const item = getExplorerPath(sectorId, filePath);

    if (!item) {
      sendJson(response, 404, { message: "Arquivo nao encontrado." });
      return;
    }

    if (supabase) {
      await supabase.storage.from('setores').remove([item.relativePath]);
      sendJson(response, 200, { ok: true });
      return;
    }

    try {
      const stat = await fs.stat(item.absolutePath);

      if (!stat.isFile()) {
        sendJson(response, 400, { message: "O item selecionado nao e um arquivo." });
        return;
      }

      await fs.rm(item.absolutePath, { force: false });
      sendJson(response, 200, { ok: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        sendJson(response, 404, { message: "Arquivo nao encontrado." });
        return;
      }

      throw error;
    }

    return;
  }

  if (previewMatch && request.method === "GET") {
    const sectorId = decodeURIComponent(previewMatch[1]);
    const filePath = searchParams.get("path") || "";
    await sendExplorerPreview(response, sectorId, filePath);
    return;
  }

  if (listMatch && request.method === "GET") {
    const sectorId = decodeURIComponent(listMatch[1]);
    const folders = await listSectorFolders(sectorId);

    if (!folders) {
      sendJson(response, 404, { message: "Setor não encontrado." });
      return;
    }

    sendJson(response, 200, { pastas: folders });
    return;
  }

  if (listMatch && request.method === "POST") {
    const sectorId = decodeURIComponent(listMatch[1]);
    const payload = await readBody(request);
    const validation = validateFolderName(payload.nome);

    if (validation.error) {
      sendJson(response, 400, { message: validation.error });
      return;
    }

    const folderPath = getFolderPath(sectorId, validation.folderName);

    if (!folderPath) {
      sendJson(response, 404, { message: "Setor não encontrado." });
      return;
    }

    try {
      await fs.mkdir(folderPath);
    } catch (error) {
      if (error.code === "EEXIST") {
        sendJson(response, 409, { message: "Já existe uma pasta com esse nome neste setor." });
        return;
      }

      throw error;
    }

    const stat = await fs.stat(folderPath);
    sendJson(response, 201, {
      pasta: {
        id: validation.folderName,
        nome: validation.folderName,
        criadoEm: (stat.birthtime || stat.ctime).toISOString()
      }
    });
    return;
  }

  if (deleteMatch && request.method === "DELETE") {
    const sectorId = decodeURIComponent(deleteMatch[1]);
    const folderName = decodeURIComponent(deleteMatch[2]);
    const validation = validateFolderName(folderName);

    if (validation.error) {
      sendJson(response, 400, { message: validation.error });
      return;
    }

    const folderPath = getFolderPath(sectorId, validation.folderName);

    if (!folderPath) {
      sendJson(response, 404, { message: "Setor ou pasta não encontrado." });
      return;
    }

    try {
      const stat = await fs.stat(folderPath);

      if (!stat.isDirectory()) {
        sendJson(response, 400, { message: "O item selecionado não é uma pasta." });
        return;
      }

      await fs.rm(folderPath, { recursive: true, force: false });
      sendJson(response, 200, { ok: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        sendJson(response, 404, { message: "Pasta não encontrada." });
        return;
      }

      throw error;
    }
    return;
  }

  sendJson(response, 404, { message: "Rota não encontrada." });
}

async function handlePublicFoldersApi(request, response, pathname, searchParams) {
  const sectorsCollection = pathname === "/api/public/setores";
  const explorerMatch = pathname.match(/^\/api\/public\/setores\/([^/]+)\/explorer$/);
  const downloadMatch = pathname.match(/^\/api\/public\/setores\/([^/]+)\/download$/);
  const previewMatch = pathname.match(/^\/api\/public\/setores\/([^/]+)\/preview$/);

  if (sectorsCollection && request.method === "GET") {
    const sectorList = await readSectors();
    sendJson(response, 200, { setores: sectorList.map(publicSector) });
    return;
  }

  if (explorerMatch && request.method === "GET") {
    const sectorId = decodeURIComponent(explorerMatch[1]);
    const currentPath = searchParams.get("path") || "";
    const result = await listExplorerItems(sectorId, currentPath);

    if (!result) {
      sendJson(response, 404, { message: "Pasta nao encontrada." });
      return;
    }

    sendJson(response, 200, result);
    return;
  }

  if (downloadMatch && request.method === "GET") {
    const sectorId = decodeURIComponent(downloadMatch[1]);
    const filePath = searchParams.get("path") || "";
    await sendExplorerDownload(response, sectorId, filePath);
    return;
  }

  if (previewMatch && request.method === "GET") {
    const sectorId = decodeURIComponent(previewMatch[1]);
    const filePath = searchParams.get("path") || "";
    await sendExplorerPreview(response, sectorId, filePath);
    return;
  }

  sendJson(response, 404, { message: "Rota nao encontrada." });
}

async function serveStatic(request, response, pathname) {
  const cleanPath = appShellRoutes.has(pathname) ? "/index.html" : pathname;
  const extension = path.extname(cleanPath).toLowerCase();

  if (!mimeTypes[extension]) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Arquivo não encontrado.");
    return;
  }

  const filePath = path.resolve(rootDir, `.${cleanPath}`);

  const resolvedRoot = path.resolve(rootDir);

  if (!filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Acesso negado.");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension],
      "Cache-Control": "no-store"
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Arquivo não encontrado.");
      return;
    }

    throw error;
  }
}

async function handleRequest(request, response) {
  // Usa um fallback para o host para evitar erros de construção de URL no Vercel
  const { pathname, searchParams } = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    if (request.method === "POST" && pathname === "/api/login") {
      await handleLogin(request, response);
      return;
    }

    if (pathname.startsWith("/api/usuarios")) {
      await handleUsersApi(request, response, pathname);
      return;
    }

    if (pathname.startsWith("/api/public/setores")) {
      await handlePublicFoldersApi(request, response, pathname, searchParams);
      return;
    }

    if (pathname.startsWith("/api/setores")) {
      await handleFoldersApi(request, response, pathname, searchParams);
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 405, { message: "Método não permitido." });
      return;
    }

    await serveStatic(request, response, pathname);
  } catch (error) {
    console.error(error);
    const statusCode = error.code === 'ENOENT' ? 404 : 500;
    const message = statusCode === 404 ? "Recurso não encontrado" : "Erro interno do servidor.";
    sendJson(response, statusCode, { 
      message: message,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

async function start() {
  // No Vercel, o ambiente serverless não requer o início manual do servidor via .listen()
  // O Vercel gerencia o ciclo de vida da requisição automaticamente.
  if (isServerless) return;

  await ensureSectorRoots();

  const server = http.createServer(handleRequest);
  
  // No Vercel, o host é gerenciado pela plataforma. Localmente, 0.0.0.0 é mais flexível que 127.0.0.1
  const host = isServerless ? undefined : "0.0.0.0";

  server.listen(port, host, () => {
    console.log(`Servidor iniciado na porta ${port}`);
    if (supabase) console.log("Conectado ao Supabase Storage/Database.");
  });
}

start();

// Exporta o handler para o Vercel
module.exports = handleRequest;
