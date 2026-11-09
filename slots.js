import { route, getQuery, HttpError } from "../lib/http.js";
import { query, one } from "../lib/db.js";
import { requireUser } from "../lib/auth.js";
import { SERVICE_IDS } from "../lib/tickets.js";
import { DATE_RE } from "../lib/validation.js";

// Student: the booking window (today .. last bookable day) and, when a date is given,
// that day's time slots for one service with how many seats are left.
export default route({
  async GET(req) {
    await requireUser(req, ["student"]);
    const q = getQuery(req);
    const service = q.get("service_id") || "";
    const date = q.get("date") || "";
    if (!SERVICE_IDS.test(service)) throw new HttpError(400, "Please choose a service.");
    if (date && !DATE_RE.test(date)) throw new HttpError(400, "Invalid date.");

    const { today, max_date } = await one(
      "select app_today()::text as today, (app_today() + booking_window_days())::text as max_date");
    if (!date) return { today, max_date, slots: [] };

    const slots = await query(
      "select slot_time, capacity, booked from get_available_slots($1::text, $2::date)", [service, date]);
    return { today, max_date, date, slots };
  }
});
