(function () {
  function escapeDialogHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    })[char]);
  }

  window.customConfirm = function customConfirm(title, message) {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "modal is-open";
      modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-dialog">
          <h2 style="margin-bottom: 1rem;">${escapeDialogHtml(title)}</h2>
          <p>${escapeDialogHtml(message)}</p>
          <div class="form-actions" style="margin-top: 2rem; justify-content: flex-end;">
            <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
            <button class="submit-button" type="button" data-dialog-confirm>Confirmar</button>
          </div>
        </div>`;
      document.body.appendChild(modal);

      const close = (result) => {
        modal.remove();
        resolve(result);
      };

      modal.querySelector("[data-dialog-confirm]").onclick = () => close(true);
      modal.querySelector("[data-dialog-cancel]").onclick = () => close(false);
      modal.querySelector(".modal-backdrop").onclick = () => close(false);
    });
  };

  window.customPrompt = function customPrompt(title, label, defaultValue = "") {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "modal is-open";
      const inputId = `prompt-${Date.now()}`;
      modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-dialog">
          <h2 style="margin-bottom: 1rem;">${escapeDialogHtml(title)}</h2>
          <div class="field">
            <label for="${inputId}">${escapeDialogHtml(label)}</label>
            <input id="${inputId}" type="text" value="${escapeDialogHtml(defaultValue)}" autocomplete="off">
          </div>
          <div class="form-actions" style="margin-top: 2rem; justify-content: flex-end;">
            <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
            <button class="submit-button" type="button" data-dialog-confirm>Salvar</button>
          </div>
        </div>`;
      document.body.appendChild(modal);

      const input = modal.querySelector("input");
      input.focus();
      input.select();

      const close = (result) => {
        modal.remove();
        resolve(result);
      };

      modal.querySelector("[data-dialog-confirm]").onclick = () => close(input.value.trim() || null);
      modal.querySelector("[data-dialog-cancel]").onclick = () => close(null);
      input.onkeydown = (event) => {
        if (event.key === "Enter") close(input.value.trim() || null);
        if (event.key === "Escape") close(null);
      };
    });
  };
})();
