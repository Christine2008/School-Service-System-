// Student "Queue Status": the signed-in student's own tickets only (the API filters by session).
document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireUser(["student"]);
  if (!session) return;
  const content = `<h1>Queue Status</h1><p class="subtitle">Your queue tickets and their current status. This page updates automatically.</p>
    <div id="message" role="alert" hidden></div>
    <div id="nextArea">${spinner("Loading your tickets...")}</div>
    <h2>My queue tickets</h2><div id="ticketList"></div>`;
  document.body.innerHTML = layout(content, "queue-status.html");
  attachLogout();

  let lastSignature = "";
  async function render() {
    const { today, tickets, ticket, active, position } = await api("/api/my-ticket");
    const signature = JSON.stringify([tickets.map(t => [t.id, t.status]), position, today]);
    if (signature === lastSignature) return;
    lastSignature = signature;

    if (!tickets.length) {
      $("#nextArea").innerHTML = `<div class="card empty">You don't have any queue tickets yet.<p><a class="btn" href="student-dashboard.html">Get a Queue Ticket</a></p></div>`;
      $("#ticketList").innerHTML = "";
      return;
    }

    // Featured card: the next active ticket (with live position when it is scheduled for today).
    if (active) {
      const called = ["called", "being_served"].includes(ticket.status);
      const isToday = ticket.queue_date === today;
      $("#nextArea").innerHTML = `<div class="card ticket"><div class="service-icon" aria-hidden="true">🎟️</div><p class="muted" style="margin:0">Next appointment · ${esc(ticket.service_name)}</p>
        <div class="ticket-number">${esc(ticket.ticket_code)}</div>${statusBadge(ticket.status)}
        <p><strong>${esc(fmtSchedule(ticket))}</strong></p>
        ${called ? `<div class="notice success">It's your turn — please proceed to the registrar window.</div>` : ""}
        ${isToday ? `<div class="grid two"><div class="card"><div class="stat">People waiting ahead</div><span class="stat-number">${esc(position?.people_ahead ?? "—")}</span></div>
        <div class="card"><div class="stat">Currently called / serving</div><span class="stat-number" style="font-size:23px">${esc(position?.currently_serving || "—")}</span></div></div>` : ""}</div>`;
    } else {
      $("#nextArea").innerHTML = `<div class="card empty">You have no upcoming queue tickets.<p><a class="btn" href="student-dashboard.html">Get a Queue Ticket</a></p></div>`;
    }

    $("#ticketList").innerHTML = tickets.map(t => `<article class="card ticket-item">
      <div class="code">${esc(t.ticket_code)}</div>
      <div class="meta"><strong>${esc(t.service_name)}</strong>
        <span>Appointment: ${esc(fmtSchedule(t))}</span>
        <span class="muted">Booked: ${esc(formatDate(t.issued_at))}</span></div>
      <div class="side">${statusBadge(t.status)}${t.status === "waiting" ? `<button type="button" class="btn danger" data-cancel="${esc(t.id)}">Cancel ticket</button>` : ""}</div></article>`).join("");
  }

  // One delegated listener survives re-renders.
  $("#ticketList").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-cancel]");
    if (!b) return;
    if (!confirm("Cancel this ticket? Your time slot will be released.")) return;
    b.disabled = true;
    try {
      await api("/api/ticket-action", { method: "POST", body: { action: "cancel", ticket_id: b.dataset.cancel } });
      showMessage("Ticket cancelled.", "success"); lastSignature = ""; await render();
    } catch (error) { showMessage(friendlyError(error), "error"); b.disabled = false; }
  });

  try { await render(); poll(render); }
  catch (error) { $("#nextArea").innerHTML = ""; showMessage(friendlyError(error), "error"); }
});
