const resources = [
  { name: "cooming soon", category: "Libraries", description: "SOON HINT 200 PLUS ITEM DROP.", repository: "FIVEM", url: "SOON", mark: "OX" },
  { name: "cooming soon", category: "Gameplay", description: "SOON HINT 200 PLUS ITEM DROP.", repository: "FIVEM", url: "SOON", mark: "OX" },
  { name: "cooming soon", category: "Gameplay", description: "SOON HINT 200 PLUS ITEM DROP.", repository: "FIVEM", url: "SOON", mark: "OX" },
  { name: "cooming soon", category: "Frameworks", description: "SOON HINT 200 PLUS ITEM DROP", repository: "FIVEM", url: "SOON", mark: "QB" },
  { name: "cooming soon", category: "Appearance", description: "SOON HINT 200 PLUS ITEM DROP.", repository: "SOOOON", url: "SOON MY CHILD", mark: "IL" },
];

const grid = document.querySelector("#resource-grid");
const searchInput = document.querySelector("#resource-search");
const count = document.querySelector("#result-count");
const noResults = document.querySelector("#no-results");
const filterButtons = [...document.querySelectorAll(".filter")];
const accountButton = document.querySelector("#account-button");
const authDialog = document.querySelector("#auth-dialog");
const authForm = document.querySelector("#auth-form");
const ticketsDialog = document.querySelector("#tickets-dialog");
let activeCategory = "All";
let authMode = "login";
let currentUser = null;

function renderResources() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = resources.filter((resource) => {
    const categoryMatch = activeCategory === "All" || resource.category === activeCategory;
    const text = `${resource.name} ${resource.category} ${resource.description} ${resource.repository}`.toLowerCase();
    return categoryMatch && text.includes(query);
  });
  grid.replaceChildren();
  count.textContent = String(visible.length).padStart(2, "0");
  noResults.hidden = visible.length > 0;
  for (const resource of visible) {
    const card = document.createElement("article");
    card.className = "resource-card";
    card.innerHTML = `<div class="card-topline"><span class="project-mark">${resource.mark}</span><span class="category-label">${resource.category}</span></div><h3>${resource.name}</h3><p class="card-description">${resource.description}</p><div class="card-bottom"><span class="repository-name">${resource.repository}</span><a class="source-link" href="${resource.url}" target="_blank" rel="noopener noreferrer" aria-label="Open official ${resource.name}"><svg viewBox="0 0 24 24" fill="none"><path d="M7 17 17 7M7 7h10v10" stroke="currentColor" stroke-width="1.8"/></svg></a></div>`;
    grid.append(card);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

async function refreshSession() {
  try {
    const result = await api("/api/session");
    currentUser = result.user;
    accountButton.textContent = currentUser ? (currentUser.role === "admin" ? "Admin · Logout" : `${currentUser.name} · Logout`) : "Login";
  } catch {
    currentUser = null;
  }
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll(".auth-tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.auth === mode));
  const registerField = authForm.querySelector(".register-only");
  registerField.hidden = mode !== "register";
  registerField.querySelector("input").required = mode === "register";
  authForm.querySelector("[name=password]").autocomplete = mode === "login" ? "current-password" : "new-password";
}

accountButton.addEventListener("click", async () => {
  if (currentUser) {
    await api("/api/logout", { method: "POST", body: "{}" });
    await refreshSession();
    return;
  }
  document.querySelector("#auth-error").textContent = "";
  setAuthMode("login");
  authDialog.showModal();
});

for (const tab of document.querySelectorAll(".auth-tab")) tab.addEventListener("click", () => setAuthMode(tab.dataset.auth));
for (const closeButton of document.querySelectorAll("[data-close]")) closeButton.addEventListener("click", () => closeButton.closest("dialog").close());

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(authForm));
  try {
    const result = await api(authMode === "login" ? "/api/login" : "/api/register", { method: "POST", body: JSON.stringify(data) });
    currentUser = result.user;
    accountButton.textContent = currentUser.role === "admin" ? "Admin · Logout" : `${currentUser.name} · Logout`;
    authDialog.close();
    authForm.reset();
  } catch (error) {
    document.querySelector("#auth-error").textContent = error.message;
  }
});

async function loadTickets() {
  const list = document.querySelector("#ticket-list");
  try {
    const tickets = await api("/api/tickets");
    list.replaceChildren();
    if (!tickets.length) { list.innerHTML = '<p class="no-results">No tickets yet.</p>'; return; }
    for (const ticket of tickets) {
      const card = document.createElement("article");
      card.className = "ticket-card";
      card.innerHTML = `<div class="ticket-card-head"><h3>${ticket.subject}</h3><span class="ticket-status">${ticket.status}</span></div><p class="ticket-message">${ticket.messages[0]?.body || ""}</p>${currentUser?.role === "admin" ? `<div class="ticket-actions"><button type="button" data-status="open">Open</button><button type="button" data-status="pending">Pending</button><button type="button" data-status="closed">Closed</button></div>` : ""}<input class="ticket-reply" placeholder="Reply to ticket" aria-label="Reply"><div class="ticket-message-list"></div>`;
      const replyInput = card.querySelector(".ticket-reply");
      replyInput.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter" || !replyInput.value.trim()) return;
        event.preventDefault();
        try {
          await api(`/api/tickets/${ticket.id}/messages`, { method: "POST", body: JSON.stringify({ body: replyInput.value.trim() }) });
          replyInput.value = "";
          await loadTickets();
        } catch (error) { replyInput.placeholder = error.message; }
      });
      if (currentUser?.role === "admin") {
        card.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", async () => {
          await api(`/api/tickets/${ticket.id}`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.status }) });
          await loadTickets();
        }));
      }
      const messageList = card.querySelector(".ticket-message-list");
      for (const message of ticket.messages.slice(1)) {
        const item = document.createElement("p");
        item.className = "ticket-message";
        item.textContent = `${message.name}: ${message.body}`;
        messageList.append(item);
      }
      list.append(card);
    }
  } catch (error) {
    list.innerHTML = `<p class="no-results">${error.message}</p>`;
  }
}

document.querySelector("#tickets-button").addEventListener("click", async () => {
  if (!currentUser) { setAuthMode("login"); authDialog.showModal(); return; }
  ticketsDialog.showModal();
  await loadTickets();
});

document.querySelector("#new-ticket-button").addEventListener("click", () => {
  document.querySelector("#ticket-form").hidden = !document.querySelector("#ticket-form").hidden;
});

document.querySelector("#ticket-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try {
    await api("/api/tickets", { method: "POST", body: JSON.stringify(data) });
    form.reset();
    form.hidden = true;
    await loadTickets();
  } catch (error) { document.querySelector("#ticket-error").textContent = error.message; }
});

for (const button of filterButtons) {
  button.addEventListener("click", () => {
    activeCategory = button.dataset.category;
    for (const item of filterButtons) {
      const selected = item === button;
      item.classList.toggle("is-active", selected);
      item.setAttribute("aria-pressed", String(selected));
    }
    renderResources();
  });
}

searchInput.addEventListener("input", renderResources);
renderResources();
refreshSession();