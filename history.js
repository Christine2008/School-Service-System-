document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireUser(["admin"]);
  if (!session) return;
  const content = `<h1>Queue History & Reports</h1><p class="subtitle">Review queue activity and export the filtered records.</p>
    <div id="message" hidden></div>
    <div class="toolbar"><div class="field"><label for="dateFilter">Appointment date (blank = all dates)</label><input type="date" id="dateFilter"></div><div class="field"><label for="serviceFilter">Service</label><select id="serviceFilter"><option value="">All services</option></select></div><button class="btn" id="exportCsv">Export CSV</button></div>
    <div class="grid"><div class="card"><div class="stat">Records shown</div><span class="stat-number" id="count">0</span></div><div class="card"><div class="stat">Completed</div><span class="stat-number" id="completed">0</span></div></div>
    <div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Student</th><th>Service</th><th>Status</th><th>Appointment date</th><th>Time</th><th>Booked</th><th>Last updated</th></tr></thead><tbody id="rows"><tr><td colspan="8">Loading...</td></tr></tbody></table></div>`;
  document.body.innerHTML = layout(content, "queue-history.html", true);
  attachLogout();
  let rows = [];

  async function load() {
    const date = $("#dateFilter").value || "all";
    const service = $("#serviceFilter").value;
    const data = await api(`/api/tickets?date=${encodeURIComponent(date)}${service ? `&service=${encodeURIComponent(service)}` : ""}`);
    rows = data.tickets;
    $("#count").textContent = rows.length;
    $("#completed").textContent = rows.filter(t => t.status === "completed").length;
    $("#rows").innerHTML = rows.length ? rows.map(t => `<tr><td><strong>${esc(t.ticket_code)}</strong></td><td>${esc(t.full_name)}<br><span class="muted">${esc(t.student_id || "")}</span></td><td>${esc(t.service_name)}</td><td>${statusBadge(t.status)}</td><td>${esc(fmtDate(t.queue_date))}</td><td>${esc(fmtTime(t.scheduled_time))}</td><td>${formatDate(t.issued_at)}</td><td>${formatDate(t.updated_at)}</td></tr>`).join("") : `<tr><td colspan="8" class="empty">No history for the selected filters.</td></tr>`;
    return data;
  }
  try {
    const services = await getServices();
    $("#serviceFilter").insertAdjacentHTML("beforeend", services.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join(""));
    const { today } = await load();       // first load gets the school's "today"
    $("#dateFilter").value = today;
    await load();
  } catch (error) { showMessage(friendlyError(error), "error"); }
  const reload = () => load().catch(e => showMessage(friendlyError(e), "error"));
  $("#dateFilter").addEventListener("change", reload);
  $("#serviceFilter").addEventListener("change", reload);
  $("#exportCsv").addEventListener("click", () => {
    // Prefix risky leading characters so spreadsheet apps don't treat cells as formulas.
    const cell = v => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replaceAll('"', '""')}"`; };
    const csv = [["Ticket","Student","Student ID","Service","Status","Appointment Date","Appointment Time","Booked At","Updated At","Completed At"],
      ...rows.map(t => [t.ticket_code, t.full_name, t.student_id, t.service_name, t.status, t.queue_date, t.scheduled_time, t.issued_at, t.updated_at, t.completed_at])]
      .map(r => r.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = `queue-history-${$("#dateFilter").value || "all"}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
});
