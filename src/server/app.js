const crypto = require("crypto");
const fs = require("fs/promises");
const http = require("http");
const mammoth = require("mammoth");
const path = require("path");

const { createRuntimeConfig } = require("./config/env");
const {
  appRouteRedirects,
  appShellRoutes,
  corsHeaders,
  defaultSectors,
  defaultUsersData,
  mimeTypes,
  securityHeaders,
  staticPathAliases,
  storagePaths
} = require("./config/constants");
const { sendHtml, sendJson } = require("./http/responses");
const {
  hashPassword,
  normalizeProfile,
  normalizeUser,
  normalizeUserForStorage,
  publicAuditActor,
  publicUser,
  userIsAdmin
} = require("./domain/users");
const {
  getSectorNameFromId,
  normalizeSector,
  normalizeSectorsList,
  publicSector
} = require("./domain/sectors");
const { createSupabaseContext } = require("./storage/supabase-client");

const runtime = createRuntimeConfig();
const {
  rootDir,
  dataDir,
  publicDir,
  sectorsDir,
  port,
  isServerless,
  debugLogsEnabled
} = runtime;
const MAX_BODY_SIZE = runtime.maxBodySize;
const MAX_JSON_BODY_SIZE = runtime.maxJsonBodySize;

function logDebug(...args) {
  if (debugLogsEnabled) {
    console.log(...args);
  }
}

const {
  getSupabaseConfigMessage,
  supabase,
  supabaseKey,
  supabaseServiceRoleKey,
  supabaseUrl
} = createSupabaseContext();

const usersConfigStoragePath = storagePaths.usersConfig;
const sectorsConfigStoragePath = storagePaths.sectorsConfig;
const auditLogsStoragePath = storagePaths.auditLogs;
const auditLogsFilePath = path.join(dataDir, "logs.json");
let auditLogWriteQueue = Promise.resolve();

let sectors = new Set(defaultSectors.map((sector) => sector.id));

async function readJson(filePath, fallback) {
  logDebug(`[readJson] Attempting to read: ${filePath}`);
  try {
    if (isServerless) return fallback;
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`Erro de sintaxe no JSON em ${filePath}:`, error.message);
    }
    if (error.code === "ENOENT") {
      if (!isServerless) await writeJson(filePath, fallback);
      return fallback;
    }

    throw error;
  }
}

function parseFirstJsonValue(content) {
  const startIndex = content.search(/\S/);

  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < content.length; index += 1) {
    const char = content[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      depth += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      depth -= 1;

      if (depth === 0) {
        const json = content.slice(startIndex, index + 1);
        const trailing = content.slice(index + 1).trim();

        return {
          data: JSON.parse(json),
          hadTrailingContent: trailing.length > 0
        };
      }
    }
  }

  return null;
}

async function writeJson(filePath, data) {
  logDebug(`[writeJson] Attempting to write: ${filePath}`);
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

async function readUsersFromStorage() {
  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase.storage.from('setores').download(usersConfigStoragePath);

    if (error) {
      console.warn("Config de usuarios no Storage nao encontrada:", error.message);
      return [];
    }

    const text = Buffer.from(await data.arrayBuffer()).toString("utf8");
    const parsed = JSON.parse(text);
    return (Array.isArray(parsed?.usuarios) ? parsed.usuarios : []).map(normalizeUser);
  } catch (error) {
    console.error("Erro ao ler config de usuarios no Storage:", error.message);
    return [];
  }
}

async function writeUsersToStorage(users) {
  if (!supabase) {
    throw new Error(getSupabaseConfigMessage());
  }

  const usersToStore = users.map(normalizeUserForStorage);
  const body = Buffer.from(JSON.stringify({ usuarios: usersToStore }, null, 2), "utf8");
  const { error } = await supabase.storage.from('setores').upload(usersConfigStoragePath, body, {
    contentType: "application/json; charset=utf-8",
    upsert: true
  });

  if (error) {
    throw error;
  }

  return usersToStore;
}

async function readUsers() {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('usuarios').select('*');
      if (error) {
        console.error("Erro ao buscar usuários no Supabase:", error.message);
        const storageUsers = await readUsersFromStorage();
        return storageUsers.length ? storageUsers : defaultUsersData.map(normalizeUserForStorage);
      } else if (data && data.length > 0) {
        return data.map(normalizeUser);
      } else if (!error && data && data.length === 0) {
        logDebug("Populando usuários padrão no Supabase...");
        const storageUsers = await readUsersFromStorage();
        const usersToUpsert = storageUsers.length
          ? storageUsers.map(normalizeUserForStorage)
          : defaultUsersData.map(normalizeUserForStorage);
        const { error: upsertError } = await supabase.from('usuarios').upsert(usersToUpsert);
        if (upsertError) {
          console.error("Erro ao popular usuários padrão no Supabase:", upsertError.message);
        }
        await writeUsersToStorage(usersToUpsert);
        return usersToUpsert.map(normalizeUser);
      }
    } catch (e) {
      console.error("Erro inesperado ao interagir com Supabase (readUsers):", e.message);
      const storageUsers = await readUsersFromStorage();
      return storageUsers.length ? storageUsers : defaultUsersData.map(normalizeUserForStorage);
    }
  }

  // Fallback to local JSON if Supabase not configured or failed
  try {
    const fallback = { usuarios: defaultUsersData.map(normalizeUserForStorage) };
    const data = await readJson(path.join(rootDir, "usuarios.json"), fallback);
    return (Array.isArray(data.usuarios) ? data.usuarios : []).map(normalizeUser);
  } catch (err) {
    console.error("Erro ao ler usuários do arquivo local:", err.message);
    return defaultUsersData.map(normalizeUserForStorage);
  }
}

async function writeUsers(users) {
  const usersToStore = users.map(normalizeUserForStorage);

  if (supabase) {
    const { error } = await supabase.from('usuarios').upsert(usersToStore);

    if (error) {
      console.error("Erro ao salvar usuarios na tabela Supabase:", error.message);
    } else {
      const userIds = usersToStore.map((user) => Number(user.id)).filter(Boolean);

      if (userIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('usuarios')
          .delete()
          .not('id', 'in', `(${userIds.join(',')})`);

        if (deleteError) {
          console.error("Erro ao remover usuarios antigos da tabela Supabase:", deleteError.message);
        }
      }
    }

    await writeUsersToStorage(usersToStore);
    return;
  }

  if (isServerless) {
    throw new Error(getSupabaseConfigMessage());
  }

  await writeJson(path.join(rootDir, "usuarios.json"), { usuarios: usersToStore });
}

function updateSectorCache(sectorList) {
  sectors = new Set(sectorList.map((sector) => sector.id));
}

async function readSectorsFromStorage() {
  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase.storage.from('setores').download(sectorsConfigStoragePath);

    if (error) {
      console.warn("Config de setores no Storage nao encontrada:", error.message);
    } else {
      const text = Buffer.from(await data.arrayBuffer()).toString("utf8");
      const parsed = JSON.parse(text);
      return normalizeSectorsList(Array.isArray(parsed?.setores) ? parsed.setores : []);
    }
  } catch (error) {
    console.error("Erro ao ler config de setores no Storage:", error.message);
  }

  try {
    const { data, error } = await supabase.storage.from('setores').list('', {
      sortBy: { column: 'name', order: 'asc' }
    });

    if (error) throw error;

    return normalizeSectorsList(
      data
        .filter((item) => !item.id && !item.name.startsWith("_"))
        .map((item) => ({ id: item.name, name: getSectorNameFromId(item.name) }))
    );
  } catch (error) {
    console.error("Erro ao inferir setores pelo Storage:", error.message);
    return [];
  }
}

async function writeSectorsToStorage(sectorList) {
  if (!supabase) {
    throw new Error(getSupabaseConfigMessage());
  }

  const body = Buffer.from(JSON.stringify({ setores: sectorList }, null, 2), "utf8");
  const { error } = await supabase.storage.from('setores').upload(sectorsConfigStoragePath, body, {
    contentType: "application/json; charset=utf-8",
    upsert: true
  });

  if (error) {
    throw error;
  }
}

async function ensureSectorStorageRoot(sectorId) {
  if (!supabase) {
    return;
  }

  const markerPath = joinRelativePath(sectorId, ".folder");
  const { error } = await supabase.storage.from('setores').upload(markerPath, Buffer.from(""), {
    contentType: "application/octet-stream",
    upsert: true
  });

  if (error) {
    throw error;
  }
}

async function readSectors() {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('setores').select('*');
      if (error) {
        console.error("Erro ao buscar setores no Supabase:", error.message);
        const storageSectors = await readSectorsFromStorage();
        const sectorList = storageSectors.length ? storageSectors : normalizeSectorsList(defaultSectors);
        updateSectorCache(sectorList);
        return sectorList;
      } else if (data && data.length > 0) {
        const sectorList = normalizeSectorsList(data);
        updateSectorCache(sectorList);
        logDebug(`[readSectors] Sectors cache updated from Supabase. Current sectors:`, Array.from(sectors));
        return sectorList;
      } else {
        logDebug("Tabela 'setores' do Supabase vazia. Usando Storage/default.");
        const storageSectors = await readSectorsFromStorage();
        const sectorList = storageSectors.length ? storageSectors : normalizeSectorsList(defaultSectors);
        updateSectorCache(sectorList);
        logDebug(`[readSectors] Sectors cache updated with default sectors (Supabase empty). Current sectors:`, Array.from(sectors));
        return sectorList;
      }
    } catch (e) {
      console.error("Erro inesperado ao interagir com Supabase (readSectors):", e.message);
      const storageSectors = await readSectorsFromStorage();
      const sectorList = storageSectors.length ? storageSectors : normalizeSectorsList(defaultSectors);
      updateSectorCache(sectorList);
      logDebug(`[readSectors] Sectors cache updated with default sectors (Supabase error). Current sectors:`, Array.from(sectors));
      return sectorList;
    }
  }

  // Fallback to local JSON if Supabase not configured or failed
  let sectorList = [];
  try {
    const data = await readJson(path.join(rootDir, "dados", "setores.json"), { setores: defaultSectors });
    sectorList = normalizeSectorsList(data && Array.isArray(data.setores) ? data.setores : defaultSectors);
  } catch (err) {
    console.error("Erro ao ler setores do arquivo local:", err.message);
    sectorList = normalizeSectorsList(defaultSectors);
  }
  updateSectorCache(sectorList);
  logDebug(`[readSectors] Sectors cache updated from local/default. Current sectors:`, Array.from(sectors));
  return sectorList;
}

async function writeSectors(sectorList) {
  const normalizedSectors = normalizeSectorsList(sectorList);
  if (supabase) {
    const { error } = await supabase.from('setores').upsert(normalizedSectors);

    if (error) {
      console.error("Erro ao salvar setores na tabela Supabase:", error.message);
    }

    await writeSectorsToStorage(normalizedSectors);
  } else {
    if (isServerless) {
      throw new Error(getSupabaseConfigMessage());
    }

    await writeJson(path.join(rootDir, "dados", "setores.json"), { setores: normalizedSectors });
  }
  updateSectorCache(normalizedSectors);
  return normalizedSectors;
}

function sanitizeAuditValue(value, key = "") {
  const normalizedKey = String(key || "").toLowerCase();

  if (/(senha|password|token|secret|service_role|anon_key|key|authorization|uploadurl|signedurl|content)/.test(normalizedKey)) {
    return "[redacted]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return `[buffer:${value.length}]`;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeAuditValue(item, key));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, itemValue]) => typeof itemValue !== "function")
        .map(([itemKey, itemValue]) => [itemKey, sanitizeAuditValue(itemValue, itemKey)])
    );
  }

  if (typeof value === "string" && value.length > 500) {
    return `${value.slice(0, 500)}...`;
  }

  return value;
}

function normalizeAuditLogEntry(entry) {
  return {
    id: String(entry?.id || crypto.randomUUID()),
    createdAt: String(entry?.createdAt || new Date().toISOString()),
    status: String(entry?.status || "success"),
    statusCode: Number(entry?.statusCode) || 200,
    action: String(entry?.action || "request"),
    method: String(entry?.method || ""),
    path: String(entry?.path || ""),
    resource: String(entry?.resource || ""),
    actor: publicAuditActor(entry?.actor),
    details: sanitizeAuditValue(entry?.details || {}),
    ip: String(entry?.ip || ""),
    userAgent: String(entry?.userAgent || "")
  };
}

async function readAuditLogsFromStorage() {
  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase.storage.from('setores').download(auditLogsStoragePath);

    if (error) {
      logDebug("Log de auditoria no Storage nao encontrado:", error.message);
      return [];
    }

    const text = Buffer.from(await data.arrayBuffer()).toString("utf8");
    const parsed = JSON.parse(text);
    const logs = Array.isArray(parsed?.logs) ? parsed.logs : [];
    return logs.map(normalizeAuditLogEntry);
  } catch (error) {
    console.error("Erro ao ler log de auditoria:", error.message);
    return [];
  }
}

async function writeAuditLogsToStorage(logs) {
  if (!supabase) {
    throw new Error(getSupabaseConfigMessage());
  }

  const body = Buffer.from(JSON.stringify({ logs }, null, 2), "utf8");
  const { error } = await supabase.storage.from('setores').upload(auditLogsStoragePath, body, {
    contentType: "application/json; charset=utf-8",
    upsert: true
  });

  if (error) {
    throw error;
  }
}

async function readAuditLogs() {
  if (supabase) {
    return readAuditLogsFromStorage();
  }

  if (isServerless) {
    return [];
  }

  try {
    const content = await fs.readFile(auditLogsFilePath, "utf8");
    let data;
    let shouldRepairFile = false;

    try {
      data = JSON.parse(content);
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }

      const recovered = parseFirstJsonValue(content);

      if (!recovered) {
        throw error;
      }

      data = recovered.data;
      shouldRepairFile = true;
      console.warn(`Log de auditoria em ${auditLogsFilePath} continha JSON extra no final e foi recuperado.`);
    }

    const normalizedLogs = (Array.isArray(data?.logs) ? data.logs : []).map(normalizeAuditLogEntry);

    if (shouldRepairFile) {
      await writeJson(auditLogsFilePath, { logs: normalizedLogs });
    }

    return normalizedLogs;
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeJson(auditLogsFilePath, { logs: [] });
      return [];
    }

    throw error;
  }
}

async function writeAuditLogs(logs) {
  const normalizedLogs = logs.map(normalizeAuditLogEntry);

  if (supabase) {
    await writeAuditLogsToStorage(normalizedLogs);
    return normalizedLogs;
  }

  if (isServerless) {
    return normalizedLogs;
  }

  await writeJson(auditLogsFilePath, { logs: normalizedLogs });
  return normalizedLogs;
}

function getClientIp(request) {
  return String(
    request.headers["x-forwarded-for"] ||
    request.headers["x-real-ip"] ||
    request.socket?.remoteAddress ||
    ""
  ).split(",")[0].trim();
}

async function resolveAuditActor(request) {
  if (request.auditActor) {
    return publicAuditActor(request.auditActor);
  }

  const userId = Number(request.headers["x-user-id"]);

  if (userId) {
    try {
      const users = await readUsers();
      const user = users.find((item) => Number(item.id) === userId);

      if (user) {
        return publicAuditActor(user);
      }
    } catch (error) {
      logDebug("Nao foi possivel resolver usuario do log:", error.message);
    }

    return {
      id: userId,
      nome: `Usuário #${userId}`,
      usuario: String(userId),
      perfil: "desconhecido"
    };
  }

  return publicAuditActor(null);
}

function getAuditStatus(statusCode) {
  if (statusCode === 401 || statusCode === 403) {
    return "blocked";
  }

  if (statusCode >= 400) {
    return "failure";
  }

  return "success";
}

function inferAuditAction(method, pathname) {
  if (pathname === "/api/login") return "auth.login";
  if (pathname === "/api/logs") return "logs.view";
  if (pathname === "/api/usuarios") return method === "POST" ? "users.create" : "users.list";
  if (/^\/api\/usuarios\/\d+$/.test(pathname)) return method === "DELETE" ? "users.delete" : "users.update";
  if (pathname === "/api/setores") return method === "POST" ? "sectors.create" : "sectors.list";
  if (/^\/api\/setores\/[^/]+$/.test(pathname)) return method === "DELETE" ? "sectors.delete" : "sectors.view";
  if (/\/explorer\/?$/.test(pathname)) return method === "POST" ? "folders.create" : "explorer.list";
  if (/\/upload\/?$/.test(pathname)) return "files.upload";
  if (/\/sign-upload\/?$/.test(pathname)) return "files.prepare_upload";
  if (/\/rename\/?$/.test(pathname)) return "items.rename";
  if (/\/delete\/?$/.test(pathname)) return "files.delete";
  if (/\/download\/?$/.test(pathname)) return "files.download";
  if (/\/preview\/?$/.test(pathname)) return "files.preview";
  if (/\/search\/?$/.test(pathname)) return "explorer.search";
  if (pathname === "/api/public/setores") return "public.sectors.list";
  return "request";
}

function getAuditResource(pathname) {
  if (pathname.includes("/usuarios")) return "Usuários";
  if (pathname.includes("/setores")) return "Setores";
  if (pathname.includes("/logs")) return "Log";
  if (pathname.includes("/login")) return "Autenticação";
  return "API";
}

function getAuditRouteDetails(pathname, searchParams) {
  const details = {};
  const sectorMatch = pathname.match(/^\/api\/(?:public\/)?setores\/([^/]+)/);
  const userMatch = pathname.match(/^\/api\/usuarios\/(\d+)/);
  const queryPath = searchParams.get("path");
  const querySearch = searchParams.get("q");

  if (sectorMatch) {
    details.sectorId = decodeURIComponent(sectorMatch[1]);
  }

  if (userMatch) {
    details.userId = Number(userMatch[1]);
  }

  if (queryPath) {
    details.itemPath = queryPath;
  }

  if (querySearch) {
    details.search = querySearch;
  }

  return details;
}

async function appendAuditLog(request, { pathname, searchParams, statusCode }) {
  const appendOperation = auditLogWriteQueue.then(async () => {
    const actor = await resolveAuditActor(request);
    const routeDetails = getAuditRouteDetails(pathname, searchParams);
    const details = sanitizeAuditValue({
      ...routeDetails,
      ...(request.auditDetails || {}),
      payload: request.auditPayload
    });
    const logs = await readAuditLogs();
    const entry = normalizeAuditLogEntry({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: request.auditStatus || getAuditStatus(statusCode),
      statusCode,
      action: request.auditAction || inferAuditAction(request.method, pathname),
      method: request.method,
      path: pathname,
      resource: request.auditResource || getAuditResource(pathname),
      actor,
      details,
      ip: getClientIp(request),
      userAgent: request.headers["user-agent"] || ""
    });

    logs.push(entry);
    await writeAuditLogs(logs);
  });

  auditLogWriteQueue = appendOperation.catch(() => {});

  try {
    await appendOperation;
  } catch (error) {
    console.error("Erro ao registrar log de auditoria:", error.message);
  }
}

function attachAuditLogger(request, response, pathname, searchParams) {
  if (!pathname.startsWith("/api/")) {
    return;
  }

  response.once("finish", () => {
    appendAuditLog(request, {
      pathname,
      searchParams,
      statusCode: response.statusCode || 200
    });
  });
}

function nextUserId(users) {
  return users.reduce((highestId, user) => Math.max(highestId, Number(user.id) || 0), 0) + 1;
}

function hasActiveAdmin(users) {
  return users.some((user) => user.ativo && userIsAdmin(user));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > MAX_JSON_BODY_SIZE) {
      const error = new Error("Payload muito grande.");
      error.statusCode = 413;
      throw error;
    }

    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString("utf8").trim();

  if (!body) {
    return {};
  }

  try {
    const parsed = JSON.parse(body);
    request.auditPayload = sanitizeAuditValue(parsed);
    return parsed;
  } catch (parseError) {
    const error = new Error("JSON inválido.");
    error.statusCode = 400;
    throw error;
  }
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
    request.auditAction = request.auditAction || "auth.admin_denied";
    request.auditResource = request.auditResource || "Autorização";
    request.auditDetails = {
      ...(request.auditDetails || {}),
      userId: userId || null
    };
    sendJson(response, 403, { message: "Acesso restrito a administradores." });
    return null;
  }

  request.auditActor = user;
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
  logDebug(`[getSectorRoot] Checking for sectorId: ${sectorId}. Current sectors in cache:`, Array.from(sectors));
  if (!(sectors instanceof Set)) {
    console.error(`[getSectorRoot] 'sectors' is not a Set. Re-initializing defensively.`);
    sectors = new Set(defaultSectors.map(s => s.id)); // Defensive re-initialization
  }
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

function getExplorerPath(sectorId, relativePath = "") {
  const sectorRoot = getSectorRoot(sectorId);

  if (!sectorRoot) {
    return null;
  }

  const normalized = normalizeRelativePath(relativePath);

  if (normalized.error) {
    return null;
  }

  // In serverless, absolutePath is not meaningful for Supabase Storage
  // We only care about relativePath for Supabase Storage operations
  // No ambiente Vercel/Supabase, ignoramos a validação de caminho físico no disco
  // para evitar 404, já que o disco é somente-leitura e as pastas dinâmicas não existem.
  if (!isServerless) {
    const resolvedRoot = path.resolve(sectorRoot);
    const resolvedItem = path.resolve(sectorRoot, normalized.relativePath);
    const isInsideRoot = resolvedItem === resolvedRoot || resolvedItem.startsWith(`${resolvedRoot}${path.sep}`);

    if (!isInsideRoot) {
      return null;
    }
  }

  // Isolamos os arquivos de cada setor em pastas virtuais no bucket do Supabase
  const storagePath = [sectorId, normalized.relativePath].filter(Boolean).join("/");

  return {
    absolutePath: path.join(sectorRoot, normalized.relativePath),
    relativePath: normalized.relativePath,
    storagePath: storagePath
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

function emptyExplorerResult(current) {
  return {
    caminho: current.relativePath,
    pai: parentRelativePath(current.relativePath),
    itens: []
  };
}

function normalizeSearchValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function sortExplorerItems(items) {
  return items.sort((a, b) => {
    if (a.tipo !== b.tipo) {
      return a.tipo === "folder" ? -1 : 1;
    }

    return a.caminho.localeCompare(b.caminho, "pt-BR");
  });
}

function explorerItemMatchesSearch(item, query) {
  const normalizedQuery = normalizeSearchValue(query);

  if (!normalizedQuery) {
    return false;
  }

  const typeLabel = item.tipo === "folder" ? "pasta" : "arquivo";
  const extension = path.extname(item.nome || "");
  const searchableText = `${item.nome} ${item.caminho} ${typeLabel} ${extension}`;

  return normalizeSearchValue(searchableText).includes(normalizedQuery);
}

async function listSupabaseExplorerItemsRecursive(sectorId, relativePath = "") {
  const current = getExplorerPath(sectorId, relativePath);

  if (!current) {
    return null;
  }

  const { data, error } = await supabase.storage.from('setores').list(current.storagePath, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' }
  });

  if (error) {
    throw error;
  }

  const items = [];

  for (const item of (data || []).filter((entry) => entry.name !== ".folder")) {
    const itemPath = joinRelativePath(current.relativePath, item.name);
    const itemType = item.id ? "file" : "folder";
    const explorerItem = {
      id: itemPath,
      nome: item.name,
      tipo: itemType,
      caminho: itemPath,
      tamanho: item.metadata?.size || null,
      atualizadoEm: item.updated_at || item.created_at,
      criadoEm: item.created_at
    };

    items.push(explorerItem);

    if (itemType === "folder") {
      const children = await listSupabaseExplorerItemsRecursive(sectorId, itemPath);

      if (children) {
        items.push(...children);
      }
    }
  }

  return items;
}

async function listLocalExplorerItemsRecursive(sectorId, relativePath = "") {
  const current = getExplorerPath(sectorId, relativePath);

  if (!current) {
    return null;
  }

  let entries;

  try {
    const stat = await fs.stat(current.absolutePath);

    if (!stat.isDirectory()) {
      return null;
    }

    entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const items = [];

  for (const entry of entries) {
    const itemPath = joinRelativePath(current.relativePath, entry.name);
    const absolutePath = path.join(current.absolutePath, entry.name);
    const stat = await fs.stat(absolutePath);
    const itemType = entry.isDirectory() ? "folder" : "file";

    items.push({
      id: itemPath,
      nome: entry.name,
      tipo: itemType,
      caminho: itemPath,
      tamanho: itemType === "file" ? stat.size : null,
      atualizadoEm: stat.mtime.toISOString(),
      criadoEm: (stat.birthtime || stat.ctime).toISOString()
    });

    if (entry.isDirectory()) {
      const children = await listLocalExplorerItemsRecursive(sectorId, itemPath);

      if (children) {
        items.push(...children);
      }
    }
  }

  return items;
}

async function searchExplorerItems(sectorId, query) {
  const root = getExplorerPath(sectorId, "");

  if (!root) {
    return null;
  }

  const normalizedQuery = normalizeSearchValue(query);

  if (!normalizedQuery) {
    return emptyExplorerResult(root);
  }

  const allItems = supabase
    ? await listSupabaseExplorerItemsRecursive(sectorId)
    : await listLocalExplorerItemsRecursive(sectorId);

  if (!allItems) {
    return null;
  }

  return {
    caminho: "",
    pai: "",
    busca: query,
    itens: sortExplorerItems(allItems.filter((item) => explorerItemMatchesSearch(item, query)))
  };
}

async function listExplorerItems(sectorId, relativePath = "") {
  const current = getExplorerPath(sectorId, relativePath);
  if (!current) {
    return null;
  }

  if (supabase) {
    const { data, error } = await supabase.storage.from('setores').list(current.storagePath);
    
    if (error) throw error;

    const visibleItems = data.filter(item => item.name !== ".folder");

    return {
      caminho: current.relativePath,
      pai: parentRelativePath(current.relativePath),
      itens: visibleItems.map(item => ({
        id: joinRelativePath(current.relativePath, item.name),
        nome: item.name,
        tipo: item.id ? "file" : "folder",
        caminho: joinRelativePath(current.relativePath, item.name), // Path relativo ao setor para o UI
        tamanho: item.metadata?.size || null,
        atualizadoEm: item.updated_at || item.created_at,
        criadoEm: item.created_at
      })).sort((a, b) => (a.tipo === b.tipo ? a.nome.localeCompare(b.nome) : a.tipo === "folder" ? -1 : 1))
    };
    // If data is empty, it will return { itens: [] }, which is not null.
  }

  try {
    const stat = await fs.stat(current.absolutePath);

    if (!stat.isDirectory()) {
      return null;
    }
    // ... rest of local filesystem logic
  } catch (error) {
    if (error.code === "ENOENT") {
      if (isServerless && !current.relativePath) {
        return emptyExplorerResult(current);
      }

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
    const { data, error } = await supabase.storage.from('setores').download(item.storagePath);
    if (error) {
      sendJson(response, 404, { message: "Arquivo não encontrado no Storage." });
      return;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    const extension = path.extname(item.relativePath).toLowerCase();
    const filename = path.basename(item.relativePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Content-Length": buffer.length,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      ...securityHeaders,
      ...corsHeaders
    });
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
      ...securityHeaders,
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
    const { data, error } = await supabase.storage.from('setores').download(item.storagePath);
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

async function handleLogin(request, response) {
  request.auditAction = "auth.login";
  request.auditResource = "Autenticação";
  const payload = await readBody(request);
  const usuario = String(payload.usuario || "").trim().toLowerCase();
  const senha = String(payload.senha || "");
  request.auditDetails = { usuario };
  const users = await readUsers();
  const hashedPassword = hashPassword(senha);

  const user = users.find((item) => {
    // Aceita senha em texto puro (migração) ou hash
    return item.ativo && item.usuario.toLowerCase() === usuario && (item.senha === senha || item.senha === hashedPassword);
  });

  if (!user) {
    request.auditActor = { nome: usuario || "Tentativa sem usuário", usuario, perfil: "desconhecido" };
    sendJson(response, 401, { message: "Usuário ou senha inválidos." });
    return;
  }

  request.auditActor = user;
  sendJson(response, 200, { usuario: publicUser(user) });
}

async function handleLogsApi(request, response, pathname) {
  request.auditAction = "logs.view";
  request.auditResource = "Log";

  const admin = await requireAdmin(request, response);

  if (!admin) {
    return;
  }

  if (request.method === "GET" && (pathname === "/api/logs" || pathname === "/api/logs/")) {
    const logs = await readAuditLogs();
    const orderedLogs = logs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    sendJson(response, 200, { logs: orderedLogs });
    return;
  }

  sendJson(response, 405, { message: "Método não permitido." });
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

    try {
      await writeUsers(nextUsers);
    } catch (error) {
      console.error("Erro ao criar usuario:", error.message);
      sendJson(response, error.statusCode || error.status || 500, {
        message: !supabaseServiceRoleKey ? getSupabaseConfigMessage() : "Nao foi possivel salvar o usuario."
      });
      return;
    }

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

    try {
      await writeUsers(nextUsers);
    } catch (error) {
      console.error("Erro ao atualizar usuario:", error.message);
      sendJson(response, error.statusCode || error.status || 500, {
        message: !supabaseServiceRoleKey ? getSupabaseConfigMessage() : "Nao foi possivel salvar o usuario."
      });
      return;
    }

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

    try {
      await writeUsers(nextUsers);
    } catch (error) {
      console.error("Erro ao excluir usuario:", error.message);
      sendJson(response, error.statusCode || error.status || 500, {
        message: !supabaseServiceRoleKey ? getSupabaseConfigMessage() : "Nao foi possivel excluir o usuario."
      });
      return;
    }

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
  const searchMatch = pathname.match(/^\/api\/setores\/([^/]+)\/search$/);
  const uploadMatch = pathname.match(/^\/api\/setores\/([^/]+)\/upload$/);
  const renameMatch = pathname.match(/^\/api\/setores\/([^/]+)\/rename$/);
  const deleteFileMatch = pathname.match(/^\/api\/setores\/([^/]+)\/delete$/);
  const downloadMatch = pathname.match(/^\/api\/setores\/([^/]+)\/download$/);
  const previewMatch = pathname.match(/^\/api\/setores\/([^/]+)\/preview$/);

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

    if (isServerless && !supabase) {
      sendJson(response, 400, { message: getSupabaseConfigMessage() });
      return;
    }

    const sectorList = await readSectors();

    if (sectorList.some((sector) => sector.id === validation.sector.id)) {
      sendJson(response, 409, { message: "Ja existe um setor com esse nome." });
      return;
    }

    const sectorRoot = path.join(sectorsDir, validation.sector.id);

    if (!isServerless) {
      try {
        await fs.mkdir(sectorRoot);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }

    let nextSectors;
    try {
      nextSectors = await writeSectors([...sectorList, validation.sector]);
      await ensureSectorStorageRoot(validation.sector.id);
    } catch (error) {
      console.error("Erro ao criar setor:", error.message);
      sendJson(response, error.statusCode || error.status || 500, {
        message: !supabaseServiceRoleKey ? getSupabaseConfigMessage() : "Nao foi possivel salvar o setor."
      });
      return;
    }

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

    if (isServerless && !supabase) {
      sendJson(response, 400, { message: getSupabaseConfigMessage() });
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

    if (!isServerless) {
      await fs.rm(resolvedSectorRoot, { recursive: true, force: true });
    }

    let nextSectors;
    try {
      nextSectors = await writeSectors(sectorList.filter((item) => item.id !== sector.id));
    } catch (error) {
      console.error("Erro ao excluir setor:", error.message);
      sendJson(response, error.statusCode || error.status || 500, {
        message: !supabaseServiceRoleKey ? getSupabaseConfigMessage() : "Nao foi possivel excluir o setor."
      });
      return;
    }

    sendJson(response, 200, {
      ok: true,
      setores: nextSectors.map(publicSector)
    });
    return;
  }

  if (explorerMatch && request.method === "GET") {
    const sectorId = decodeURIComponent(explorerMatch[1]);

    // Garante que o cache de setores esteja populado se o ID não for encontrado (Serverless)
    if (!sectors.has(sectorId)) {
      await readSectors();
    }

    const currentPath = searchParams.get("path") || "";
    const result = await listExplorerItems(sectorId, currentPath);

    if (!result) {
      sendJson(response, 404, { message: "Pasta nao encontrada." });
      return;
    }

    sendJson(response, 200, result);
    return;
  }

  if (searchMatch && request.method === "GET") {
    const sectorId = decodeURIComponent(searchMatch[1]);

    if (!sectors.has(sectorId)) {
      await readSectors();
    }

    const query = searchParams.get("q") || "";
    const result = await searchExplorerItems(sectorId, query);

    if (!result) {
      sendJson(response, 404, { message: "Setor não encontrado." });
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

    if (supabase) {
      // Supabase Storage is virtual; create a hidden marker so empty folders can be listed.
      const placeholderPath = joinRelativePath(
        joinRelativePath(current.storagePath, nameValidation.itemName),
        ".folder"
      );
      const { error } = await supabase.storage.from('setores').upload(placeholderPath, Buffer.from(""), {
        contentType: "application/octet-stream",
        upsert: false
      });

      if (error) {
        if (String(error.message || "").toLowerCase().includes("already exists")) {
          sendJson(response, 409, { message: "Ja existe um item com esse nome nesta pasta." });
          return;
        }

        throw error;
      }

      sendJson(response, 201, { ok: true });
      return;
    }

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
      sendJson(response, 400, { message: getSupabaseConfigMessage() });
      return;
    }

    const current = getExplorerPath(sectorId, currentPath);
    const nameValidation = validateItemName(fileName);

    if (!current) {
      sendJson(response, 404, { message: "Pasta nao encontrada." });
      return;
    }

    if (nameValidation.error) {
      sendJson(response, 400, { message: "Selecione um arquivo com nome valido." });
      return;
    }

    const fullPath = joinRelativePath(current.storagePath, nameValidation.itemName);
    
    const { data, error } = await supabase.storage.from('setores').createSignedUploadUrl(fullPath, {
      upsert: true
    });

    if (error) {
      console.error("Erro ao gerar URL assinada de upload:", error.message);
      sendJson(response, error.statusCode || error.status || 500, {
        message: !supabaseServiceRoleKey ? getSupabaseConfigMessage() : "Nao foi possivel preparar o upload no Storage."
      });
      return;
    }

    sendJson(response, 200, {
      uploadUrl: data.signedUrl,
      token: data.token,
      path: data.path,
      contentType: payload.contentType || mimeTypes[path.extname(fullPath).toLowerCase()] || "application/octet-stream"
    });
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

    if (isServerless && !supabase) {
      sendJson(response, 400, { message: getSupabaseConfigMessage() });
      return;
    }

    let body;
    try {
      body = await readRawBody(request, MAX_BODY_SIZE);
    } catch (error) {
      if (error.message === "Arquivo muito grande.") {
        sendJson(response, 413, { message: "Arquivo muito grande para upload pela API. Use o upload direto para o Storage." });
        return;
      }

      throw error;
    }

    const upload = parseMultipartFile(request, body);
    const nameValidation = validateItemName(upload?.filename);

    if (!upload || nameValidation.error) {
      sendJson(response, 400, { message: "Selecione um arquivo com nome valido." });
      return;
    }

    if (supabase) {
      const storagePath = joinRelativePath(current.storagePath, nameValidation.itemName);
      const fileExtension = path.extname(storagePath).toLowerCase();
      const contentType = mimeTypes[fileExtension] || "application/octet-stream";
      
      const { error } = await supabase.storage.from('setores').upload(storagePath, upload.content, { 
        contentType,
        upsert: true 
      });

      if (error) {
        console.error("Erro ao enviar arquivo para o Supabase Storage:", error.message);
        sendJson(response, error.statusCode || error.status || 500, {
          message: !supabaseServiceRoleKey ? getSupabaseConfigMessage() : "Nao foi possivel enviar o arquivo para o Storage."
        });
        return;
      }

      sendJson(response, 201, { ok: true });
      return;
    }

    try {
      const currentStat = await fs.stat(current.absolutePath);
      if (!currentStat.isDirectory()) {
        sendJson(response, 400, { message: "O destino selecionado nao e uma pasta." });
        return;
      }
      const targetPath = path.join(current.absolutePath, nameValidation.itemName);
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
      console.warn(`[handleFoldersApi PUT rename] Item not found for path: ${payload.caminho}`);
      sendJson(response, 404, { message: "Item nao encontrado." });
      return;
    }

    if (nameValidation.error) {
      sendJson(response, 400, { message: nameValidation.error });
      return;
    }

    if (supabase) {
      const newPath = joinRelativePath(parentRelativePath(item.storagePath), nameValidation.itemName);
      logDebug(`[handleFoldersApi PUT rename] Supabase: Moving '${item.storagePath}' to '${newPath}'`);
      const { error } = await supabase.storage.from('setores').move(item.storagePath, newPath);
      if (error) throw error;
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
      console.warn(`[handleFoldersApi DELETE file] Item not found for path: ${filePath}`);
      sendJson(response, 404, { message: "Arquivo nao encontrado." });
      return;
    }

    if (supabase) {
      const { error } = await supabase.storage.from('setores').remove([item.storagePath]);
      if (error) throw error;
      sendJson(response, 200, { ok: true });
      logDebug(`[handleFoldersApi DELETE file] Supabase: Removed '${item.storagePath}'`);
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

  sendJson(response, 404, { message: "Rota nao encontrada." });
}

async function handlePublicFoldersApi(request, response, pathname, searchParams) {
  const sectorsCollection = pathname === "/api/public/setores" || pathname === "/api/public/setores/";
  const explorerMatch = pathname.match(/^\/api\/public\/setores\/([^/]+)\/explorer\/?$/);
  const searchMatch = pathname.match(/^\/api\/public\/setores\/([^/]+)\/search\/?$/);
  const downloadMatch = pathname.match(/^\/api\/public\/setores\/([^/]+)\/download\/?$/);
  const previewMatch = pathname.match(/^\/api\/public\/setores\/([^/]+)\/preview\/?$/);

  if (sectorsCollection && request.method === "GET") {
    const sectorList = await readSectors();
    sendJson(response, 200, { setores: sectorList.map(publicSector) });
    return;
  }

  if (explorerMatch && request.method === "GET") {
    const sectorId = decodeURIComponent(explorerMatch[1]);
    logDebug(`[handlePublicFoldersApi] Explorer GET for sectorId: ${sectorId}`);
    logDebug(`[handlePublicFoldersApi] sectors.has(${sectorId}) before readSectors: ${sectors.has(sectorId)}`);

    // Garante que o cache de setores esteja populado se o ID não for encontrado (Serverless)
    if (!sectors.has(sectorId)) {
      await readSectors();
    }
    const currentPath = searchParams.get("path") || "";
    const result = await listExplorerItems(sectorId, currentPath);

    if (!result) {
      console.warn(`[handlePublicFoldersApi GET explorer] listExplorerItems returned null for sectorId: ${sectorId}, path: ${currentPath}`);
      sendJson(response, 404, { message: "Pasta nao encontrada." });
      return;
    }

    sendJson(response, 200, result);
    return;
  }

  if (searchMatch && request.method === "GET") {
    const sectorId = decodeURIComponent(searchMatch[1]);

    if (!sectors.has(sectorId)) {
      await readSectors();
    }

    const query = searchParams.get("q") || "";
    const result = await searchExplorerItems(sectorId, query);

    if (!result) {
      sendJson(response, 404, { message: "Setor não encontrado." });
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
  const cleanPath = appShellRoutes.has(pathname)
    ? "/index.html"
    : staticPathAliases.get(pathname) || pathname;
  const extension = path.extname(cleanPath).toLowerCase();

  logDebug(`[serveStatic] Serving static file: ${cleanPath}, extension: ${extension}`);
  if (!mimeTypes[extension]) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      ...securityHeaders
    });
    response.end("Arquivo não encontrado.");
    return;
  }

  const filePath = path.resolve(publicDir, `.${cleanPath}`);

  const resolvedPublicDir = path.resolve(publicDir);

  if (!filePath.startsWith(`${resolvedPublicDir}${path.sep}`)) {
    response.writeHead(403, {
      "Content-Type": "text/plain; charset=utf-8",
      ...securityHeaders
    });
    response.end("Acesso negado.");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension],
      "Cache-Control": "no-store",
      ...securityHeaders
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.warn(`[serveStatic] File not found: ${filePath}`);
      response.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        ...securityHeaders
      });
      response.end("Arquivo não encontrado.");
      return;
    }

    throw error;
  }
}

function redirectLegacyAppRoute(response, pathname, searchParams) {
  const destinationPath = appRouteRedirects.get(pathname);

  if (!destinationPath) {
    return false;
  }

  const search = searchParams.toString();
  response.writeHead(308, {
    "Location": `${destinationPath}${search ? `?${search}` : ""}`,
    "Cache-Control": "no-store",
    ...securityHeaders
  });
  response.end();
  return true;
}

async function handleRequest(request, response) {
  logDebug(`[handleRequest] Invoked for URL: ${request.url}`);
  logDebug(`[handleRequest] isServerless: ${isServerless}`);
  logDebug(`[handleRequest] Supabase client initialized: ${!!supabase}`);
  logDebug(`[handleRequest] Current sectors (before readSectors):`, Array.from(sectors));
  // Usa um fallback para o host para evitar erros de construção de URL no Vercel
  const { pathname, searchParams } = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  attachAuditLogger(request, response, pathname, searchParams);

  try {
    // Garantir sincronização de cache em ambiente Serverless
    if (isServerless) {
      await readSectors();
      logDebug(`[handleRequest] Current sectors (after readSectors):`, Array.from(sectors));
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...securityHeaders,
        ...corsHeaders
      });
      response.end();
      return;
    }

    if (request.method === "POST" && pathname === "/api/login") {
      await handleLogin(request, response);
      return;
    }

    if (pathname.startsWith("/api/logs")) {
      await handleLogsApi(request, response, pathname);
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

    if (redirectLegacyAppRoute(response, pathname, searchParams)) {
      return;
    }

    await serveStatic(request, response, pathname);
  } catch (error) {
    console.error(error);
    logDebug(`[handleRequest] Error details: ${error.stack}`);
    const statusCode = error.statusCode || error.status || (error.code === 'ENOENT' ? 404 : 500);
    const message = statusCode === 404
      ? "Recurso não encontrado"
      : statusCode >= 500
        ? "Erro interno do servidor."
        : error.message;
    request.auditDetails = {
      ...(request.auditDetails || {}),
      error: error.message
    };
    sendJson(response, statusCode, { 
      message: message,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

async function start() {
  logDebug("[start] Initializing server...");
  // Validação de ambiente crítica
  if (isServerless && (!supabaseUrl || !supabaseKey)) {
    console.warn("Aviso: Supabase nao configurado. O sistema funcionara apenas em modo leitura estatica.");
  }

  if (isServerless && supabase && !supabaseServiceRoleKey) {
    console.warn("Aviso: SUPABASE_SERVICE_ROLE_KEY nao configurada. Uploads dependem das policies do Storage.");
  }

  // No Vercel, o ambiente serverless não requer o início manual do servidor via .listen()
  // O Vercel gerencia o ciclo de vida da requisição automaticamente.
  if (isServerless) return;

  await ensureSectorRoots();

  const server = http.createServer(handleRequest);
  
  // No Vercel, o host é gerenciado pela plataforma. Localmente, 0.0.0.0 é mais flexível que 127.0.0.1
  const host = isServerless ? undefined : "0.0.0.0";

  server.listen(port, host, () => {
    console.log(`[start] Server listening on port ${port}`);
    console.log(`Servidor iniciado na porta ${port}`);
    if (supabase) console.log("Conectado ao Supabase Storage/Database.");
  });
}

start();

// Exporta o handler para o Vercel
module.exports = handleRequest;
