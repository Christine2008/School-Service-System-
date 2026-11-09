import { route, readJson, HttpError } from "../lib/http.js";
import { one } from "../lib/db.js";
import { requireUser } from "../lib/auth.js";
import { TICKET_COLUMNS, UUID } from "../lib/tickets.js";

const STATUSES = ["called", "being_served", "completed", "skipped", "cancelled"];

export default route({
  async POST(req) {
    const body = await readJson(req);
    const action = String(body.action || "");

    if (action === "cancel") {
      const user = await requireUser(req, ["student"]);
      if (!UUID.test(String(body.ticket_id || ""))) throw new HttpError(400, "Invalid ticket.");
      const ticket = await one(
        `select ${TICKET_COLUMNS} from cancel_own_waiting_ticket($1::uuid, $2::uuid) t join services s on s.id = t.service_id`,
        [user.id, body.ticket_id]);
      return { ticket };
    }

    const admin = await requireUser(req, ["admin"]);
    if (action === "set_status") {
      if (!UUID.test(String(body.ticket_id || ""))) throw new HttpError(400, "Invalid ticket.");
      if (!STATUSES.includes(body.status)) throw new HttpError(400, "Invalid status change.");
      const ticket = await one(
        `select ${TICKET_COLUMNS}
         from set_ticket_status($1::uuid, $2::uuid, $3::ticket_status, $4::text) t join services s on s.id = t.service_id`,
        [admin.id, body.ticket_id, body.status, "Updated from admin dashboard"]);
      return { ticket };
    }
    throw new HttpError(400, "Unknown action.");
  }
});
