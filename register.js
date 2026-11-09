import { route, readJson, HttpError } from "../../lib/http.js";
import { one } from "../../lib/db.js";
import { hashPassword, setSessionCookie } from "../../lib/auth.js";
import { checkFullName, checkStudentId, checkEmail, checkPhone, checkPassword } from "../../lib/validation.js";

const DUPLICATE_EMAIL = "An account with this email already exists.";

export default route({
  async POST(req, res) {
    const body = await readJson(req);
    const checks = {
      full_name: checkFullName(body.full_name),
      student_id: checkStudentId(body.student_id),
      email: checkEmail(body.email),
      phone: checkPhone(body.phone),
      password: checkPassword(body.password)
    };
    const fields = {};
    for (const [name, result] of Object.entries(checks)) if (result.error) fields[name] = result.error;
    // The confirmation field is optional for API clients, but if it is sent it must match.
    if (body.confirm_password !== undefined && body.confirm_password !== body.password) {
      fields.confirm_password = "Passwords do not match.";
    }
    if (Object.keys(fields).length) throw new HttpError(400, "Please fix the highlighted fields.", fields);

    // Fast duplicate check for a clear message; the unique index below is what truly guarantees it.
    if (await one("select 1 as taken from users where lower(email) = $1", [checks.email.value])) {
      throw new HttpError(409, DUPLICATE_EMAIL, { email: DUPLICATE_EMAIL });
    }

    // New accounts are always students; staff are promoted by the project owner.
    // The hash is computed first so nothing is written unless every step before it succeeded.
    const password_hash = await hashPassword(checks.password.value);
    let user;
    try {
      user = await one(
        `insert into users (email, password_hash, full_name, student_id, phone, role)
         values ($1, $2, $3, $4, $5, 'student')
         returning id, email, full_name, student_id, role`,
        [checks.email.value, password_hash, checks.full_name.value, checks.student_id.value, checks.phone.value]);
    } catch (err) {
      if (err?.code === "23505") throw new HttpError(409, DUPLICATE_EMAIL, { email: DUPLICATE_EMAIL });
      throw err;
    }
    setSessionCookie(req, res, user.id);
    return { user };
  }
});
