// ==========================================================================
// --- Application State & Constants ---
// ==========================================================================

const sessionKey = "portalPopsUsuario";
const apiBaseUrl = window.location.protocol === "file:" ? "http://127.0.0.1:3000" : "";

let appSectors = [
  { id: "departamento-pessoal", name: "Departamento Pessoal" },
  { id: "contabil", name: "Contábil" },
  { id: "fiscal", name: "Fiscal" },
  { id: "legalizacao-processos", name: "Legalização e Processos" },
  { id: "ti", name: "T.I" }
];

const appPageByPath = {
  "/": "home",
  "/arquivos": "arquivos",
  "/arquivos/": "arquivos",
  "/setores": "setores",
  "/setores/": "setores",
  "/staff": "staff",
  "/staff/": "staff",
  "/index.html": "home",
  "/arquivos.html": "arquivos",
  "/setores.html": "setores",
  "/staff.html": "staff"
};

const appPageTitles = {
  home: "Portal de POPs",
  arquivos: "Pastas e arquivos",
  setores: "Setores",
  staff: "Area STAFF"
};

const appPagePaths = {
  home: "/",
  arquivos: "/arquivos",
  setores: "/setores",
  staff: "/staff"
};

let selectedSector = null;
let currentExplorerPath = "";
let selectedExplorerItem = null;
let explorerBackStack = [];
let explorerForwardStack = [];
let currentPreviewUrl = "";
let _lastFocusedElementForModal = null;
let _loginTrapHandler = null;
let cachedUsers = [];
let cachedLogs = [];
let currentExplorerItems = [];
let explorerSearchTimer = null;
let explorerSearchRequestId = 0;

// --- Utilities ---
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function normalizeSectorsList(sectors) {
  if (!Array.isArray(sectors)) {
    return [];
  }

  return sectors
    .map((sector) => ({
      id: String(sector.id || "").trim(),
      name: String(sector.name || sector.nome || "").trim()
    }))
    .filter((sector) => sector.id && sector.name);
}

function getCurrentPage() {
  return appPageByPath[window.location.pathname] || document.body.dataset.page || "home";
}

function setCurrentPageMetadata() {
  const page = getCurrentPage();

  document.body.dataset.page = page;
  document.title = page === "home" ? appPageTitles.home : `${appPageTitles[page] || "Novo"} - Portal de POPs`;
}

function getSidebarHref(sectorId) {
  if (getCurrentPage() === "arquivos") {
    return `#${sectorId}`;
  }

  return `${appPagePaths.arquivos}#${sectorId}`;
}

function renderSidebar() {
  const sidebar = document.querySelector("[data-sidebar]");

  if (!sidebar) {
    return;
  }

  const titleId = "sidebar-menu-title";
  const title = "Pastas e arquivos";
  const navItems = appSectors.map((sector) => {
    const isActive = getCurrentPage() === "arquivos" && window.location.hash === `#${sector.id}`;
    const sectorData = getCurrentPage() === "arquivos" ? ` data-sidebar-sector="${sector.id}"` : "";
    const sectorName = escapeHtml(sector.name);

    return `
        <a${isActive ? " class=\"active\"" : ""} href="${getSidebarHref(sector.id)}"${sectorData}>
          <span class="nav-icon">${getSectorIconSvg(sector.id)}</span>
          <span>${sectorName}</span>
        </a>`;
  }).join("");

    sidebar.innerHTML = `
        <a class="brand" href="${appPagePaths.home}" aria-label="Ir para a pagina inicial">
          <img src="/assets/img/logo.jpg" alt="Novo" class="brand-logo">
        </a>

        <hr class="sidebar-sep" />

        <h2 class="menu-title" id="${titleId}">${title}</h2>

        <nav class="nav" aria-labelledby="${titleId}">
  ${navItems}
        </nav>

        <hr class="sidebar-sep" />

        <div class="sidebar-footer" role="contentinfo">
          <small>
            Desenvolvido pelo setor de T.I. da JV Contabilidade — suporte: <span class="sidebar-email">pedroajvcontabilidade@gmail.com</span>
          </small>
        </div>`;
}

function renderExplorerToolbar({ editable = false } = {}) {
  const actions = editable ? `
              <div class="explorer-actions">
                <button class="secondary-button" type="button" data-upload-button disabled>Upload</button>
                <button class="secondary-button" type="button" data-new-folder-button disabled>Nova pasta</button>
                <button class="secondary-button" type="button" data-rename-button disabled>Renomear</button>
                <input class="sr-only" type="file" data-file-input multiple>
              </div>` : "";

  return `
            <div class="explorer-toolbar${editable ? " explorer-toolbar-editable" : ""}">
              <div class="explorer-toolbar-main">
                <div class="explorer-nav-buttons" aria-label="Navegação do explorador">
                  <button class="icon-button" type="button" aria-label="Voltar" title="Voltar" data-explorer-back disabled>&lt;</button>
                  <button class="icon-button" type="button" aria-label="Avancar" title="Avancar" data-explorer-forward disabled>&gt;</button>
                  <button class="icon-button" type="button" aria-label="Subir uma pasta" title="Subir uma pasta" data-explorer-up disabled>^</button>
                </div>

                <div class="explorer-path-tools">
                  <div class="explorer-address" data-explorer-address>Selecione um setor</div>
                  <label class="explorer-search">
                    <span class="sr-only">Buscar arquivos e pastas no setor</span>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
                      <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/>
                      <path d="M20 20l-3.4-3.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                    </svg>
                    <input type="search" placeholder="Buscar em todo o setor" autocomplete="off" data-explorer-search disabled>
                  </label>
${actions}
                </div>
              </div>
            </div>`;
}

function renderExplorerTable(emptyMessage) {
  return `
            <div class="explorer-table-wrap">
              <table class="explorer-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Tamanho</th>
                    <th>Modificado</th>
                  </tr>
                </thead>
                <tbody data-folder-list>
                  <tr>
                    <td colspan="4" class="explorer-empty">${emptyMessage}</td>
                  </tr>
                </tbody>
              </table>
            </div>`;
}

function renderExplorerPage({ editable = false } = {}) {
  const staffReturn = editable ? `
          <div class="explorer-window-header">
            <a class="secondary-button staff-back-link" href="${appPagePaths.staff}">Voltar ao STAFF</a>
          </div>` : "";
  const sectorPicker = editable ? `
          <aside class="explorer-sectors" aria-labelledby="explorer-sectors-title">
            <div class="explorer-sectors-header">
              <div class="explorer-sectors-title">
                <h2 id="explorer-sectors-title">Setores</h2>
              </div>
              <button class="new-sector-button explorer-sectors-add" type="button" data-sector-add>Novo setor</button>
            </div>
            <p class="sector-message" data-sector-message role="status"></p>
            <div class="explorer-sectors-body">
              <div class="sector-list" data-sector-list></div>
            </div>
          </aside>` : "";
  const emptyMessage = editable
    ? "Selecione um setor para acessar os arquivos."
    : "Selecione um setor no menu lateral para visualizar os arquivos.";

  return `
        <section class="explorer-window${editable ? "" : " explorer-window-readonly"}" aria-label="Explorador de arquivos dos setores">
${staffReturn}
${sectorPicker}
          <section class="explorer-panel" data-sector-root>
${renderExplorerToolbar({ editable })}
${renderExplorerTable(emptyMessage)}
          </section>
        </section>`;
}

function renderHomePage() {
  return `
        <section class="panel">
          <h2>Acesso aos procedimentos da JV Contabilidade</h2>
          <p>Este site centraliza o acesso aos POPs (Procedimentos Operacionais Padrão), facilitando a consulta e a execução das atividades de cada setor.</p>

          <p>Seu objetivo é promover uma rotina mais organizada, ágil e padronizada, garantindo que todos os times sigam as melhores práticas estabelecidas.</p>

          <p>Além disso, a plataforma contribui para a redução de erros, melhoria da comunicação interna e maior eficiência nos processos operacionais.</p>
        </section>`;
}

function renderStaffPage() {
  return `
        <section class="panel">
          <h2>Painel administrativo</h2>

          <div class="staff-actions">
            <button class="staff-action-button" type="button" data-users-open>
              <span class="staff-action-icon" aria-hidden="true">${getStaffActionIconSvg("users")}</span>
              <span>Usu&aacute;rios</span>
            </button>

            <button class="staff-action-button" type="button" data-sectors-page>
              <span class="staff-action-icon" aria-hidden="true">${getStaffActionIconSvg("sectors")}</span>
              <span>Setores</span>
            </button>

            <button class="staff-action-button" type="button" data-logs-open>
              <span class="staff-action-icon" aria-hidden="true">${getStaffActionIconSvg("logs")}</span>
              <span>Log</span>
            </button>
          </div>
        </section>`;
}

// --- Page Content Renderers ---
function renderPageContent() {
  const pageContent = document.querySelector("[data-page-content]");

  if (!pageContent) {
    return;
  }

  const page = getCurrentPage();
  pageContent.className = ["arquivos", "setores"].includes(page) ? "explorer-main" : "";

  const renderers = {
    home: renderHomePage,
    arquivos: () => renderExplorerPage(),
    setores: () => renderExplorerPage({ editable: true }),
    staff: renderStaffPage
  };

  pageContent.innerHTML = (renderers[page] || renderHomePage)();
}

function renderExplorerSectors() {
  const sectorList = document.querySelector("[data-sector-list]");

  if (!sectorList) {
    return;
  }

  sectorList.innerHTML = "";

  if (appSectors.length === 0) {
    const empty = document.createElement("p");
    empty.className = "sector-empty";
    empty.textContent = "Nenhum setor cadastrado.";
    sectorList.append(empty);
    return;
  }

  appSectors.forEach((sector) => {
    const row = document.createElement("div");
    const button = document.createElement("button");
    const icon = document.createElement("span");
    const name = document.createElement("span");

    row.className = "sector-item-row";
    button.className = "sector-item";
    button.type = "button";
    button.dataset.sectorId = sector.id;
    button.dataset.sectorName = sector.name;
    button.classList.toggle("active", selectedSector?.id === sector.id);

    icon.className = "sector-icon";
    icon.innerHTML = getSectorIconSvg(sector.id);
    name.className = "sector-name";
    name.textContent = sector.name;
    button.append(icon, name);
    row.append(button);

    if (getCurrentPage() === "setores") {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "sector-delete-button";
      deleteButton.dataset.sectorDelete = sector.id;
      deleteButton.setAttribute("aria-label", `Excluir setor ${sector.name}`);
      deleteButton.title = "Excluir setor";
      deleteButton.innerHTML = getTrashIconSvg();
      row.append(deleteButton);
    }

    sectorList.append(row);
  });
}

function renderTopbar() {
  const page = getCurrentPage();
  const title = appPageTitles[page] || document.title || 'Novo';

  const headers = document.querySelectorAll('[data-topbar]');

  if (headers.length === 0) {
    const existing = document.querySelectorAll('.topbar');
    existing.forEach((hdr) => {
      hdr.setAttribute('data-topbar', '');
    });
  }

  document.querySelectorAll('[data-topbar]').forEach((hdr) => {
    hdr.classList.add('topbar');
    hdr.innerHTML = `
      <h1>${title}</h1>
      <div class="topbar-right">
        <button class="icon-button theme-toggle" type="button" aria-label="Alternar tema" data-theme-toggle>
          <span class="theme-icon sun" aria-hidden="true">${getThemeIconSvg('sun')}</span>
          <span class="theme-icon moon is-hidden" aria-hidden="true">${getThemeIconSvg('moon')}</span>
        </button>

        <div class="user">
          <span class="user-name is-hidden" data-user-name></span>
          <button class="login-button" type="button" data-open-login>Login</button>
          <button class="logout-button is-hidden" type="button" data-logout>Sair</button>
          <button class="staff-button is-hidden" type="button" data-staff>STAFF</button>
        </div>
      </div>
    `;
  });
}

function ensureLoginModalExists() {
  if (document.querySelector('[data-login-modal]')) return;

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('data-login-modal', '');
  modal.setAttribute('aria-hidden', 'true');

  modal.innerHTML = `
    <div class="modal-backdrop" data-close-login></div>
    <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <button class="modal-close" type="button" aria-label="Fechar login" data-close-login>&times;</button>

      <h2 id="login-title">Login</h2>

      <form class="login-form" data-login-form>
        <label for="login-user">Usuário</label>
        <input id="login-user" name="usuario" type="text" autocomplete="username" required>

        <label for="login-password">Senha</label>
        <input id="login-password" name="senha" type="password" autocomplete="current-password" required>

        <p class="login-message" data-login-message role="alert"></p>

        <button class="submit-button" type="submit">Entrar</button>
      </form>
    </div>`;

  document.body.appendChild(modal);
}

// --- Theme toggle helpers ---
function getSavedTheme() {
  try {
    return localStorage.getItem('portalTheme') || 'light';
  } catch (e) {
    return 'light';
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
    root.style.colorScheme = 'dark';
  } else {
    root.removeAttribute('data-theme');
    root.style.colorScheme = 'light';
  }
}

function updateThemeToggleIcons(theme) {
  const btn = document.querySelector('[data-theme-toggle]');
  if (!btn) return;
  const sun = btn.querySelector('.sun');
  const moon = btn.querySelector('.moon');
  if (theme === 'dark') {
    sun.classList.add('is-hidden');
    moon.classList.remove('is-hidden');
  } else {
    moon.classList.add('is-hidden');
    sun.classList.remove('is-hidden');
  }
}

function toggleTheme() {
  const current = getSavedTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('portalTheme', next); } catch (e) {}
  applyTheme(next);
  updateThemeToggleIcons(next);
}

function initThemeToggle() {
  const saved = getSavedTheme();
  applyTheme(saved);
  updateThemeToggleIcons(saved);
  const btn = document.querySelector('[data-theme-toggle]');
  if (!btn) return;
  on(btn, 'click', (e) => {
    e.preventDefault();
    toggleTheme();
  });
}

// ==========================================================================
// --- API Client Layer ---
// ==========================================================================

function on(target, eventName, handler) {
  if (target) {
    target.addEventListener(eventName, handler);
  }
}

function setModalOpen(modal, isOpen) {
  if (!modal) {
    return false;
  }

  modal.classList.toggle("is-open", isOpen);
  modal.setAttribute("aria-hidden", String(!isOpen));
  return true;
}

function setMessage(element, message = "", { success = false, error = false } = {}) {
  if (!element) {
    return;
  }

  element.textContent = message;
  element.classList.toggle("success", success);
  element.classList.toggle("error", error);
}

function setUserFormVisible(isVisible) {
  if (!userForm) {
    return;
  }

  setModalOpen(userFormModal, isVisible);
}

function getSectorApiPath({ publicAccess = isReadOnlyExplorer } = {}) {
  return publicAccess ? "/api/public/setores" : "/api/setores";
}

function getExplorerPathUrl(sectorId, action, itemPath, { publicAccess = isReadOnlyExplorer } = {}) {
  const basePath = getSectorApiPath({ publicAccess });
  return `${apiBaseUrl}${basePath}/${encodeURIComponent(sectorId)}/${action}?path=${encodeURIComponent(itemPath)}`;
}

function ensureUsersModalExists() {
  if (getCurrentPage() !== "staff" || document.querySelector("[data-users-modal]")) {
    return;
  }

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.setAttribute("data-users-modal", "");
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `
    <div class="modal-backdrop" data-close-users></div>
    <div class="modal-dialog users-dialog" role="dialog" aria-modal="true" aria-labelledby="users-title">
      <button class="modal-close" type="button" aria-label="Fechar usuarios" data-close-users>&times;</button>

      <div class="users-heading">
        <div class="users-title-block">
          <h2 id="users-title">Usu&aacute;rios</h2>
        </div>
      </div>

      <div class="users-body">
        <div class="users-toolbar">
          <div class="users-summary" aria-label="Resumo de usuarios">
            <div class="users-stat">
              <strong data-users-count>0</strong>
              <span>Total</span>
            </div>
            <div class="users-stat">
              <strong data-users-admin-count>0</strong>
              <span>Administradores</span>
            </div>
            <div class="users-stat">
              <strong data-users-active-count>0</strong>
              <span>Ativos</span>
            </div>
            <div class="users-stat">
              <strong data-users-inactive-count>0</strong>
              <span>Inativos</span>
            </div>
          </div>

          <button class="new-user-button users-toolbar-new" type="button" data-user-new>Novo usu&aacute;rio</button>

          <label class="users-search">
            <span class="sr-only">Buscar usuario</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
              <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/>
              <path d="M20 20l-3.4-3.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            <input type="search" data-users-search placeholder="Buscar por nome ou login" autocomplete="off">
          </label>
        </div>

        <p class="users-notice" data-users-notice role="status"></p>

        <div class="users-layout">
          <div class="users-table-wrap">
            <table class="users-table">
              <thead>
                <tr>
                  <th>Usu&aacute;rio</th>
                  <th>Login</th>
                  <th>Acesso</th>
                  <th>Status</th>
                  <th>A&ccedil;&otilde;es</th>
                </tr>
              </thead>
              <tbody data-users-list></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;

  document.body.append(modal);

  const formModal = document.createElement("div");
  formModal.className = "modal user-form-modal";
  formModal.setAttribute("data-user-form-modal", "");
  formModal.setAttribute("aria-hidden", "true");
  formModal.innerHTML = `
    <div class="modal-backdrop" data-user-cancel></div>
    <div class="modal-dialog user-form-dialog" role="dialog" aria-modal="true" aria-labelledby="user-form-title">
      <button class="modal-close" type="button" aria-label="Fechar formulario de usuario" data-user-cancel>&times;</button>
      <form class="user-form" data-user-form>
        <div class="user-form-heading">
          <h3 id="user-form-title" data-user-form-title>Novo usu&aacute;rio</h3>
        </div>
        <input type="hidden" data-form-id>

        <div class="form-grid">
          <div class="field">
            <label for="user-name-field">Nome</label>
            <input id="user-name-field" type="text" data-form-name required>
          </div>

          <div class="field">
            <label for="user-login-field">Usu&aacute;rio</label>
            <input id="user-login-field" type="text" data-form-login required>
          </div>
        </div>

        <div class="field">
          <label for="user-password-field">Senha</label>
          <input id="user-password-field" type="password" data-form-password required>
        </div>

        <div class="field">
          <label for="user-profile-field">Tipo de usu&aacute;rio</label>
          <select id="user-profile-field" data-form-profile>
            <option value="comum">Usu&aacute;rio comum</option>
            <option value="administrador">Administrador</option>
          </select>
        </div>

        <label class="checkbox-field user-active-field">
          <input type="checkbox" data-form-active checked>
          <span>Usu&aacute;rio ativo</span>
        </label>

        <p class="user-message" data-user-message role="alert"></p>

        <div class="form-actions">
          <button class="submit-button" type="submit">Salvar</button>
          <button class="secondary-button" type="button" data-user-cancel>Cancelar</button>
        </div>
      </form>
    </div>`;

  document.body.append(formModal);
}

function ensureLogsModalExists() {
  if (getCurrentPage() !== "staff" || document.querySelector("[data-logs-modal]")) {
    return;
  }

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.setAttribute("data-logs-modal", "");
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `
    <div class="modal-backdrop" data-close-logs></div>
    <div class="modal-dialog logs-dialog" role="dialog" aria-modal="true" aria-labelledby="logs-title">
      <button class="modal-close" type="button" aria-label="Fechar log" data-close-logs>&times;</button>

      <div class="logs-heading">
        <div class="users-title-block">
          <span>STAFF</span>
          <h2 id="logs-title">Log</h2>
        </div>
        <button class="secondary-button" type="button" data-logs-refresh>Atualizar</button>
      </div>

      <div class="logs-body">
        <div class="logs-toolbar">
          <div class="logs-summary" aria-label="Resumo do log">
            <div class="logs-stat">
              <strong data-logs-count>0</strong>
              <span>Registros</span>
            </div>
            <div class="logs-stat">
              <strong data-logs-success-count>0</strong>
              <span>OK</span>
            </div>
            <div class="logs-stat">
              <strong data-logs-failure-count>0</strong>
              <span>Falhas</span>
            </div>
          </div>

          <label class="logs-search">
            <span class="sr-only">Buscar no log</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
              <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/>
              <path d="M20 20l-3.4-3.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            <input type="search" data-logs-search placeholder="Buscar por usuário, ação ou arquivo" autocomplete="off">
          </label>
        </div>

        <p class="logs-notice" data-logs-notice role="status"></p>

        <div class="logs-table-wrap">
          <table class="logs-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Usuário</th>
                <th>Ação</th>
                <th>Status</th>
                <th>Registro</th>
              </tr>
            </thead>
            <tbody data-logs-list></tbody>
          </table>
        </div>
      </div>
    </div>`;

  document.body.append(modal);
}

setCurrentPageMetadata();
renderPageContent();
renderSidebar();
renderTopbar();
initThemeToggle();
renderExplorerSectors();
ensureLoginModalExists();
ensureUsersModalExists();
ensureLogsModalExists();

const renameButton = document.querySelector("[data-rename-button]");
const fileInput = document.querySelector("[data-file-input]");
const usersOpenButton = document.querySelector("[data-users-open]");
const logsOpenButton = document.querySelector("[data-logs-open]");
const usersModal = document.querySelector("[data-users-modal]");
const userFormModal = document.querySelector("[data-user-form-modal]");
const logsModal = document.querySelector("[data-logs-modal]");
const closeUsersButtons = document.querySelectorAll("[data-close-users]");
const closeLogsButtons = document.querySelectorAll("[data-close-logs]");
const userNewButton = document.querySelector("[data-user-new]");
const usersList = document.querySelector("[data-users-list]");
const usersCount = document.querySelector("[data-users-count]");
const usersAdminCount = document.querySelector("[data-users-admin-count]");
const usersActiveCount = document.querySelector("[data-users-active-count]");
const usersInactiveCount = document.querySelector("[data-users-inactive-count]");
const usersSearchInput = document.querySelector("[data-users-search]");
const usersNotice = document.querySelector("[data-users-notice]");
const userForm = document.querySelector("[data-user-form]");
const userFormTitle = document.querySelector("[data-user-form-title]");
const userIdInput = document.querySelector("[data-form-id]");
const formNameInput = document.querySelector("[data-form-name]");
const formLoginInput = document.querySelector("[data-form-login]");
const formPasswordInput = document.querySelector("[data-form-password]");
const formProfileInput = document.querySelector("[data-form-profile]");
const formActiveInput = document.querySelector("[data-form-active]");
const userMessage = document.querySelector("[data-user-message]");
const userCancelButtons = document.querySelectorAll("[data-user-cancel]");
const logsList = document.querySelector("[data-logs-list]");
const logsSearchInput = document.querySelector("[data-logs-search]");
const logsNotice = document.querySelector("[data-logs-notice]");
const logsRefreshButton = document.querySelector("[data-logs-refresh]");
const logsCount = document.querySelector("[data-logs-count]");
const logsSuccessCount = document.querySelector("[data-logs-success-count]");
const logsFailureCount = document.querySelector("[data-logs-failure-count]");
const isProtectedPage = ["staff", "setores"].includes(document.body.dataset.page);
const isReadOnlyExplorer = getCurrentPage() === "arquivos";
// header / login related elements (may be absent on some pages)
const openLoginButton = document.querySelector('[data-open-login]');
const loginModal = document.querySelector('[data-login-modal]');
const loginForm = document.querySelector('[data-login-form]');
const loginUserInput = document.querySelector('#login-user');
const loginPasswordInput = document.querySelector('#login-password');
const loginMessage = document.querySelector('[data-login-message]');
const logoutButton = document.querySelector('[data-logout]');
const staffButton = document.querySelector('[data-staff]');
const sectorsPageButton = document.querySelector('[data-sectors-page]');

// explorer / sidebar selectors
const sidebarElement = document.querySelector("[data-sidebar]");
const sectorList = document.querySelector("[data-sector-list]");
const sectorAddButton = document.querySelector("[data-sector-add]");
const sectorMessage = document.querySelector("[data-sector-message]");
const folderList = document.querySelector('[data-folder-list]');
// explorer navigation buttons
const explorerAddress = document.querySelector('[data-explorer-address]');
const explorerSearchInput = document.querySelector('[data-explorer-search]');
const explorerBackButton = document.querySelector('[data-explorer-back]');
const explorerForwardButton = document.querySelector('[data-explorer-forward]');
const explorerUpButton = document.querySelector('[data-explorer-up]');
// explorer action buttons
const uploadButton = document.querySelector('[data-upload-button]');
const newFolderButton = document.querySelector('[data-new-folder-button]');

// Initialize user avatar + dropdown in header
function initUserDropdown() {
  const userEl = document.querySelector('.user');

  if (!userEl) return;

  let avatar = userEl.querySelector('.user-avatar');
  let dropdown = userEl.querySelector('.user-dropdown');

  if (!avatar) {
    avatar = document.createElement('button');
    avatar.type = 'button';
    avatar.className = 'user-avatar is-hidden';
    avatar.setAttribute('aria-haspopup', 'true');
    avatar.setAttribute('aria-expanded', 'false');
    avatar.setAttribute('aria-label', 'Abrir menu do usuario');
    avatar.title = 'Conta';
    avatar.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="8" r="4"></circle>
        <path d="M4 21a8 8 0 0 1 16 0"></path>
      </svg>`;
    userEl.appendChild(avatar);
  }

  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'user-dropdown';
    dropdown.setAttribute('role', 'menu');
    dropdown.setAttribute('aria-label', 'Menu do usuario');
    userEl.appendChild(dropdown);
  }

  const staffBtn = userEl.querySelector('[data-staff]');
  const logoutBtn = userEl.querySelector('[data-logout]');

  if (staffBtn && logoutBtn) {
    dropdown.append(staffBtn, logoutBtn);
  } else if (staffBtn) {
    dropdown.append(staffBtn);
  } else if (logoutBtn) {
    dropdown.append(logoutBtn);
  }

  function updateAvatar(sessionUser) {
    avatar.setAttribute(
      'aria-label',
      sessionUser && sessionUser.nome ? `Abrir menu de ${sessionUser.nome}` : 'Abrir menu do usuario'
    );
  }

  avatar.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = userEl.classList.toggle('dropdown-open');
    avatar.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', (e) => {
    if (!userEl.contains(e.target) && userEl.classList.contains('dropdown-open')) {
      userEl.classList.remove('dropdown-open');
      avatar.setAttribute('aria-expanded', 'false');
    }
  });

  window._updateAvatar = updateAvatar;
  updateAvatar(getSession());
}

// run setup: init dropdown only after ensuring header controls exist

async function apiRequest(url, options = {}) {
  const apiUrl = url.startsWith("http") ? url : `${apiBaseUrl}${url}`;
  const requestOptions = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  };

  if (requestOptions.body && typeof requestOptions.body !== "string") {
    requestOptions.body = JSON.stringify(requestOptions.body);
  }

  const response = await fetch(apiUrl, requestOptions);
  let data;
  try {
    data = await response.json();
  } catch (e) {
    data = { message: "Erro ao processar resposta do servidor." };
  }

  if (!response.ok) {
    console.error(`Erro API (${response.status}):`, data);
    throw new Error(data.message || `Erro ${response.status}: Não foi possível concluir a operação.`);
  }

  return data;
}

function getSessionUserHeader() {
  const sessionUser = getSession();

  return sessionUser ? { "X-User-Id": String(sessionUser.id) } : {};
}

async function getUsers() {
  const data = await apiRequest("/api/usuarios", {
    headers: getSessionUserHeader()
  });
  return Array.isArray(data.usuarios) ? data.usuarios : [];
}

async function loginUser(usuario, senha) {
  const data = await apiRequest("/api/login", {
    method: "POST",
    body: { usuario, senha }
  });

  return data.usuario;
}

async function createUser(payload) {
  const data = await apiRequest("/api/usuarios", {
    method: "POST",
    headers: getSessionUserHeader(),
    body: payload
  });

  return data.usuario;
}

async function updateUser(userId, payload) {
  const data = await apiRequest(`/api/usuarios/${userId}`, {
    method: "PUT",
    headers: getSessionUserHeader(),
    body: payload
  });

  return data.usuario;
}

async function removeUser(userId) {
  await apiRequest(`/api/usuarios/${userId}`, {
    method: "DELETE",
    headers: getSessionUserHeader()
  });
}

async function getAuditLogs() {
  const data = await apiRequest("/api/logs", {
    headers: getSessionUserHeader()
  });

  return Array.isArray(data.logs) ? data.logs : [];
}

async function getSectors({ publicAccess = getCurrentPage() !== "setores" } = {}) {
  const data = await apiRequest(publicAccess ? "/api/public/setores" : "/api/setores", {
    headers: publicAccess ? {} : getSessionUserHeader()
  });

  return normalizeSectorsList(data.setores);
}

async function createSector(nome) {
  const data = await apiRequest("/api/setores", {
    method: "POST",
    headers: getSessionUserHeader(),
    body: { nome }
  });

  return {
    setor: data.setor,
    setores: normalizeSectorsList(data.setores)
  };
}

async function removeSector(sectorId) {
  const data = await apiRequest(`/api/setores/${encodeURIComponent(sectorId)}`, {
    method: "DELETE",
    headers: getSessionUserHeader()
  });

  return normalizeSectorsList(data.setores);
}

async function getSectorFolders(sectorId) {
  const basePath = getSectorApiPath();
  const data = await apiRequest(`${basePath}/${encodeURIComponent(sectorId)}/explorer?path=${encodeURIComponent(currentExplorerPath)}`, {
    headers: getSessionUserHeader()
  });
  return {
    caminho: data.caminho || "",
    pai: data.pai || "",
    itens: Array.isArray(data.itens) ? data.itens : []
  };
}

async function searchSectorItems(sectorId, query) {
  const basePath = getSectorApiPath();
  const data = await apiRequest(`${basePath}/${encodeURIComponent(sectorId)}/search?q=${encodeURIComponent(query)}`, {
    headers: getSessionUserHeader()
  });

  return {
    busca: data.busca || query,
    itens: Array.isArray(data.itens) ? data.itens : []
  };
}

async function createSectorFolder(sectorId, nome) {
  const data = await apiRequest(`/api/setores/${encodeURIComponent(sectorId)}/explorer?path=${encodeURIComponent(currentExplorerPath)}`, {
    method: "POST",
    headers: getSessionUserHeader(),
    body: { nome }
  });

  return data;
}

async function renameSectorItem(sectorId, caminho, nome) {
  await apiRequest(`/api/setores/${encodeURIComponent(sectorId)}/rename`, {
    method: "PUT",
    headers: getSessionUserHeader(),
    body: { caminho, nome }
  });
}

async function getFetchErrorMessage(response, fallbackMessage) {
  const responseCopy = response.clone();

  try {
    const data = await response.json();
    return data.message || data.error || fallbackMessage;
  } catch (error) {
    try {
      const text = await responseCopy.text();
      return text || fallbackMessage;
    } catch (innerError) {
      return fallbackMessage;
    }
  }
}

function canFallbackToLocalUpload() {
  return window.location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

async function uploadSectorFileToSignedUrl(sectorId, file) {
  const signedUpload = await apiRequest(`/api/setores/${encodeURIComponent(sectorId)}/sign-upload?path=${encodeURIComponent(currentExplorerPath)}`, {
    method: "POST",
    headers: getSessionUserHeader(),
    body: {
      filename: file.name,
      contentType: file.type || "application/octet-stream"
    }
  });

  const uploadBody = new FormData();
  uploadBody.append("cacheControl", "3600");
  uploadBody.append("", file);

  const response = await fetch(signedUpload.uploadUrl, {
    method: "PUT",
    headers: {
      "x-upsert": "true"
    },
    body: uploadBody
  });

  if (!response.ok) {
    throw new Error(await getFetchErrorMessage(response, "Nao foi possivel enviar o arquivo para o Storage."));
  }

  return { ok: true, path: signedUpload.path };
}

async function uploadSectorFileThroughApi(sectorId, file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${apiBaseUrl}/api/setores/${encodeURIComponent(sectorId)}/upload?path=${encodeURIComponent(currentExplorerPath)}`, {
    method: "POST",
    headers: getSessionUserHeader(),
    body: formData
  });

  if (!response.ok) {
    throw new Error(await getFetchErrorMessage(response, "Nao foi possivel enviar o arquivo."));
  }

  return response.json();
}

async function uploadSectorFile(sectorId, file) {
  try {
    return await uploadSectorFileToSignedUrl(sectorId, file);
  } catch (error) {
    if (!canFallbackToLocalUpload()) {
      throw error;
    }

    return uploadSectorFileThroughApi(sectorId, file);
  }
}

function normalizeUserProfile(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return ["administrador", "admin", "adm"].includes(normalized) ? "administrador" : "comum";
}

function getUserProfileLabel(user) {
  return normalizeUserProfile(user?.perfil || user?.permissao) === "administrador" ? "Administrador" : "Usu\u00e1rio comum";
}

function userIsAdmin(sessionUser) {
  return Boolean(sessionUser) && normalizeUserProfile(sessionUser.perfil || sessionUser.permissao) === "administrador";
}

function openLoginModal() {
  if (!loginModal || !loginUserInput) {
    return;
  }

  _lastFocusedElementForModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  setModalOpen(loginModal, true);
  clearLoginMessage();

  // prevent background scrolling while modal is open
  document.body.style.overflow = "hidden";

  // focus first input
  loginUserInput.focus();

  // trap focus inside modal for accessibility
  const getFocusableElements = (container) => Array.from(container.querySelectorAll('a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'));

  _loginTrapHandler = function (e) {
    if (e.key !== 'Tab') return;
    const focusable = getFocusableElements(loginModal).filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  };

  document.addEventListener('keydown', _loginTrapHandler);
}

function closeLoginModal(restoreFocus = true) {
  if (!loginModal || !loginForm) {
    return;
  }

  setModalOpen(loginModal, false);
  loginForm.reset();
  clearLoginMessage();

  // restore body scroll
  document.body.style.overflow = "";

  // remove focus trap
  if (_loginTrapHandler) {
    try { document.removeEventListener('keydown', _loginTrapHandler); } catch (e) { /* ignore */ }
    _loginTrapHandler = null;
  }

  if (restoreFocus) {
    // prefer restoring to the originally focused element
    if (_lastFocusedElementForModal && typeof _lastFocusedElementForModal.focus === 'function') {
      try { _lastFocusedElementForModal.focus(); } catch (e) { /* ignore */ }
    } else if (openLoginButton) {
      openLoginButton.focus();
    }
    _lastFocusedElementForModal = null;
  }
}

function clearLoginMessage() {
  setMessage(loginMessage);
}

function showLoginMessage(message, type = "error") {
  setMessage(loginMessage, message, { success: type === "success" });
}

function saveSession(user) {
  const sessionUser = {
    id: user.id,
    nome: user.nome,
    usuario: user.usuario,
    perfil: normalizeUserProfile(user.perfil || user.permissao)
  };

  sessionStorage.setItem(sessionKey, JSON.stringify(sessionUser));
  return sessionUser;
}

function getSession() {
  const session = sessionStorage.getItem(sessionKey);

  if (!session) {
    return null;
  }

  try {
    const parsedSession = JSON.parse(session);
    const normalizedProfile = normalizeUserProfile(parsedSession.perfil || parsedSession.permissao);

    if (parsedSession.perfil !== normalizedProfile || parsedSession.permissao !== undefined) {
      parsedSession.perfil = normalizedProfile;
      delete parsedSession.permissao;
      sessionStorage.setItem(sessionKey, JSON.stringify(parsedSession));
    }

    return parsedSession;
  } catch {
    sessionStorage.removeItem(sessionKey);
    return null;
  }
}

function updateAuthUI(sessionUser) {
  const isAuthenticated = Boolean(sessionUser);
  const isAdmin = userIsAdmin(sessionUser);
  const userNameElement = document.querySelector("[data-user-name]");

  if (openLoginButton) {
    openLoginButton.classList.toggle("is-hidden", isAuthenticated);
  }

  if (logoutButton) {
    logoutButton.classList.toggle("is-hidden", !isAuthenticated);
  }

  if (staffButton) {
    staffButton.classList.toggle("is-hidden", !isAdmin);
  }

  if (userNameElement) {
    userNameElement.classList.toggle("is-hidden", !isAuthenticated);
    userNameElement.textContent = isAuthenticated ? `Olá, ${sessionUser.nome}` : "";
  }
  if (window._updateAvatar) {
    try { window._updateAvatar(sessionUser); } catch (e) { /* ignore */ }
  }
  // show avatar only for authenticated users; keep login button visible otherwise
  const avatarEl = document.querySelector('.user-avatar');
  const userEl = document.querySelector('.user');
  if (avatarEl) {
    avatarEl.classList.toggle('is-hidden', !isAuthenticated);
  }
  if (!isAuthenticated && userEl) {
    userEl.classList.remove('dropdown-open');
    const avatarBtn = userEl.querySelector('.user-avatar');
    if (avatarBtn) avatarBtn.setAttribute('aria-expanded', 'false');
  }
  // ensure the login opener is visible when not authenticated
  const openBtn = document.querySelector('[data-open-login]');
  if (openBtn) {
    openBtn.style.display = isAuthenticated ? 'none' : '';
    openBtn.classList.toggle('is-hidden', isAuthenticated);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  clearLoginMessage();

  try {
    const validUser = await loginUser(loginUserInput.value, loginPasswordInput.value);
    const sessionUser = saveSession(validUser);
    updateAuthUI(sessionUser);
    showLoginMessage("Login realizado com sucesso.", "success");

    setTimeout(() => closeLoginModal(false), 500);
  } catch (error) {
    showLoginMessage(error.message || "Não foi possível validar o login.");
  }
}

function handleLogout() {
  sessionStorage.removeItem(sessionKey);
  updateAuthUI(null);

  if (isProtectedPage) {
    window.location.href = appPagePaths.home;
  }
}

function openStaffPage() {
  const sessionUser = getSession();

  if (userIsAdmin(sessionUser)) {
    window.location.href = appPagePaths.staff;
  }
}

function openSectorsPage() {
  const sessionUser = getSession();

  if (userIsAdmin(sessionUser)) {
    window.location.href = appPagePaths.setores;
  }
}

function protectStaffPage() {
  if (!isProtectedPage) {
    return;
  }

  const sessionUser = getSession();

  if (!userIsAdmin(sessionUser)) {
    window.location.href = appPagePaths.home;
  }
}

function clearUserMessage() {
  setMessage(userMessage);
}

function showUserMessage(message, type = "error") {
  setMessage(userMessage, message, { success: type === "success" });
}

function clearUsersNotice() {
  setMessage(usersNotice);
}

function showUsersNotice(message, type = "success") {
  setMessage(usersNotice, message, { error: type === "error" });
}

function clearSectorMessage() {
  setMessage(sectorMessage);
}

function showSectorMessage(message, type = "success") {
  setMessage(sectorMessage, message, { error: type === "error" });
}

function renderExplorerEmpty(message) {
  if (!folderList) {
    return;
  }

  const row = document.createElement("tr");
  const cell = document.createElement("td");

  folderList.innerHTML = "";
  cell.colSpan = 4;
  cell.className = "explorer-empty";
  cell.textContent = message;
  row.append(cell);
  folderList.append(row);
}

function resetExplorerSelection(message = "Selecione um setor para acessar os arquivos.") {
  selectedSector = null;
  currentExplorerPath = "";
  selectedExplorerItem = null;
  currentExplorerItems = [];
  explorerBackStack = [];
  explorerForwardStack = [];
  clearExplorerSearch();
  renderExplorerSectors();
  renderExplorerEmpty(message);
  updateExplorerControls();
}

async function refreshAppSectors({ preserveSelection = true, selectHash = false } = {}) {
  const sessionUser = getSession();

  if (getCurrentPage() === "setores" && !userIsAdmin(sessionUser)) {
    return [];
  }

  try {
    const publicAccess = getCurrentPage() !== "setores";
    const sectors = await getSectors({ publicAccess });

    appSectors = sectors;

    renderSidebar();
    renderExplorerSectors();

    if (preserveSelection && selectedSector) {
      const currentSector = appSectors.find((sector) => sector.id === selectedSector.id);

      if (currentSector) {
        selectedSector = { id: currentSector.id, name: currentSector.name };
        renderExplorerSectors();
        updateExplorerControls();
      } else {
        resetExplorerSelection();
      }
    }

    if (selectHash && isReadOnlyExplorer && window.location.hash) {
      await selectSectorById(window.location.hash.slice(1));
    }

    return appSectors;
  } catch (error) {
    if (getCurrentPage() === "setores") {
      showSectorMessage(error.message || "Nao foi possivel carregar os setores.", "error");
    }

    return appSectors;
  }
}

async function addSector() {
  clearSectorMessage();

  const sectorName = await customPrompt("Novo Setor", "Digite o nome do novo setor:");

  if (!sectorName) return;

  try {
    const result = await createSector(sectorName.trim());
    appSectors = result.setores;
    renderSidebar();
    renderExplorerSectors();

    if (result.setor?.id) {
      await selectSectorById(result.setor.id);
    }

    showToast(`Setor "${sectorName}" criado com sucesso.`);
  } catch (error) {
    showToast(error.message || "Não foi possível criar o setor.", "error");
  }
}

async function deleteSector(sectorId) {
  clearSectorMessage();

  const sector = appSectors.find((item) => item.id === sectorId);

  if (!sector) {
    showSectorMessage("Setor nao encontrado.", "error");
    return;
  }

  const confirmed = await customConfirm(
    "Excluir Setor", 
    `Tem certeza que deseja excluir o setor "${sector.name}"? Todos os arquivos e pastas internos serão apagados permanentemente.`
  );

  if (!confirmed) return;

  try {
    appSectors = await removeSector(sector.id);
    renderSidebar();

    if (selectedSector?.id === sector.id) {
      resetExplorerSelection();
    } else {
      renderExplorerSectors();
    }

    showToast(`Setor "${sector.name}" excluído com sucesso.`);
  } catch (error) {
    showToast(error.message || "Não foi possível excluir o setor.", "error");
  }
}

function resetUserForm({ hide = true } = {}) {
  if (!userForm) {
    return;
  }

  userForm.reset();
  userIdInput.value = "";
  userFormTitle.textContent = "Novo usuário";
  formPasswordInput.required = true;
  formPasswordInput.placeholder = "";
  formProfileInput.value = "comum";
  formActiveInput.checked = true;
  clearUserMessage();

  setUserFormVisible(!hide);
}

function openNewUserForm() {
  resetUserForm({ hide: false });
  clearUsersNotice();
  userFormTitle.textContent = "Novo usuário";
  formNameInput.focus();
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getUserInitials(user) {
  const parts = String(user.nome || user.usuario || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "U";
  }

  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function createTableCell(text, className = "") {
  const cell = document.createElement("td");

  if (className) {
    cell.className = className;
  }

  cell.textContent = text;
  return cell;
}

function createStatusBadge(user) {
  const badge = document.createElement("span");
  badge.className = `status-badge${user.ativo ? "" : " inactive"}`;
  badge.textContent = user.ativo ? "Ativo" : "Inativo";
  return badge;
}

function createRoleBadge(user) {
  const badge = document.createElement("span");
  const isAdmin = normalizeUserProfile(user.perfil || user.permissao) === "administrador";

  badge.className = `role-badge${isAdmin ? " admin" : ""}`;
  badge.textContent = getUserProfileLabel(user);
  return badge;
}

function createActionButton(label, action, userId, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `table-action${extraClass ? ` ${extraClass}` : ""}`;
  button.textContent = label;
  button.dataset[action] = String(userId);
  return button;
}

function renderUserRow(user) {
  const row = document.createElement("tr");

  const nameCell = document.createElement("td");
  const userCell = document.createElement("div");
  const avatar = document.createElement("span");
  const userText = document.createElement("span");
  const name = document.createElement("strong");
  const profile = document.createElement("small");
  const accessCell = document.createElement("td");
  const access = document.createElement("div");
  name.textContent = user.nome;
  profile.textContent = user.usuario;
  userCell.className = "user-cell";
  avatar.className = "user-initials";
  avatar.textContent = getUserInitials(user);
  userText.className = "user-cell-text";
  userText.append(name, profile);
  userCell.append(avatar, userText);
  nameCell.append(userCell);

  const statusCell = document.createElement("td");
  const actionsCell = document.createElement("td");
  const actions = document.createElement("div");

  access.className = "access-stack";
  access.append(createRoleBadge(user));
  accessCell.append(access);
  statusCell.append(createStatusBadge(user));
  actions.className = "table-actions";
  actions.append(
    createActionButton("Editar", "userEdit", user.id),
    createActionButton("Excluir", "userDelete", user.id, "danger")
  );
  actionsCell.append(actions);

  row.append(
    nameCell,
    createTableCell(user.usuario, "user-login-cell"),
    accessCell,
    statusCell,
    actionsCell
  );

  return row;
}

function renderUsersEmpty(message) {
  if (!usersList) {
    return;
  }

  const row = document.createElement("tr");
  const cell = document.createElement("td");

  cell.colSpan = 5;
  cell.className = "users-empty";
  cell.textContent = message;
  row.append(cell);
  usersList.append(row);
}

function updateUsersSummary(users) {
  const admins = users.filter((user) => normalizeUserProfile(user.perfil || user.permissao) === "administrador").length;
  const active = users.filter((user) => user.ativo).length;
  const inactive = users.length - active;

  if (usersCount) {
    usersCount.textContent = String(users.length);
  }

  if (usersAdminCount) {
    usersAdminCount.textContent = String(admins);
  }

  if (usersActiveCount) {
    usersActiveCount.textContent = String(active);
  }

  if (usersInactiveCount) {
    usersInactiveCount.textContent = String(inactive);
  }
}

function renderUsersList(users = cachedUsers) {
  if (!usersList) {
    return;
  }

  const searchTerm = normalizeSearchText(usersSearchInput?.value);
  const visibleUsers = searchTerm
    ? users.filter((user) => {
      return normalizeSearchText(`${user.nome} ${user.usuario} ${getUserProfileLabel(user)}`).includes(searchTerm);
    })
    : users;

  usersList.innerHTML = "";

  if (users.length === 0) {
    renderUsersEmpty("Nenhum usuario cadastrado.");
    return;
  }

  if (visibleUsers.length === 0) {
    renderUsersEmpty("Nenhum usuario encontrado.");
    return;
  }

  visibleUsers.forEach((user) => usersList.append(renderUserRow(user)));
}

async function renderUsers() {
  if (!usersList) {
    return [];
  }

  try {
    const users = await getUsers();
    cachedUsers = users;
    updateUsersSummary(users);
    renderUsersList(users);
    return users;
  } catch (error) {
    showUsersNotice(error.message || "Não foi possível carregar os usuários.", "error");
    return [];
  }
}

function clearLogsNotice() {
  setMessage(logsNotice);
}

function showLogsNotice(message, type = "success") {
  setMessage(logsNotice, message, { error: type === "error" });
}

function getLogActorLabel(log) {
  const actor = log.actor || {};
  const actorId = Number(actor.id);
  const currentUser = actorId
    ? cachedUsers.find((user) => Number(user.id) === actorId)
    : null;

  return currentUser?.nome || actor.nome || actor.usuario || "Usuário";
}

const logChangeActions = new Set([
  "users.create",
  "users.update",
  "users.delete",
  "sectors.create",
  "sectors.delete",
  "folders.create",
  "files.upload",
  "files.delete",
  "items.rename"
]);

function isLogChangeAction(action) {
  return logChangeActions.has(action);
}

function getLogActionLabel(action) {
  const labels = {
    "auth.login": "Login",
    "auth.admin_denied": "Acesso bloqueado",
    "logs.view": "Visualizou log",
    "users.list": "Listou usuários",
    "users.create": "Criou usuário",
    "users.update": "Atualizou usuário",
    "users.delete": "Excluiu usuário",
    "sectors.list": "Listou setores",
    "sectors.create": "Criou setor",
    "sectors.delete": "Excluiu setor",
    "explorer.list": "Abriu pasta",
    "folders.create": "Criou pasta",
    "files.prepare_upload": "Preparou upload",
    "files.upload": "Enviou arquivo",
    "files.download": "Baixou arquivo",
    "files.preview": "Visualizou arquivo",
    "files.delete": "Excluiu arquivo",
    "items.rename": "Renomeou item",
    "public.sectors.list": "Listou setores públicos",
    request: "Requisição"
  };

  return labels[action] || action || "Registro";
}

function getLogStatusLabel(log) {
  if (log.status === "blocked") return "Bloqueado";
  if (log.status === "failure") return "Falha";
  return "OK";
}

function getLogDetailsText(log) {
  const details = log.details || {};
  const payload = details.payload || {};
  const parts = [];

  if (details.sectorId) parts.push(`Setor: ${details.sectorId}`);
  if (details.itemPath) parts.push(`Caminho: ${details.itemPath}`);
  if (details.userId) parts.push(`Usuário ID: ${details.userId}`);
  if (payload.nome) parts.push(`Nome: ${payload.nome}`);
  if (payload.usuario) parts.push(`Login: ${payload.usuario}`);
  if (payload.filename) parts.push(`Arquivo: ${payload.filename}`);
  if (details.error) parts.push(`Erro: ${details.error}`);

  return parts.join(" | ") || log.path || "-";
}

function updateLogsSummary(logs) {
  const success = logs.filter((log) => log.status === "success").length;
  const failures = logs.length - success;

  if (logsCount) logsCount.textContent = String(logs.length);
  if (logsSuccessCount) logsSuccessCount.textContent = String(success);
  if (logsFailureCount) logsFailureCount.textContent = String(failures);
}

function renderLogsEmpty(message) {
  if (!logsList) return;

  const row = document.createElement("tr");
  const cell = document.createElement("td");

  cell.colSpan = 5;
  cell.className = "logs-empty";
  cell.textContent = message;
  row.append(cell);
  logsList.append(row);
}

function renderLogRow(log) {
  const row = document.createElement("tr");
  const dateCell = createTableCell(formatDate(log.createdAt) || "-");
  const actorCell = document.createElement("td");
  const actor = document.createElement("div");
  const actorName = document.createElement("strong");
  const actionCell = createTableCell(getLogActionLabel(log.action));
  const statusCell = document.createElement("td");
  const status = document.createElement("span");
  const detailsCell = document.createElement("td");
  const details = document.createElement("span");

  actor.className = "log-actor";
  actorName.textContent = getLogActorLabel(log);
  actor.append(actorName);
  actorCell.append(actor);

  status.className = `log-status ${log.status || "success"}`;
  status.textContent = getLogStatusLabel(log);
  statusCell.append(status);

  details.className = "log-details";
  details.textContent = getLogDetailsText(log);
  details.title = details.textContent;
  detailsCell.append(details);

  row.append(dateCell, actorCell, actionCell, statusCell, detailsCell);
  return row;
}

function renderLogsList(logs = cachedLogs) {
  if (!logsList) return;

  const searchTerm = normalizeSearchText(logsSearchInput?.value);
  const visibleLogs = searchTerm
    ? logs.filter((log) => {
      return normalizeSearchText([
        formatDate(log.createdAt),
        getLogActorLabel(log),
        getLogActionLabel(log.action),
        getLogStatusLabel(log),
        log.path,
        getLogDetailsText(log)
      ].join(" ")).includes(searchTerm);
    })
    : logs;

  logsList.innerHTML = "";

  if (logs.length === 0) {
    renderLogsEmpty("Nenhuma alteração registrada.");
    return;
  }

  if (visibleLogs.length === 0) {
    renderLogsEmpty("Nenhuma alteração corresponde à busca.");
    return;
  }

  visibleLogs.forEach((log) => logsList.append(renderLogRow(log)));
}

async function renderLogs() {
  if (!logsList) return [];

  try {
    const [logs, users] = await Promise.all([
      getAuditLogs(),
      getUsers().catch(() => cachedUsers)
    ]);
    cachedUsers = users;
    const changeLogs = logs.filter((log) => isLogChangeAction(log.action));
    cachedLogs = changeLogs;
    updateLogsSummary(changeLogs);
    renderLogsList(changeLogs);
    return changeLogs;
  } catch (error) {
    showLogsNotice(error.message || "Não foi possível carregar o log.", "error");
    return [];
  }
}

async function openLogsModal() {
  if (!logsModal) return;

  setModalOpen(logsModal, true);
  clearLogsNotice();

  if (logsSearchInput) {
    logsSearchInput.value = "";
  }

  await renderLogs();

  if (logsSearchInput) {
    logsSearchInput.focus();
  }
}

function closeLogsModal() {
  if (!logsModal) return;

  setModalOpen(logsModal, false);
  clearLogsNotice();

  if (logsOpenButton) {
    logsOpenButton.focus();
  }
}

async function openUsersModal() {
  if (!usersModal) {
    return;
  }

  setModalOpen(usersModal, true);
  resetUserForm();
  clearUsersNotice();

  if (usersSearchInput) {
    usersSearchInput.value = "";
  }

  await renderUsers();

  if (userNewButton) {
    userNewButton.focus();
  }
}

function closeUsersModal() {
  if (!usersModal) {
    return;
  }

  setModalOpen(usersModal, false);
  resetUserForm();
  clearUsersNotice();

  if (usersOpenButton) {
    usersOpenButton.focus();
  }
}

async function editUser(userId) {
  try {
    const users = await getUsers();
    const user = users.find((item) => item.id === userId);

    if (!user) {
      showUsersNotice("Usuário não encontrado.", "error");
      return;
    }

    setUserFormVisible(true);
    userIdInput.value = String(user.id);
    formNameInput.value = user.nome;
    formLoginInput.value = user.usuario;
    formPasswordInput.value = "";
    formPasswordInput.required = false;
    formPasswordInput.placeholder = "Deixe em branco para manter";
    formProfileInput.value = normalizeUserProfile(user.perfil || user.permissao);
    formActiveInput.checked = user.ativo;
    userFormTitle.textContent = "Editar usuário";
    clearUserMessage();
    clearUsersNotice();
    formNameInput.focus();
  } catch (error) {
    showUsersNotice(error.message || "Não foi possível carregar o usuário.", "error");
  }
}

function syncCurrentSession(users) {
  const sessionUser = getSession();

  if (!sessionUser) {
    return;
  }

  const currentUser = users.find((user) => user.id === sessionUser.id && user.ativo);

  if (!currentUser) {
    handleLogout();
    return;
  }

  const updatedSession = saveSession(currentUser);
  updateAuthUI(updatedSession);

  if (isProtectedPage && !userIsAdmin(updatedSession)) {
    window.location.href = appPagePaths.home;
  }
}

async function handleUserFormSubmit(event) {
  event.preventDefault();
  clearUserMessage();
  clearUsersNotice();

  const editingId = Number(userIdInput.value);
  const isEditing = Boolean(editingId);
  const nome = formNameInput.value.trim();
  const usuario = formLoginInput.value.trim();
  const senha = formPasswordInput.value;
  const payload = {
    nome,
    usuario,
    perfil: formProfileInput.value,
    ativo: formActiveInput.checked
  };

  if (!nome || !usuario) {
    showUserMessage("Preencha nome e usuário.");
    return;
  }

  if (!isEditing && !senha) {
    showUserMessage("Informe uma senha para o novo usuário.");
    return;
  }

  if (senha) {
    payload.senha = senha;
  }

  try {
    if (isEditing) {
      await updateUser(editingId, payload);
    } else {
      await createUser(payload);
    }

    resetUserForm();
    const users = await renderUsers();
    syncCurrentSession(users);
    showToast(isEditing ? `Usuário "${nome}" atualizado.` : `Usuário "${nome}" criado.`);
  } catch (error) {
    showUserMessage(error.message || "Não foi possível salvar o usuário.");
    showToast(error.message, "error");
  }
}

async function deleteUser(userId) {
  clearUsersNotice();

  try {
    const users = await getUsers();
    const user = users.find((item) => item.id === userId);
    const sessionUser = getSession();

    if (!user) {
      showUsersNotice("Usuário não encontrado.", "error");
      return;
    }

    if (sessionUser && sessionUser.id === user.id) {
      showUsersNotice("Não é possível excluir o usuário logado.", "error");
      return;
    }

    const confirmed = await customConfirm("Excluir Usuário", `Deseja realmente excluir o acesso de ${user.nome}?`);

    if (!confirmed) return;

    await removeUser(user.id);
    resetUserForm();
    const nextUsers = await renderUsers();
    syncCurrentSession(nextUsers);
    showToast(`Usuário "${user.nome}" removido.`);
  } catch (error) {
    showUsersNotice(error.message || "Não foi possível excluir o usuário.", "error");
  }
}

function handleUsersListClick(event) {
  const editButton = event.target.closest("[data-user-edit]");
  const deleteButton = event.target.closest("[data-user-delete]");

  if (editButton) {
    editUser(Number(editButton.dataset.userEdit));
  }

  if (deleteButton) {
    deleteUser(Number(deleteButton.dataset.userDelete));
  }
}

function normalizeExplorerPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function getExplorerLabel() {
  if (!selectedSector) {
    return "Selecione um setor";
  }

  return [selectedSector.name, currentExplorerPath].filter(Boolean).join(" / ");
}

function formatFileSize(size) {
  if (size === null || size === undefined) {
    return "";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getFileExtension(fileName) {
  const match = String(fileName || "").toLowerCase().match(/\.([^.]+)$/);
  return match ? `.${match[1]}` : "";
}

function ensurePreviewModal() {
  let modal = document.querySelector("[data-preview-modal]");

  if (modal) {
    return modal;
  }

  modal = document.createElement("div");
  modal.className = "modal preview-modal";
  modal.dataset.previewModal = "";
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `
    <div class="modal-backdrop" data-close-preview></div>
    <div class="modal-dialog preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title">
      <button class="modal-close" type="button" aria-label="Fechar visualização" data-close-preview>&times;</button>
      <div class="preview-heading">
        <h2 id="preview-title" data-preview-title>Visualização</h2>
      </div>
      <div class="preview-body" data-preview-body></div>
    </div>`;

  modal.querySelectorAll("[data-close-preview]").forEach((button) => {
    button.addEventListener("click", closePreviewModal);
  });

  document.body.append(modal);
  return modal;
}

function closePreviewModal() {
  const modal = document.querySelector("[data-preview-modal]");
  const body = document.querySelector("[data-preview-body]");

  if (!modal || !body) {
    return;
  }

  setModalOpen(modal, false);
  body.innerHTML = "";

  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = "";
  }
}

function openPreviewModal(title) {
  const modal = ensurePreviewModal();
  const titleElement = modal.querySelector("[data-preview-title]");

  titleElement.textContent = title;
  setModalOpen(modal, true);
}

function renderPdfPreview(title, blob) {
  const body = ensurePreviewModal().querySelector("[data-preview-body]");

  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
  }

  currentPreviewUrl = URL.createObjectURL(blob);
  body.innerHTML = "";

  const frame = document.createElement("iframe");
  frame.className = "preview-frame";
  frame.title = title;
  frame.src = currentPreviewUrl;
  body.append(frame);
  openPreviewModal(title);
}

async function renderWordPreview(title, response) {
  const html = await response.text();
  const body = ensurePreviewModal().querySelector("[data-preview-body]");
  const article = document.createElement("article");

  article.className = "word-preview";
  article.innerHTML = html;
  body.innerHTML = "";
  body.append(article);
  openPreviewModal(title);
}

function updateExplorerControls() {
  const hasSector = Boolean(selectedSector);
  const hasPath = Boolean(currentExplorerPath);
  const hasSelection = Boolean(selectedExplorerItem);

  if (explorerAddress) {
    explorerAddress.textContent = getExplorerLabel();
  }

  if (explorerSearchInput) {
    explorerSearchInput.disabled = !hasSector;
  }

  if (explorerBackButton) {
    explorerBackButton.disabled = explorerBackStack.length === 0;
  }

  if (explorerForwardButton) {
    explorerForwardButton.disabled = explorerForwardStack.length === 0;
  }

  if (explorerUpButton) {
    explorerUpButton.disabled = !hasSector || !hasPath;
  }

  if (uploadButton) {
    uploadButton.disabled = !hasSector;
  }

  if (newFolderButton) {
    newFolderButton.disabled = !hasSector;
  }

  if (renameButton) {
    renameButton.disabled = !hasSelection;
  }
}

function createExplorerRow(item) {
  const row = document.createElement("tr");
  const nameCell = document.createElement("td");
  const nameWrap = document.createElement("div");
  const nameGroup = document.createElement("div");
  const icon = document.createElement("span");
  const nameText = document.createElement("span");
  const name = document.createElement("span");
  const typeCell = document.createElement("td");
  const sizeCell = document.createElement("td");
  const dateCell = document.createElement("td");

  row.className = "explorer-row";
  row.dataset.itemPath = item.caminho;
  row.dataset.itemType = item.tipo;
  row.dataset.itemName = item.nome;
  nameWrap.className = "explorer-name-cell";
  nameGroup.className = "explorer-name-group";
  nameText.className = "explorer-name-text";
  const extension = getFileExtension(item.nome);
  const fileIconClass = extension === ".pdf" ? " pdf-icon" : [".doc", ".docx"].includes(extension) ? " word-icon" : "";
  icon.className = `explorer-file-icon${fileIconClass}`;

  if (item.tipo === "folder") {
    icon.textContent = "📁";
  } else if (extension === ".pdf") {
    icon.innerHTML = `
      <svg viewBox="-4 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
        <path d="M25.6686 26.0962C25.1812 26.2401 24.4656 26.2563 23.6984 26.145C22.875 26.0256 22.0351 25.7739 21.2096 25.403C22.6817 25.1888 23.8237 25.2548 24.8005 25.6009C25.0319 25.6829 25.412 25.9021 25.6686 26.0962ZM17.4552 24.7459C17.3953 24.7622 17.3363 24.7776 17.2776 24.7939C16.8815 24.9017 16.4961 25.0069 16.1247 25.1005L15.6239 25.2275C14.6165 25.4824 13.5865 25.7428 12.5692 26.0529C12.9558 25.1206 13.315 24.178 13.6667 23.2564C13.9271 22.5742 14.193 21.8773 14.468 21.1894C14.6075 21.4198 14.7531 21.6503 14.9046 21.8814C15.5948 22.9326 16.4624 23.9045 17.4552 24.7459ZM14.8927 14.2326C14.958 15.383 14.7098 16.4897 14.3457 17.5514C13.8972 16.2386 13.6882 14.7889 14.2489 13.6185C14.3927 13.3185 14.5105 13.1581 14.5869 13.0744C14.7049 13.2566 14.8601 13.6642 14.8927 14.2326ZM9.63347 28.8054C9.38148 29.2562 9.12426 29.6782 8.86063 30.0767C8.22442 31.0355 7.18393 32.0621 6.64941 32.0621C6.59681 32.0621 6.53316 32.0536 6.44015 31.9554C6.38028 31.8926 6.37069 31.8476 6.37359 31.7862C6.39161 31.4337 6.85867 30.8059 7.53527 30.2238C8.14939 29.6957 8.84352 29.2262 9.63347 28.8054ZM27.3706 26.1461C27.2889 24.9719 25.3123 24.2186 25.2928 24.2116C24.5287 23.9407 23.6986 23.8091 22.7552 23.8091C21.7453 23.8091 20.6565 23.9552 19.2582 24.2819C18.014 23.3999 16.9392 22.2957 16.1362 21.0733C15.7816 20.5332 15.4628 19.9941 15.1849 19.4675C15.8633 17.8454 16.4742 16.1013 16.3632 14.1479C16.2737 12.5816 15.5674 11.5295 14.6069 11.5295C13.948 11.5295 13.3807 12.0175 12.9194 12.9813C12.0965 14.6987 12.3128 16.8962 13.562 19.5184C13.1121 20.5751 12.6941 21.6706 12.2895 22.7311C11.7861 24.0498 11.2674 25.4103 10.6828 26.7045C9.04334 27.3532 7.69648 28.1399 6.57402 29.1057C5.8387 29.7373 4.95223 30.7028 4.90163 31.7107C4.87693 32.1854 5.03969 32.6207 5.37044 32.9695C5.72183 33.3398 6.16329 33.5348 6.6487 33.5354C8.25189 33.5354 9.79489 31.3327 10.0876 30.8909C10.6767 30.0029 11.2281 29.0124 11.7684 27.8699C13.1292 27.3781 14.5794 27.011 15.985 26.6562L16.4884 26.5283C16.8668 26.4321 17.2601 26.3257 17.6635 26.2153C18.0904 26.0999 18.5296 25.9802 18.976 25.8665C20.4193 26.7844 21.9714 27.3831 23.4851 27.6028C24.7601 27.7883 25.8924 27.6807 26.6589 27.2811C27.3486 26.9219 27.3866 26.3676 27.3706 26.1461ZM30.4755 36.2428C30.4755 38.3932 28.5802 38.5258 28.1978 38.5301H3.74486C1.60224 38.5301 1.47322 36.6218 1.46913 36.2428L1.46884 3.75642C1.46884 1.6039 3.36763 1.4734 3.74457 1.46908H20.263L20.2718 1.4778V7.92396C20.2718 9.21763 21.0539 11.6669 24.0158 11.6669H30.4203L30.4753 11.7218L30.4755 36.2428ZM28.9572 10.1976H24.0169C21.8749 10.1976 21.7453 8.29969 21.7424 7.92417V2.95307L28.9572 10.1976ZM31.9447 36.2428V11.1157L21.7424 0.871022V0.823357H21.6936L20.8742 0H3.74491C2.44954 0 0 0.785336 0 3.75711V36.2435C0 37.5427 0.782956 40 3.74491 40H28.2001C29.4952 39.9997 31.9447 39.2143 31.9447 36.2428Z" fill="#EB5757"/>
      </svg>`;
  } else if ([".doc", ".docx"].includes(extension)) {
    icon.innerHTML = wordFileIconSvg;
  } else {
    icon.textContent = "FILE";
  }

  name.textContent = item.nome;
  nameText.append(name);

  if (getExplorerSearchTerm() && item.caminho && item.caminho !== item.nome) {
    const pathHint = document.createElement("small");
    const parentPath = item.caminho.split("/").slice(0, -1).join(" / ");
    pathHint.className = "explorer-path-hint";
    pathHint.textContent = parentPath ? `em ${parentPath}` : selectedSector?.name || "";
    nameText.append(pathHint);
  }

  typeCell.textContent = item.tipo === "folder" ? "Pasta" : "Arquivo";
  sizeCell.textContent = formatFileSize(item.tamanho);
  dateCell.textContent = formatDate(item.atualizadoEm);

  nameGroup.append(icon, nameText);
  nameWrap.append(nameGroup);

  // add download button for files (visible in arquivos explorer)
  if (item.tipo !== 'folder') {
    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'explorer-download-button';
    downloadBtn.setAttribute('aria-label', `Baixar ${item.nome}`);
    downloadBtn.title = 'Baixar';
    downloadBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
        <path d="M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M8 11l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M21 21H3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;

    // stop row selection and trigger download
    downloadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();

      try {
        await downloadExplorerItem(item);
      } catch (err) {
        showToast(err.message || 'Não foi possível baixar o arquivo.', 'error');
      }
    });

    nameWrap.append(downloadBtn);
  }
  nameCell.append(nameWrap);
  row.append(nameCell, typeCell, sizeCell, dateCell);
  return row;
}

function renderExplorerRows(items) {
  if (!folderList) {
    return;
  }

  folderList.innerHTML = "";

  if (items.length === 0) {
    const searchTerm = explorerSearchInput?.value.trim();
    renderExplorerEmpty(
      searchTerm
        ? `Nenhum arquivo ou pasta encontrado no setor para "${searchTerm}".`
        : "Esta pasta está vazia."
    );
    return;
  }

  items.forEach((item) => folderList.append(createExplorerRow(item)));
}

function clearExplorerSearch() {
  explorerSearchRequestId += 1;

  if (explorerSearchTimer) {
    clearTimeout(explorerSearchTimer);
    explorerSearchTimer = null;
  }

  if (explorerSearchInput) {
    explorerSearchInput.value = "";
  }
}

function getExplorerSearchTerm() {
  return explorerSearchInput?.value.trim() || "";
}

function renderCurrentExplorerRows() {
  selectedExplorerItem = null;
  closeFileActionsDropdown();
  renderExplorerRows(currentExplorerItems);
  updateExplorerControls();
}

async function renderExplorerSearchResults() {
  if (!selectedSector) {
    return;
  }

  const searchTerm = getExplorerSearchTerm();

  if (!searchTerm) {
    renderCurrentExplorerRows();
    return;
  }

  const requestId = ++explorerSearchRequestId;
  selectedExplorerItem = null;
  closeFileActionsDropdown();
  renderExplorerEmpty("Buscando em todo o setor...");
  updateExplorerControls();

  try {
    const result = await searchSectorItems(selectedSector.id, searchTerm);

    if (requestId !== explorerSearchRequestId || searchTerm !== getExplorerSearchTerm()) {
      return;
    }

    renderExplorerRows(result.itens);
    updateExplorerControls();
  } catch (error) {
    if (requestId !== explorerSearchRequestId) {
      return;
    }

    showToast(error.message || "Não foi possível buscar no setor.", "error");
    renderExplorerRows([]);
    updateExplorerControls();
  }
}

function scheduleExplorerSearch() {
  if (explorerSearchTimer) {
    clearTimeout(explorerSearchTimer);
  }

  if (!getExplorerSearchTerm()) {
    explorerSearchRequestId += 1;
    renderCurrentExplorerRows();
    return;
  }

  explorerSearchTimer = setTimeout(() => {
    explorerSearchTimer = null;
    renderExplorerSearchResults();
  }, 250);
}

async function loadExplorerPath(pathValue, { pushHistory = true } = {}) {
  if (!selectedSector) {
    updateExplorerControls();
    return;
  }

  const nextPath = normalizeExplorerPath(pathValue);
  const pathChanged = nextPath !== currentExplorerPath;

  if (pushHistory && nextPath !== currentExplorerPath) {
    explorerBackStack.push(currentExplorerPath);
    explorerForwardStack = [];
  }

  if (pathChanged) {
    clearExplorerSearch();
  }

  currentExplorerPath = nextPath;
  selectedExplorerItem = null;
  updateExplorerControls();

  try {
    const result = await getSectorFolders(selectedSector.id);
    currentExplorerPath = result.caminho;
    currentExplorerItems = result.itens;
    if (getExplorerSearchTerm()) {
      await renderExplorerSearchResults();
    } else {
      renderCurrentExplorerRows();
    }
    updateExplorerControls();
  } catch (error) {
    showToast(error.message || "Não foi possível carregar a pasta.", "error");
    currentExplorerItems = [];
    renderExplorerRows([]);
    updateExplorerControls();
  }
}

async function selectSector(button) {
  selectedSector = {
    id: button.dataset.sectorId,
    name: button.dataset.sectorName
  };
  currentExplorerPath = "";
  selectedExplorerItem = null;
  currentExplorerItems = [];
  explorerBackStack = [];
  explorerForwardStack = [];
  clearExplorerSearch();

  document.querySelectorAll("[data-sector-id]").forEach((sectorButton) => {
    sectorButton.classList.toggle("active", sectorButton === button);
  });

  document.querySelectorAll("[data-sidebar] a[data-sidebar-sector]").forEach((sectorLink) => {
    sectorLink.classList.toggle("active", sectorLink.dataset.sidebarSector === selectedSector.id);
  });

  const currentSectorRoot = document.querySelector("[data-sector-root]");

  if (currentSectorRoot) {
    currentSectorRoot.classList.remove("is-hidden");
  }

  await loadExplorerPath("", { pushHistory: false });
}

async function selectSectorById(sectorId) {
  const sectorButton = document.querySelector(`[data-sector-id="${sectorId}"]`);

  if (sectorButton) {
    await selectSector(sectorButton);
    return;
  }

  const sector = appSectors.find((item) => item.id === sectorId);

  if (!sector) {
    return;
  }

  await selectSector({
    dataset: {
      sectorId: sector.id,
      sectorName: sector.name
    }
  });
}

function selectExplorerItem(row) {
  if (!folderList) {
    return;
  }

  folderList.querySelectorAll(".explorer-row").forEach((itemRow) => {
    itemRow.classList.toggle("selected", itemRow === row);
  });

  selectedExplorerItem = {
    caminho: row.dataset.itemPath,
    nome: row.dataset.itemName,
    tipo: row.dataset.itemType
  };
  updateExplorerControls();
}

async function openExplorerItem(item) {
  // ensure any open file-actions dropdown is closed when opening a file
  try { closeFileActionsDropdown(); } catch (e) { /* ignore */ }
  if (item.tipo === "folder") {
    loadExplorerPath(item.caminho);
    return;
  }

  const extension = getFileExtension(item.nome);

  if (extension === ".doc") {
    showToast("Arquivos .doc antigos não podem ser visualizados. Use .docx.", "error");
    return;
  }

  const action = extension === ".docx" ? "preview" : "download";
  const fileUrl = getExplorerPathUrl(selectedSector.id, action, item.caminho);
  const response = await fetch(fileUrl, {
    headers: getSessionUserHeader()
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    showToast(data.message || "Não foi possível abrir o arquivo.", "error");
    return;
  }

  if (extension === ".pdf") {
    renderPdfPreview(item.nome, await response.blob());
    return;
  }

  if (extension === ".docx") {
    await renderWordPreview(item.nome, response);
    return;
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = item.nome;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

// Force download of a file regardless of preview support
async function downloadExplorerItem(item) {
  if (!selectedSector || !item) return;

  const fileUrl = getExplorerPathUrl(selectedSector.id, "download", item.caminho);

  try {
    const response = await fetch(fileUrl, { headers: getSessionUserHeader() });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Não foi possível baixar o arquivo.');
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = item.nome || 'download';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    throw err;
  }
}

function handleFolderListClick(event) {
  const row = event.target.closest(".explorer-row");

  if (!row) {
    return;
  }

  selectExplorerItem(row);

  const extension = getFileExtension(selectedExplorerItem.nome);

  // On 'setores' page, do not auto-open files; show action dropdown instead
  if (document.body.dataset.page === 'setores' && selectedExplorerItem.tipo === 'file') {
    showFileActionsDropdown(row, selectedExplorerItem, event);
    return;
  }

  if (selectedExplorerItem.tipo === "file" && [".pdf", ".doc", ".docx"].includes(extension)) {
    openExplorerItem(selectedExplorerItem);
  }
}

function closeFileActionsDropdown() {
  const existing = document.querySelector('.file-actions-dropdown');

  if (existing && existing.parentElement) {
    existing.parentElement.removeChild(existing);
  }
}

function showFileActionsDropdown(row, item) {
  closeFileActionsDropdown();

  const dropdown = document.createElement('div');
  dropdown.className = 'file-actions-dropdown';
  dropdown.innerHTML = `
    <button type="button" data-action="rename">Renomear</button>
    <button type="button" data-action="download">Baixar</button>
    <button type="button" data-action="delete">Excluir</button>
  `;

  // attach handlers
  dropdown.addEventListener('click', async (e) => {
    const action = e.target.closest('button')?.dataset.action;

    if (!action) return;

    if (action === 'rename') {
      // ensure row selected
      selectExplorerItem(row);
      await renameExplorerSelection();
      closeFileActionsDropdown();
      await loadExplorerPath(currentExplorerPath, { pushHistory: false });
    }

    if (action === 'download') {
      selectExplorerItem(row);
      try {
        await downloadExplorerItem(selectedExplorerItem);
      } catch (err) {
        showToast(err.message || 'Não foi possível baixar o arquivo.', 'error');
      }
      closeFileActionsDropdown();
    }

    if (action === 'delete') {
      const confirmed = await customConfirm(
        "Excluir Arquivo",
        `Deseja excluir o arquivo "${item.nome}"? Esta ação é irreversível.`
      );

      if (!confirmed) {
        return;
      }

      try {
        const deleteUrl = getExplorerPathUrl(selectedSector.id, "delete", item.caminho, { publicAccess: false });
        const resp = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: getSessionUserHeader()
        });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          throw new Error(data.message || 'Não foi possível excluir o arquivo.');
        }

        closeFileActionsDropdown();
        await loadExplorerPath(currentExplorerPath, { pushHistory: false });
        showToast(`Arquivo "${item.nome}" excluído.`);
      } catch (err) {
        showToast(err.message || 'Erro ao excluir o arquivo.', 'error');
      }
    }

    if (action === 'close') {
      closeFileActionsDropdown();
    }
  });

  // position dropdown inside the explorer panel (so it stays within the panel)
  const panel = row.closest('.explorer-panel') || document.body;
  const panelRect = panel.getBoundingClientRect();
  const rect = row.getBoundingClientRect();

  dropdown.style.position = 'absolute';
  dropdown.style.minWidth = '140px';
  dropdown.style.zIndex = 80;

  // append to panel so positioning is relative to it
  panel.appendChild(dropdown);

  // compute left/top relative to panel
  const dropdownRect = dropdown.getBoundingClientRect();

  // If mouse event was provided, position by mouse cursor; otherwise fallback to row-based positioning
  let left, top;
  const maxLeft = panel.clientWidth - dropdownRect.width - 8;
  const maxTop = panel.clientHeight - dropdownRect.height - 8;

  if (arguments.length >= 3 && arguments[2] && arguments[2].clientX != null) {
    const mouseX = arguments[2].clientX;
    const mouseY = arguments[2].clientY;

    left = mouseX - panelRect.left + (panel.scrollLeft || 0);
    // prefer to place dropdown slightly right of cursor
    left += 8;
    if (left > maxLeft) {
      left = Math.max(8, maxLeft);
    }

    top = mouseY - panelRect.top + (panel.scrollTop || 0);
    // if dropdown would overflow bottom, try to place above cursor
    if (top > maxTop) {
      const altTop = mouseY - panelRect.top - dropdownRect.height + (panel.scrollTop || 0) - 8;
      top = altTop > 8 ? altTop : Math.max(8, maxTop);
    }
  } else {
    left = rect.right - panelRect.left + 8 + (panel.scrollLeft || 0);
    if (left > maxLeft) {
      left = rect.left - panelRect.left - dropdownRect.width - 8 + (panel.scrollLeft || 0);
      if (left < 8) left = 8;
    }

    top = rect.top - panelRect.top + (panel.scrollTop || 0);
    if (top > maxTop) top = Math.max(8, maxTop);
  }

  dropdown.style.left = `${Math.round(left)}px`;
  dropdown.style.top = `${Math.round(top)}px`;

  // close when clicking outside
  const onDocClick = (e) => {
    if (!dropdown.contains(e.target) && !row.contains(e.target)) {
      closeFileActionsDropdown();
      document.removeEventListener('click', onDocClick);
    }
  };

  setTimeout(() => document.addEventListener('click', onDocClick), 0);

  return dropdown;
}

function handleFolderListDoubleClick(event) {
  const row = event.target.closest(".explorer-row");

  if (!row) {
    return;
  }

  selectExplorerItem(row);
  openExplorerItem(selectedExplorerItem);
}

async function goBackExplorer() {
  if (explorerBackStack.length === 0) {
    return;
  }

  explorerForwardStack.push(currentExplorerPath);
  await loadExplorerPath(explorerBackStack.pop(), { pushHistory: false });
}

async function goForwardExplorer() {
  if (explorerForwardStack.length === 0) {
    return;
  }

  explorerBackStack.push(currentExplorerPath);
  await loadExplorerPath(explorerForwardStack.pop(), { pushHistory: false });
}

async function goUpExplorer() {
  if (!currentExplorerPath) {
    return;
  }

  const parts = currentExplorerPath.split("/").filter(Boolean);
  parts.pop();
  await loadExplorerPath(parts.join("/"));
}

async function createExplorerFolder() {
  if (!selectedSector) {
    return;
  }

  const folderName = await customPrompt("Nova Pasta", "Digite o nome da pasta:");

  if (!folderName) return;

  try {
    await createSectorFolder(selectedSector.id, folderName.trim());
    await loadExplorerPath(currentExplorerPath, { pushHistory: false });
    showToast(`Pasta "${folderName}" criada.`);
  } catch (error) {
    showToast(error.message || "Não foi possível criar a pasta.", "error");
  }
}

async function renameExplorerSelection() {
  if (!selectedSector || !selectedExplorerItem) {
    return;
  }

  const nextName = await customPrompt("Renomear", "Novo nome:", selectedExplorerItem.nome);

  if (!nextName || nextName === selectedExplorerItem.nome) return;

  try {
    await renameSectorItem(selectedSector.id, selectedExplorerItem.caminho, nextName.trim());
    await loadExplorerPath(currentExplorerPath, { pushHistory: false });
    showToast("Item renomeado com sucesso.");
  } catch (error) {
    showToast(error.message || "Não foi possível renomear.", "error");
  }
}

// ==========================================================================
// --- Feature Handlers ---
// ==========================================================================

async function handleUploadFiles() {
  if (!selectedSector || !fileInput || !fileInput.files.length) {
    return;
  }

  const originalBtnText = uploadButton.textContent;
  uploadButton.disabled = true;
  uploadButton.textContent = "Enviando...";

  try {
    showToast(`Iniciando upload de ${fileInput.files.length} arquivo(s)...`, "info");
    for (const file of Array.from(fileInput.files)) {
      await uploadSectorFile(selectedSector.id, file);
    }

    fileInput.value = "";
    await loadExplorerPath(currentExplorerPath, { pushHistory: false });
    showToast("Upload concluído.");
  } catch (error) {
    fileInput.value = "";
    showToast(error.message || "Erro durante o upload.", "error");
  } finally {
    uploadButton.disabled = false;
    uploadButton.textContent = originalBtnText;
  }
}

function handleSectorListClick(event) {
  const deleteButton = event.target.closest("[data-sector-delete]");

  if (deleteButton) {
    deleteSector(deleteButton.dataset.sectorDelete);
    return;
  }

  const sectorButton = event.target.closest("[data-sector-id]");

  if (sectorButton && sectorList?.contains(sectorButton)) {
    selectSector(sectorButton);
  }
}

// ==========================================================================
// --- Initialization & Event Listeners ---
// ==========================================================================

function handleSidebarSectorClick(event) {
  const link = event.target.closest("a[data-sidebar-sector]");

  if (!link || !sidebarElement?.contains(link)) {
    return;
  }

  if (getCurrentPage() !== "arquivos") {
    return;
  }

  event.preventDefault();
  window.history.replaceState(null, "", `#${link.dataset.sidebarSector}`);
  selectSectorById(link.dataset.sidebarSector);
}

/**
 * Inicializa todos os ouvintes de eventos do sistema
 */
function initializeEventListeners() {
  on(openLoginButton, "click", openLoginModal);
  on(loginForm, "submit", handleLogin);
  on(logoutButton, "click", handleLogout);
  on(staffButton, "click", openStaffPage);
  on(sectorsPageButton, "click", openSectorsPage);

  on(sectorList, "click", handleSectorListClick);
  on(sectorAddButton, "click", addSector);
  on(sidebarElement, "click", handleSidebarSectorClick);
  on(folderList, "click", handleFolderListClick);
  on(folderList, "dblclick", handleFolderListDoubleClick);
  on(explorerSearchInput, "input", scheduleExplorerSearch);
  on(explorerSearchInput, "search", scheduleExplorerSearch);
  on(explorerBackButton, "click", goBackExplorer);
  on(explorerForwardButton, "click", goForwardExplorer);
  on(explorerUpButton, "click", goUpExplorer);
  on(newFolderButton, "click", createExplorerFolder);
  on(renameButton, "click", renameExplorerSelection);
  on(uploadButton, "click", () => fileInput?.click());
  on(fileInput, "change", handleUploadFiles);

  on(usersOpenButton, "click", openUsersModal);
  on(logsOpenButton, "click", openLogsModal);
  on(logsRefreshButton, "click", renderLogs);
  on(userNewButton, "click", openNewUserForm);
  on(userForm, "submit", handleUserFormSubmit);
  userCancelButtons.forEach(btn => on(btn, "click", resetUserForm));
  on(usersList, "click", handleUsersListClick);
  on(usersSearchInput, "input", () => renderUsersList());
  on(logsSearchInput, "input", () => renderLogsList());

  document.querySelectorAll("[data-close-login]").forEach(btn => on(btn, "click", closeLoginModal));
  closeUsersButtons.forEach(btn => on(btn, "click", closeUsersModal));
  closeLogsButtons.forEach(btn => on(btn, "click", closeLogsModal));

  document.addEventListener("keydown", handleGlobalKeyDown);
}

function handleGlobalKeyDown(event) {
  if (event.key === "Escape" && loginModal && loginModal.classList.contains("is-open")) {
    closeLoginModal();
  }

  if (event.key === "Escape" && userFormModal && userFormModal.classList.contains("is-open")) {
    resetUserForm();
    return;
  }

  if (event.key === "Escape" && usersModal && usersModal.classList.contains("is-open")) {
    closeUsersModal();
  }

  if (event.key === "Escape" && logsModal && logsModal.classList.contains("is-open")) {
    closeLogsModal();
  }

  const previewModal = document.querySelector("[data-preview-modal]");

  if (event.key === "Escape" && previewModal && previewModal.classList.contains("is-open")) {
    closePreviewModal();
  }
}

// --- Início da Execução ---
initUserDropdown();
initializeEventListeners();
protectStaffPage();
updateAuthUI(getSession());
refreshAppSectors({ preserveSelection: false, selectHash: true });
