const crypto = require("crypto");

function publicUser(user) {
  return {
    id: user.id,
    nome: user.nome,
    usuario: user.usuario,
    perfil: user.perfil,
    ativo: user.ativo
  };
}

function publicAuditActor(user) {
  if (!user) {
    return {
      id: null,
      nome: "Público",
      usuario: "publico",
      perfil: "publico"
    };
  }

  const rawProfile = String(user.perfil || user.permissao || "").trim();
  const profile = ["publico", "desconhecido"].includes(rawProfile)
    ? rawProfile
    : resolveUserProfile(user);

  return {
    id: Number(user.id) || null,
    nome: String(user.nome || user.usuario || "Usuário").trim(),
    usuario: String(user.usuario || "").trim(),
    perfil: profile
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

function isPasswordHash(password) {
  return /^[a-f0-9]{64}$/i.test(String(password || "")) || String(password || "").startsWith("$2");
}

function normalizeUserForStorage(user, index = 0) {
  const normalized = normalizeUser(user, index);

  return {
    ...normalized,
    senha: isPasswordHash(normalized.senha) ? normalized.senha : hashPassword(normalized.senha)
  };
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

module.exports = {
  hashPassword,
  isPasswordHash,
  normalizeProfile,
  normalizeUser,
  normalizeUserForStorage,
  publicAuditActor,
  publicUser,
  resolveUserProfile,
  userIsAdmin
};
