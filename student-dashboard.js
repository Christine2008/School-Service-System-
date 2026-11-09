document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireUser(["student"]);
  if (!session) return;
  const { profile } = session;
  // Names are stored as "Surname, First Name, Middle Name"; greet with the first name.
  const nameParts = profile.full_name.split(",").map(p => p.trim());
  const firstName = nameParts.length >= 2 ? nameParts[1] : profile.full_name.split(" ")[0];

  const content = `<h1 id="welcome"></h1><p class="subtitle">Book a queue ticket for the school service you need, without waiting in a physical line.</p>
    <div id="message" role="alert" hidden></div>
    <div class="grid">
      <section class="card"><div class="stat">Your next ticket</div><span class="stat-number" id="activeTicket">—</span><p class="muted" id="activeStatus">No active ticket</p><a class="btn secondary" href="queue-status.html">View queue status</a></section>
      <section class="card"><div class="stat">Available services</div><span class="stat-number" id="serviceCount">—</span><p class="muted">Choose the services you need.</p></section>
      <section class="card"><div class="stat">Your account</div><span class="stat-number" style="font-size:20px" id="studentName"></span><p class="muted" id="studentId"></p></section>
    </div>
    <h2 id="servicesHeading">Available registrar services</h2>
    <fieldset class="service-picker"><legend class="sr-only">Select a service</legend>
      <div class="grid" id="servicesGrid">${spinner("Loading services...")}</div></fieldset>
    <div class="get-ticket"><button type="button" class="btn" id="getTicket">Get Queue Ticket</button>
      <p class="field-error" id="serviceHint" role="alert"></p></div>`;
  document.body.innerHTML = layout(content, "student-dashboard.html");
  attachLogout();
  $("#welcome").textContent = `Welcome, ${firstName}!`;
  $("#studentName").textContent = profile.full_name;
  $("#studentId").textContent = profile.student_id ? `Student ID: ${profile.student_id}` : "Student account";

  async function refreshTicket() {
    const { ticket, active } = await api("/api/my-ticket");
    if (ticket && active) {
      $("#activeTicket").textContent = ticket.ticket_code;
      $("#activeStatus").innerHTML = `${statusBadge(ticket.status)}<br><span class="muted">${esc(fmtSchedule(ticket))}</span>`;
    } else { $("#activeTicket").textContent = "—"; $("#activeStatus").textContent = "No active ticket"; }
  }

  let services = [];
  try {
    await refreshTicket();
    services = await getServices();
    $("#serviceCount").textContent = services.length;
    $("#servicesGrid").innerHTML = services.map(s => `<label class="service-option">
      <input class="sr-only" type="radio" name="service" value="${esc(s.id)}">
      <div class="card so-body"><div class="service-icon" aria-hidden="true">${serviceIcon(s.id)}</div><h2>${esc(s.name)}</h2><p class="muted">${esc(s.description)}</p></div></label>`).join("")
      || `<div class="empty">No services are available right now.</div>`;
    poll(refreshTicket);
  } catch (error) { showMessage(friendlyError(error), "error"); }

  $("#servicesGrid").addEventListener("change", () => { $("#serviceHint").textContent = ""; });
  $("#getTicket").addEventListener("click", () => {
    const picked = $('input[name="service"]:checked');
    if (!picked) {
      $("#serviceHint").textContent = "Please select a service first.";
      $("#servicesGrid input")?.focus();
      return;
    }
    const service = services.find(s => s.id === picked.value);
    if (!service) return;
    openBookingModal({
      service, profile, opener: $("#getTicket"),
      onBooked: () => { clearMessage(); refreshTicket().catch(() => {}); }
    });
  });
});
