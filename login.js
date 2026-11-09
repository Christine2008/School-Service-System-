import { route, readJson, HttpError } from "../../lib/http.js";
import { one } from "../../lib/db.js";
import { verifyPassword, setSessionCookie } from "../../lib/auth.js";

export default route({
  async POST(req, res) {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const row = email ? await one(
      "select id, email, full_name, student_id, role, password_hash from users where lower(email) = $1", [email]) : null;
    const ok = await verifyPassword(password, row?.password_hash);
    if (!row || !ok) throw new HttpError(401, "Incorrect email or password.");
    setSessionCookie(req, res, row.id);
    const { password_hash, ...user } = row;
    return { user };
  }
});
