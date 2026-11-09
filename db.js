// Database access. Production uses Neon's serverless HTTP driver.
// Every operation in this app is a single SQL statement (queue logic lives in
// SQL functions in db/schema.sql), so each call is atomic on its own.
import path from "node:path";
import { pathToFileURL } from "node:url";

let impl = null;

async function getImpl() {
  if (impl) return impl;
  if (process.env.DB_ADAPTER) {
    // Optional local/test adapter exposing { query(text, params) }.
    const mod = await import(pathToFileURL(path.resolve(process.env.DB_ADAPTER)).href);
    impl = mod.default;
  } else {
    if (!process.env.DATABASE_URL) throw Object.assign(new Error("DATABASE_URL is not set."), { config: true });
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL);
    impl = { query: (text, params) => sql.query(text, params) };
  }
  return impl;
}

/** Run one parameterised statement and return the result rows. */
export async function query(text, params = []) {
  return (await getImpl()).query(text, params);
}

export async function one(text, params = []) {
  const rows = await query(text, params);
  return rows[0] ?? null;
}
