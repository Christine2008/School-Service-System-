// Registrar Queue Display (admin only): who booked a ticket, per service and day.
// Data comes from /api/tickets, which requires an admin session and reads from Neon.
document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireUser(["admin"]);
  if (!session) return;
  const content = `<div class="page-head"><a class="btn secondary back-btn" href="admin-dashboard.html">← Back to Admin Dashboard</a></div>
    <h1>Registrar Queue Display</h1><p class="subtitle">Students who booked a queue ticket for each service. Earliest appointment first. This page updates automatically.</p>
    <div id="message" role="alert" hidden></div>
    <div class="toolbar"><div class="field"><label for="displayDate">Scheduled date</label><input type="date" id="displayDate"></div><button type="button" class="btn secondary" id="todayBtn">Today</button></div>
    <div class="tabs" role="tablist" aria-label="Registrar services" id="tabs"></div>
    <div id="panel" role="tabpanel" aria-live="polite">${spinner("Loading queue...")}</div>`;
  document.body.innerHTML = layout(content, "queue-display.html", true);
  attachLogout();

  let services = [], tickets = [], today = "", selected = "", loadId = 0, signature = "";

  function renderTabs() {
    const counts = {};
    tickets.forEach(t => { counts[t.service_id] = (counts[t.service_id] || 0) + 1; });
    $("#tabs").innerHTML = services.map(s => `<button type="button" class="tab" role="tab" id="tab-${esc(s.id)}" data-service="${esc(s.id)}"
      aria-selected="${s.id === selected}" aria-controls="panel" tabindex="${s.id === selected ? 0 : -1}">${esc(s.name)}<span class="count">${counts[s.id] || 0}</span></button>`).join("");
    $("#panel").setAttribute("aria-labelledby", `tab-${selected}`);
  }

  function renderPanel() {
    const service = services.find(s => s.id === selected);
    const date = $("#displayDate").value || today;
    const rows = tickets.filter(t => t.service_id === selected);   // server already sorted by time
    if (!rows.length) {
      $("#panel").innerHTML = `<div class="card empty">No tickets have been scheduled for ${esc(service?.name || "this service")} on ${esc(fmtDate(date))}.</div>`;
      return;
    }
    $("#panel").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Student name</th><th>Student ID</th><th>Service</th><th>Date</th><th>Time</th><th>Status</th></tr></thead><tbody>${
      rows.map(t => `<tr><td><strong>${esc(t.ticket_code)}</strong></td><td>${esc(t.full_name || "Student")}</td><td>${esc(t.student_id || "—")}</td><td>${esc(t.service_name)}</td><td>${esc(fmtDate(t.queue_date))}</td><td>${esc(fmtTime(t.scheduled_time))}</td><td>${statusBadge(t.status)}</td></tr>`).join("")
    }</tbody></table></div>`;
  }

  async function load() {
    const mine = ++loadId;                                     // drop out-of-order responses
    const date = $("#displayDate").value || "today";
    const data = await api(`/api/tickets?date=${encodeURIComponent(date)}`);
    if (mine !== loadId) return;
    today = data.today;
    if (!$("#displayDate").value) $("#displayDate").value = today;
    // De-duplicate by ticket id so a refresh can never show the same ticket twice.
    tickets = [...new Map(data.tickets.map(t => [t.id, t])).values()];
    clearMessage();
    const next = JSON.stringify([selected, tickets.map(t => [t.id, t.status, t.scheduled_time])]);
    if (next === signature) return;                            // nothing changed: leave the DOM alone
    signature = next;
    renderTabs(); renderPanel();
  }
  const reload = () => load().catch(e => showMessage(friendlyError(e), "error"));

  function select(id, focus) {
    selected = id; signature = ""; renderTabs(); renderPanel();
    if (focus) $(`#tab-${CSS.escape(id)}`)?.focus();
  }
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-service]"); if (b) select(b.dataset.service); });
  $("#tabs").addEventListener("keydown", (e) => {            // arrow keys move between tabs
    const i = services.findIndex(s => s.id === selected);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step) { e.preventDefault(); select(services[(i + step + services.length) % services.length].id, true); }
    else if (e.key === "Home") { e.preventDefault(); select(services[0].id, true); }
    else if (e.key === "End") { e.preventDefault(); select(services[services.length - 1].id, true); }
  });
  $("#displayDate").addEventListener("change", () => { signature = ""; $("#panel").innerHTML = spinner("Loading queue..."); reload(); });
  $("#todayBtn").addEventListener("click", () => { $("#displayDate").value = today; signature = ""; reload(); });

  try {
    services = await getServices();
    selected = services[0]?.id || "";
    await load();
    poll(reload);
  } catch (error) { $("#panel").innerHTML = ""; showMessage(friendlyError(error), "error"); }
});
