const fs = require("fs");
const path = require("path");

function loadLocalEnv(rootDir = process.cwd()) {
  if (process.env.VERCEL === "1") {
    return;
  }

  const envPath = path.join(rootDir, ".env");

  try {
    const content = fs.readFileSync(envPath, "utf8");

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

      if (!match || process.env[match[1]] !== undefined) {
        continue;
      }

      const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Nao foi possivel carregar o arquivo .env:", error.message);
    }
  }
}

function createRuntimeConfig(rootDir = process.cwd()) {
  loadLocalEnv(rootDir);

  const dataDir = path.join(rootDir, "dados");
  const publicDir = path.join(rootDir, "public");
  const sectorsDir = path.join(dataDir, "setores");
  const isServerless = process.env.VERCEL === "1";

  return {
    rootDir,
    dataDir,
    publicDir,
    sectorsDir,
    port: Number(process.env.PORT) || 3000,
    isServerless,
    maxBodySize: isServerless ? 4.5 * 1024 * 1024 : 50 * 1024 * 1024,
    maxJsonBodySize: 1024 * 1024,
    debugLogsEnabled: /^(1|true|yes)$/i.test(process.env.DEBUG_LOGS || "")
  };
}

module.exports = {
  createRuntimeConfig,
  loadLocalEnv
};
