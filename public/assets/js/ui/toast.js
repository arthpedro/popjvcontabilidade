(function () {
  function escapeToastHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    })[char]);
  }

  window.showToast = function showToast(message, type = "success", duration = 4000) {
    let container = document.querySelector(".toast-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "toast-container";
      container.setAttribute("aria-live", "polite");
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.innerHTML = `
      <div class="toast-content">${escapeToastHtml(message)}</div>
      <div class="toast-progress"><div class="toast-progress-fill"></div></div>
    `;

    container.appendChild(toast);

    const fill = toast.querySelector(".toast-progress-fill");
    requestAnimationFrame(() => {
      if (!fill) return;
      fill.style.transition = `width ${duration}ms linear`;
      fill.style.width = "0%";
    });

    const remove = () => {
      toast.classList.add("toast-out");
      toast.addEventListener("animationend", () => toast.remove());
    };

    const timer = setTimeout(remove, duration);
    toast.onclick = () => {
      clearTimeout(timer);
      remove();
    };
  };
})();
