import { route } from "../lib/http.js";
import { query } from "../lib/db.js";

export default route({
  async GET() {
    const services = await query("select id, name, prefix, description from services where active order by name");
    return { services };
  }
});
