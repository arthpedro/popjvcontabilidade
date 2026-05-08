const appShellRoutes = new Set([
  "/",
  "/index.html",
  "/arquivos",
  "/arquivos/",
  "/arquivos.html",
  "/setores",
  "/setores/",
  "/setores.html",
  "/staff",
  "/staff/",
  "/staff.html"
]);

const appRouteRedirects = new Map([
  ["/index.html", "/"],
  ["/arquivos.html", "/arquivos"],
  ["/setores.html", "/setores"],
  ["/staff.html", "/staff"]
]);

const staticPathAliases = new Map([
  ["/styles.css", "/assets/css/styles.css"],
  ["/script.js", "/assets/js/app.js"],
  ["/img/logo.jpg", "/assets/img/logo.jpg"]
]);

const defaultUsersData = [
  {
    id: 1,
    nome: "Administrador",
    usuario: "admin",
    senha: "admin123",
    perfil: "administrador",
    ativo: true
  },
  {
    id: 2,
    nome: "T.I",
    usuario: "ti",
    senha: "ti123",
    perfil: "administrador",
    ativo: true
  }
];

const defaultSectors = [
  { id: "departamento-pessoal", name: "Departamento Pessoal" },
  { id: "contabil", name: "Cont\u00e1bil" },
  { id: "fiscal", name: "Fiscal" },
  { id: "legalizacao-processos", name: "Legaliza\u00e7\u00e3o e Processos" },
  { id: "ti", name: "T.I" }
];

const storagePaths = {
  usersConfig: "_config/usuarios.json",
  sectorsConfig: "_config/setores.json",
  auditLogs: "_config/logs.json"
};

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

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

module.exports = {
  appRouteRedirects,
  appShellRoutes,
  corsHeaders,
  defaultSectors,
  defaultUsersData,
  mimeTypes,
  securityHeaders,
  staticPathAliases,
  storagePaths
};
