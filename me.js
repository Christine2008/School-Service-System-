import { route } from "../../lib/http.js";
import { requireUser } from "../../lib/auth.js";

export default route({
  async GET(req) { return { user: await requireUser(req) }; }
});
