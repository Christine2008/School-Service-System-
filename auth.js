// Passwords (scrypt) and signed session cookies (HMAC-SHA256), using Node's built-in crypto.
import crypto from "node:crypto";
import { one } from "./db.js";
import { HttpError } from "./http.js";

const COOKIE = "rqs_session";
const SESSION_DAYS = 7;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw Object.assign(new Error("SESSION_SECRET must be set to a random string of at least 32 characters."), { config: true });
  }
  return s;
}

const scrypt = (password, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

// A fixed hash used when the email doesn't exist, so response timing doesn't reveal registered emails.
const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, keyB64] = String(stored || DUMMY_HASH).split("$");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual) && Boolean(stored);
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const sign = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest();

export function createToken(userId) {
  const payload = b64url(JSON.stringify({ sub: userId, exp: Date.now() + SESSION_DAYS * 86400_000 }));
  return `${payload}.${b64url(sign(payload))}`;
}

function readToken(token) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

function isLocal(req) {
  const host = String(req.headers.host || "");
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

export function setSessionCookie(req, res, userId) {
  const parts = [`${COOKIE}=${createToken(userId)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_DAYS * 86400}`];
  if (!isLocal(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(req, res) {
  const parts = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (!isLocal(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** The signed-in user (role always read fresh from the database), or null. */
export async function getSessionUser(req) {
  const data = readToken(readCookie(req, COOKIE));
  if (!data) return null;
  return one("select id, email, full_name, student_id, role from users where id = $1::uuid", [data.sub]);
}

/** Require a signed-in user, optionally with one of the given roles. */
export async function requireUser(req, roles) {
  const user = await getSessionUser(req);
  if (!user) throw new HttpError(401, "Please log in first.");
  if (roles && !roles.includes(user.role)) throw new HttpError(403, "You don't have access to this.");
  return user;
}
