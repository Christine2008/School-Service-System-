import { route, readJson, getQuery, HttpError } from "../lib/http.js";
import { query, one } from "../lib/db.js";
import { requireUser } from "../lib/auth.js";
import { TICKET_COLUMNS, SERVICE_IDS, UUID } from "../lib/tickets.js";
import { DATE_RE, TIME_RE } from "../lib/validation.js";

export default route({
  // Admin only: tickets scheduled on a date (default: the school's today), optionally one service,
  // earliest appointment first.
  async GET(req) {
    await requireUser(req, ["admin"]);
    const q = getQuery(req);
    const date = q.get("date") || "today";
    const service = q.get("service") || "";
    if (date !== "today" && date !== "all" && !DATE_RE.test(date)) throw new HttpError(400, "Invalid date.");
    if (service && !SERVICE_IDS.test(service)) throw new HttpError(400, "Invalid service.");

    const where = [], params = [];
    if (date === "today") where.push("t.queue_date = app_today()");
    else if (date !== "all") { params.push(date); where.push(`t.queue_date = $${params.length}::date`); }
    if (service) { params.push(service); where.push(`t.service_id = $${params.length}`); }

    const tickets = await query(
      `select ${TICKET_COLUMNS}, u.full_name, u.student_id
       from tickets t join services s on s.id = t.service_id join users u on u.id = t.student_user_id
       ${where.length ? "where " + where.join(" and ") : ""}
       order by t.queue_date desc, t.scheduled_time asc nulls last, t.ticket_number asc
       limit 2000`, params);
    const { today } = await one("select app_today()::text as today");
    return { today, tickets };
  },

  // Student: book a queue ticket for a service, date and time. All checks (operating hours,
  // capacity, duplicates) run again inside the database function, atomically.
  async POST(req) {
    const user = await requireUser(req, ["student"]);
    const { service_id, date, time, request_id } = await readJson(req);
    if (!SERVICE_IDS.test(String(service_id || ""))) throw new HttpError(400, "Please choose a service.");
    if (!DATE_RE.test(String(date || ""))) throw new HttpError(400, "Please choose an appointment date.");
    if (!TIME_RE.test(String(time || ""))) throw new HttpError(400, "Please choose an appointment time.");
    if (request_id !== undefined && !UUID.test(String(request_id))) throw new HttpError(400, "Invalid request.");
    const ticket = await one(
      `select ${TICKET_COLUMNS}
       from create_queue_ticket($1::uuid, $2::text, $3::date, $4::time, $5::uuid) t
       join services s on s.id = t.service_id`,
      [user.id, service_id, date, time, request_id ?? null]);
    return { ticket };
  }
});
