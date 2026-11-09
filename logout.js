import { route } from "../../lib/http.js";
import { clearSessionCookie } from "../../lib/auth.js";

export default route({
  async POST(req, res) { clearSessionCookie(req, res); return { ok: true }; }
});
