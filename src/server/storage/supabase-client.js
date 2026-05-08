const { createClient } = require("@supabase/supabase-js");

function createSupabaseContext() {
  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || "").trim();
  const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const supabaseKey = supabaseServiceRoleKey || supabaseAnonKey;

  let supabase = null;
  let supabaseInitError = "";

  if (supabaseUrl && supabaseKey) {
    try {
      new URL(supabaseUrl);
      supabase = createClient(supabaseUrl, supabaseKey);
    } catch (error) {
      supabaseInitError = "SUPABASE_URL invalida ou malformada.";
      console.error("Erro ao inicializar Supabase: URL invalida ou malformada.");
    }
  }

  function getSupabaseConfigMessage() {
    const missing = [];

    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!supabaseKey) missing.push("SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_ANON_KEY");

    if (missing.length > 0) {
      return `Cloud Storage nao configurado. Configure no Vercel: ${missing.join(", ")}.`;
    }

    if (!supabase && supabaseInitError) {
      return `Cloud Storage nao configurado. ${supabaseInitError}`;
    }

    if (!supabase) {
      return "Cloud Storage nao configurado. Verifique as variaveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Vercel.";
    }

    if (!supabaseServiceRoleKey) {
      return "Operacao bloqueada pelo Storage. Configure SUPABASE_SERVICE_ROLE_KEY no Vercel ou ajuste as policies do bucket setores.";
    }

    return "Cloud Storage nao configurado.";
  }

  return {
    getSupabaseConfigMessage,
    supabase,
    supabaseAnonKey,
    supabaseKey,
    supabaseServiceRoleKey,
    supabaseUrl
  };
}

module.exports = {
  createSupabaseContext
};
