const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

// Escape any text before putting it into HTML.
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw Object.assign(new Error("Can't reach the server. Check your connection and try again."), { status: 0 });
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status}).`), { status: res.status, fields: data.fields });
  return data;
}

function showMessage(message, type = "notice", target = "#message") {
  const el = $(target);
  if (!el) return;
  el.className = `notice ${type === "error" ? "error" : type === "success" ? "success" : ""}`;
  el.textContent = message;
  el.hidden = false;
}
function clearMessage(target = "#message") {
  const el = $(target);
  if (el) { el.hidden = true; el.textContent = ""; }
}
function friendlyError(error) {
  return error?.message || "Something went wrong. Please try again.";
}
function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}
const STATUS_LABELS = { waiting: "Waiting", called: "Called", being_served: "Serving", completed: "Completed", cancelled: "Cancelled", skipped: "Skipped" };
function statusBadge(status) {
  const s = String(status || "");
  return `<span class="badge ${esc(s)}">${esc(STATUS_LABELS[s] || s.replaceAll("_", " "))}</span>`;
}
// "2026-11-10" -> "Tue, Nov 10, 2026" (parsed as a plain calendar date, so no timezone shifts).
function fmtDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  if (!m) return "—";
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
// "13:30" -> "1:30 PM"
function fmtTime(hhmm) {
  const m = /^(\d{2}):(\d{2})/.exec(String(hhmm || ""));
  if (!m) return "—";
  return new Date(2000, 0, 1, +m[1], +m[2]).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
const fmtSchedule = (t) => t.scheduled_time ? `${fmtDate(t.queue_date)} · ${fmtTime(t.scheduled_time)}` : fmtDate(t.queue_date);
const spinner = (label = "Loading...") => `<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span><span>${esc(label)}</span></div>`;
function homeFor(role) {
  return role === "admin" ? "admin-dashboard.html" : "student-dashboard.html";
}

// Ensure someone is signed in with an allowed role; otherwise send them to the right page.
async function requireUser(allowedRoles = ["student", "admin"]) {
  try {
    const { user } = await api("/api/auth/me");
    if (!allowedRoles.includes(user.role)) { location.href = homeFor(user.role); return null; }
    return { user, profile: user };
  } catch (error) {
    if (error.status === 401) { location.href = "index.html"; return null; }
    document.body.innerHTML = `<main><div class="notice error">${esc(friendlyError(error))}</div></main>`;
    return null;
  }
}
async function logout() {
  try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch {}
  location.href = "index.html";
}
async function getServices() {
  const { services } = await api("/api/services");
  return services || [];
}
const SERVICE_ICONS = { "enrollment": "🎓", "tuition": "💳", "uniform": "👕", "logo-printing": "🖨️" };
const serviceIcon = (id) => SERVICE_ICONS[id] || "📄";

// Run fn now and then every REFRESH_MS while the tab is visible.
function poll(fn, ms = REFRESH_MS) {
  let busy = false;
  const tick = async () => {
    if (busy || document.hidden) return;
    busy = true;
    try { await fn(); } catch (e) { console.warn(e); } finally { busy = false; }
  };
  setInterval(tick, ms);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}

function nav(active, admin = false) {
  const links = admin
    ? [["admin-dashboard.html","▦","Admin Dashboard"],["queue-history.html","◷","Queue History"],["queue-display.html","▣","Queue Display"]]
    : [["student-dashboard.html","▦","Home"],["queue-status.html","◷","Queue Status"]];
  return `<aside class="sidebar"><div class="nav-label">Menu</div>${links.map(([href,icon,label]) =>
    `<a class="nav-link ${active===href?"active":""}" href="${href}"><span>${icon}</span>${label}</a>`
  ).join("")}<a class="nav-link" href="#" id="logoutBtn"><span>↪</span>Log out</a></aside>`;
}
function layout(content, active, admin = false) {
  return `<header class="topbar"><a class="brand" href="${admin?"admin-dashboard.html":"student-dashboard.html"}"><span class="logo">🏛</span><span>${esc(APP_NAME)}<small>${esc(SCHOOL_NAME)}</small></span></a><button class="btn secondary" id="topLogout">Log out</button></header><div class="layout">${nav(active,admin)}<main>${content}<div class="footer">${esc(APP_NAME)} · Keep your ticket number ready when called.</div></main></div>`;
}
function attachLogout() {
  $("#logoutBtn")?.addEventListener("click", async (e) => { e.preventDefault(); await logout(); });
  $("#topLogout")?.addEventListener("click", logout);
}
