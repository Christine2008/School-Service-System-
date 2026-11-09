document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireUser(["admin"]);
  if (!session) return;
  const content = `<h1>Registrar Admin Dashboard</h1><p class="subtitle">Manage today's scheduled tickets for each service. This page updates automatically.</p>
    <div id="message" hidden></div>
    <div class="grid">
      <div class="card"><div class="stat">Tickets today</div><span class="stat-number" id="total">—</span></div>
      <div class="card"><div class="stat">Waiting</div><span class="stat-number" id="waiting">—</span></div>
      <div class="card"><div class="stat">Being served</div><span class="stat-number" id="serving">—</span></div>
      <div class="card"><div class="stat">Completed</div><span class="stat-number" id="completed">—</span></div>
    </div>
    <div class="toolbar"><div class="field"><label for="serviceFilter">Service</label><select id="serviceFilter"><option value="">All services</option></select></div>
    <div class="field"><label for="statusFilter">Status</label><select id="statusFilter"><option value="">All statuses</option><option>waiting</option><option>called</option><option>being_served</option><option>completed</option><option>cancelled</option><option>skipped</option></select></div>
    <div class="field"><label for="search">Search ticket / student</label><input id="search" placeholder="Search..."></div></div>
    <div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Student</th><th>Service</th><th>Appointment</th><th>Status</th><th>Actions</th></tr></thead><tbody id="ticketRows"><tr><td colspan="6">Loading...</td></tr></tbody></table></div>`;
  document.body.innerHTML = layout(content, "admin-dashboard.html", true);
  attachLogout();
  let tickets = [];

  async function refresh() {
    ({ tickets } = await api("/api/tickets?date=today"));
    $("#total").textContent = tickets.length;
    $("#waiting").textContent = tickets.filter(t => t.status === "waiting").length;
    $("#serving").textContent = tickets.filter(t => t.status === "being_served").length;
    $("#completed").textContent = tickets.filter(t => t.status === "completed").length;
    renderRows();
  }
  function renderRows() {
    const service = $("#serviceFilter").value, status = $("#statusFilter").value, search = $("#search").value.toLowerCase();
    const list = tickets.filter(t => (!service || t.service_id === service) && (!status || t.status === status) &&
      `${t.ticket_code} ${t.full_name || ""} ${t.student_id || ""}`.toLowerCase().includes(search));
    $("#ticketRows").innerHTML = list.length ? list.map(t => `<tr>
      <td><strong>${esc(t.ticket_code)}</strong></td><td>${esc(t.full_name || "Student")}<br><span class="muted">${esc(t.student_id || "")}</span></td><td>${esc(t.service_name)}</td>
      <td>${esc(fmtSchedule(t))}</td><td>${statusBadge(t.status)}</td><td><div class="actions">
      ${t.status === "waiting" ? `<button class="btn secondary" data-action="called" data-id="${esc(t.id)}">Call</button>` : ""}
      ${t.status === "called" ? `<button class="btn secondary" data-action="being_served" data-id="${esc(t.id)}">Serving</button>` : ""}
      ${["called","being_served"].includes(t.status) ? `<button class="btn" data-action="completed" data-id="${esc(t.id)}">Complete</button>` : ""}
      ${["waiting","called"].includes(t.status) ? `<button class="btn danger" data-action="skipped" data-id="${esc(t.id)}">Skip</button>` : ""}
      </div></td></tr>`).join("") : `<tr><td colspan="6" class="empty">No tickets match these filters.</td></tr>`;
  }
  // One delegated listener survives table re-renders.
  $("#ticketRows").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-action]");
    if (!b) return;
    const status = b.dataset.action;
    if (!confirm(`Change ticket status to "${status.replaceAll("_", " ")}"?`)) return;
    try {
      await api("/api/ticket-action", { method: "POST", body: { action: "set_status", ticket_id: b.dataset.id, status } });
      showMessage("Ticket updated.", "success"); await refresh();
    } catch (error) { showMessage(friendlyError(error), "error"); }
  });
  ["serviceFilter", "statusFilter", "search"].forEach(id => $("#" + id).addEventListener(id === "search" ? "input" : "change", renderRows));
  try {
    const services = await getServices();
    const opts = services.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
    $("#serviceFilter").insertAdjacentHTML("beforeend", opts);
    await refresh();
    poll(refresh);
  } catch (error) { showMessage(friendlyError(error), "error"); }
});
