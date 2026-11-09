// Small request/response helpers that work on Vercel's Node runtime and the local dev server.
export class HttpError extends Error {
  // `fields` (optional) maps form field names to messages so the page can show them beside each input.
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

export function getQuery(req) {
  return new URL(req.url, "http://localhost").searchParams;
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString() : null;
  if (raw === null) {
    raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 100_000) throw new HttpError(413, "Request too large.");
    }
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, "Invalid JSON body."); }
}

const CONSTRAINT_MESSAGES = {
  users_email_unique: "An account with this email already exists.",
  student_time_unique: "You already have a queue ticket at that date and time.",
  student_service_day_unique: "You already have a queue ticket for this service on that date.",
  tickets_slot_unique: "That time slot was just filled. Please choose another time.",
  tickets_request_id_unique: "This booking was already submitted."
};

/**
 * Wrap an API handler: enforces allowed methods, requires JSON for writes
 * (blocks cross-site form posts), and turns errors into clean JSON responses.
 */
export function route(handlers) {
  return async function handler(req, res) {
    const fn = handlers[req.method];
    if (!fn) { res.setHeader("Allow", Object.keys(handlers).join(", ")); return send(res, 405, { error: "Method not allowed." }); }
    try {
      if (req.method !== "GET" && !String(req.headers["content-type"] || "").includes("application/json")) {
        throw new HttpError(415, "Requests must be sent as JSON.");
      }
      const result = await fn(req, res);
      if (!res.writableEnded) send(res, 200, result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, err.fields ? { error: err.message, fields: err.fields } : { error: err.message });
      if (err?.code === "P0001") return send(res, 400, { error: err.message.replace(/^ERROR:\s*/, "") }); // raised by our SQL functions
      if (err?.code === "23505") {
        const key = Object.keys(CONSTRAINT_MESSAGES).find(k => String(err.constraint || err.message).includes(k));
        return send(res, 409, { error: CONSTRAINT_MESSAGES[key] || "That record already exists." });
      }
      if (err?.code === "22P02" || err?.code === "22007" || err?.code === "22008") return send(res, 400, { error: "Invalid request." });
      console.error(err);
      if (err?.config) return send(res, 500, { error: `Server is not configured: ${err.message}` });
      return send(res, 500, { error: "Something went wrong on the server. Please try again." });
    }
  };
}
