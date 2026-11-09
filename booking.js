// "Get Queue Ticket" modal: pick a date and time, review, confirm, done.
// Availability shown here is only a convenience — the server re-checks everything on confirm.
function newRequestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function openBookingModal({ service, profile, onBooked, opener }) {
  const state = { step: "schedule", today: "", maxDate: "", date: "", time: "", slots: [], submitting: false, requestId: "", ticket: null, slotLoad: 0 };

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="bkTitle">
    <div class="modal-head"><h2 id="bkTitle">Get Queue Ticket</h2><button type="button" class="icon-btn" id="bkClose" aria-label="Close">✕</button></div>
    <div class="modal-body"><div id="bkMsg" role="alert" hidden></div><div id="bkBody">${spinner("Loading schedule...")}</div></div></div>`;
  document.body.appendChild(overlay);
  document.body.classList.add("modal-open");
  const dialog = overlay.querySelector(".modal");
  const body = () => overlay.querySelector("#bkBody");
  const msg = (text, type = "error") => showMessage(text, type, "#bkMsg");

  function close() {
    if (state.submitting) return;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    document.body.classList.remove("modal-open");
    opener?.focus();
  }
  function onKey(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(); return; }
    if (e.key !== "Tab") return;
    const items = [...dialog.querySelectorAll("button, input, [href], select")].filter(el => !el.disabled && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (!dialog.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener("keydown", onKey, true);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#bkClose").addEventListener("click", close);

  // ---- Step 1: schedule ----
  function renderSchedule() {
    state.step = "schedule"; clearMessage("#bkMsg");
    body().innerHTML = `<p class="muted" style="margin-top:0">Booking for <span class="chip">${serviceIcon(service.id)} ${esc(service.name)}</span></p>
      <div class="field"><label for="bkDate">Appointment date</label>
        <input type="date" id="bkDate" min="${esc(state.today)}" max="${esc(state.maxDate)}" value="${esc(state.date)}" required>
        <p class="hint">You can book from today up to ${esc(fmtDate(state.maxDate))}.</p></div>
      <div id="bkSlots" aria-live="polite"></div>
      <div class="modal-actions"><button type="button" class="btn secondary" id="bkCancel">Cancel</button>
        <button type="button" class="btn" id="bkNext" disabled>Review booking</button></div>`;
    body().querySelector("#bkCancel").addEventListener("click", close);
    body().querySelector("#bkNext").addEventListener("click", renderReview);
    body().querySelector("#bkDate").addEventListener("change", (e) => { state.date = e.target.value; state.time = ""; loadSlots(); });
    loadSlots();
  }

  async function loadSlots() {
    const box = body().querySelector("#bkSlots"), next = body().querySelector("#bkNext");
    next.disabled = true; clearMessage("#bkMsg");
    if (!state.date) { box.innerHTML = ""; return; }
    if (state.date < state.today || state.date > state.maxDate) {
      box.innerHTML = ""; msg(state.date < state.today ? "You can't book a past date." : `Bookings are open only until ${fmtDate(state.maxDate)}.`); return;
    }
    const mine = ++state.slotLoad;               // ignore answers that arrive after the date changed again
    box.innerHTML = spinner("Checking available times...");
    try {
      const data = await api(`/api/slots?service_id=${encodeURIComponent(service.id)}&date=${encodeURIComponent(state.date)}`);
      if (mine !== state.slotLoad) return;
      state.slots = data.slots;
      if (!state.slots.length) {
        box.innerHTML = `<div class="notice">No time slots are available for ${esc(service.name)} on ${esc(fmtDate(state.date))}. Please choose another date.</div>`; return;
      }
      if (!state.slots.some(s => s.slot_time === state.time && s.booked < s.capacity)) state.time = "";
      const anyOpen = state.slots.some(s => s.booked < s.capacity);
      box.innerHTML = `<fieldset class="slot-fieldset"><legend>Available times</legend>
        ${anyOpen ? "" : `<div class="notice">All time slots on this date are fully booked. Please choose another date.</div>`}
        <div class="slots">${state.slots.map(s => {
          const left = s.capacity - s.booked, full = left <= 0;
          return `<label class="slot"><input type="radio" name="slot" value="${esc(s.slot_time)}" ${full ? "disabled" : ""} ${s.slot_time === state.time ? "checked" : ""}>
            <span>${esc(fmtTime(s.slot_time))}<small>${full ? "Full" : `${left} left`}</small></span></label>`;
        }).join("")}</div></fieldset>`;
      const sync = () => { next.disabled = !state.time; };
      box.querySelectorAll('input[name="slot"]').forEach(r => r.addEventListener("change", () => { state.time = r.value; sync(); }));
      sync();
    } catch (error) {
      if (mine !== state.slotLoad) return;
      box.innerHTML = ""; msg(friendlyError(error));
    }
  }

  // ---- Step 2: review & confirm ----
  function renderReview() {
    state.step = "review"; clearMessage("#bkMsg");
    state.requestId = newRequestId();           // one id per confirmation attempt: retries can't create a second ticket
    body().innerHTML = `<p class="muted" style="margin-top:0">Please review your booking.</p>
      <dl class="summary">
        <div><dt>Student name</dt><dd>${esc(profile.full_name)}</dd></div>
        <div><dt>Student ID</dt><dd>${esc(profile.student_id || "—")}</dd></div>
        <div><dt>Service</dt><dd>${esc(service.name)}</dd></div>
        <div><dt>Appointment date</dt><dd>${esc(fmtDate(state.date))}</dd></div>
        <div><dt>Appointment time</dt><dd>${esc(fmtTime(state.time))}</dd></div></dl>
      <p><button type="button" class="btn link-btn" id="bkBack">‹ Change date or time</button></p>
      <div class="modal-actions"><button type="button" class="btn secondary" id="bkCancel">Cancel</button>
        <button type="button" class="btn" id="bkConfirm">Confirm Queue Ticket</button></div>`;
    body().querySelector("#bkCancel").addEventListener("click", close);
    body().querySelector("#bkBack").addEventListener("click", () => { if (!state.submitting) renderSchedule(); });
    body().querySelector("#bkConfirm").addEventListener("click", submitBooking);
    body().querySelector("#bkConfirm").focus();
  }

  async function submitBooking() {
    if (state.submitting) return;                // blocks double clicks
    state.submitting = true; clearMessage("#bkMsg");
    const btn = body().querySelector("#bkConfirm"), cancel = body().querySelector("#bkCancel"), back = body().querySelector("#bkBack");
    btn.disabled = cancel.disabled = back.disabled = true;
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> Booking...`;
    try {
      const { ticket } = await api("/api/tickets", { method: "POST", body: { service_id: service.id, date: state.date, time: state.time, request_id: state.requestId } });
      state.ticket = ticket; state.submitting = false;
      renderSuccess(); onBooked?.(ticket);
    } catch (error) {
      state.submitting = false;
      btn.disabled = cancel.disabled = back.disabled = false; btn.textContent = "Confirm Queue Ticket";
      msg(friendlyError(error));
    }
  }

  // ---- Step 3: confirmation ----
  function renderSuccess() {
    state.step = "done";
    const t = state.ticket;
    overlay.querySelector("#bkTitle").textContent = "Queue ticket confirmed";
    msg("Your queue ticket has been booked successfully.", "success");
    body().innerHTML = `<div style="text-align:center"><p class="muted" style="margin:0">Your ticket number</p><div class="ticket-number">${esc(t.ticket_code)}</div></div>
      <dl class="summary">
        <div><dt>Service</dt><dd>${esc(t.service_name)}</dd></div>
        <div><dt>Appointment date</dt><dd>${esc(fmtDate(t.queue_date))}</dd></div>
        <div><dt>Appointment time</dt><dd>${esc(fmtTime(t.scheduled_time))}</dd></div></dl>
      <div class="modal-actions"><a class="btn secondary" href="queue-status.html">View Queue Status</a><button type="button" class="btn" id="bkDone">Done</button></div>`;
    body().querySelector("#bkDone").addEventListener("click", close);
    body().querySelector("#bkDone").focus();
  }

  // ---- Start: learn the school's "today" and the booking window from the server ----
  (async () => {
    try {
      const { today, max_date } = await api(`/api/slots?service_id=${encodeURIComponent(service.id)}`);
      state.today = today; state.maxDate = max_date; state.date = today;
      renderSchedule();
      body().querySelector("#bkDate").focus();
    } catch (error) {
      body().innerHTML = `<div class="notice error">${esc(friendlyError(error))}</div><div class="modal-actions"><button type="button" class="btn secondary" id="bkCancel">Close</button></div>`;
      body().querySelector("#bkCancel").addEventListener("click", close);
    }
  })();
}
