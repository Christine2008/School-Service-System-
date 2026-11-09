import { route } from "../lib/http.js";
import { query, one } from "../lib/db.js";
import { requireUser } from "../lib/auth.js";
import { TICKET_COLUMNS } from "../lib/tickets.js";

const ACTIVE = ["waiting", "called", "being_served"];
const bySchedule = (a, b) =>
  (a.queue_date + (a.scheduled_time || "")).localeCompare(b.queue_date + (b.scheduled_time || ""));

// Student: only the signed-in student's own tickets, plus live position for their next active ticket.
export default route({
  async GET(req) {
    const user = await requireUser(req, ["student"]);
    const [tickets, { today }] = await Promise.all([
      query(
        `select ${TICKET_COLUMNS}
         from tickets t join services s on s.id = t.service_id
         where t.student_user_id = $1::uuid
         order by t.queue_date desc, t.scheduled_time desc nulls last, t.issued_at desc
         limit 100`, [user.id]),
      one("select app_today()::text as today")
    ]);
    const active = tickets.filter(t => ACTIVE.includes(t.status)).sort(bySchedule);
    // Next upcoming appointment; older leftover active tickets only if there is nothing upcoming.
    const next = active.find(t => t.queue_date >= today) || active[0] || null;
    const position = next
      ? await one("select people_ahead::int as people_ahead, currently_serving from get_ticket_position($1::uuid, $2::uuid)", [user.id, next.id])
      : null;
    return { today, tickets, ticket: next || tickets[0] || null, active: Boolean(next), position };
  }
});
