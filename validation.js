// Server-side validation for registration. The same rules are mirrored in public/js/auth.js
// for instant feedback, but this file is the one that counts.
const NAME_PART = /^[\p{L}][\p{L}\p{M} .'’-]*$/u;
const SECTION = /^[A-Za-z0-9][A-Za-z0-9 .&'-]{0,29}$/;
const GMAIL = /^[a-z0-9._%+-]+@gmail\.com$/i;
const PH_MOBILE = /^09\d{9}$/;

export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 8;

/** "Surname, First Name, Middle Name" -> normalised string, or an error message. */
export function checkFullName(input) {
  const raw = String(input ?? "").trim();
  const parts = raw.split(",").map(p => p.trim());
  if (parts.length !== 3 || parts.some(p => !p)) {
    return { error: "Enter your name as: Surname, First Name, Middle Name (example: Dela Cruz, Juan, Santos)." };
  }
  if (!parts.every(p => NAME_PART.test(p))) {
    return { error: "Names can only contain letters, spaces, periods, hyphens and apostrophes." };
  }
  const value = parts.join(", ");
  if (value.length > 120) return { error: "Your full name is too long." };
  return { value };
}

/** "Grade 12 - ICT" -> normalised "Grade 12 - ICT", or an error message. */
export function checkStudentId(input) {
  const m = String(input ?? "").trim().match(/^grade\s*(\d{1,2})\s*-\s*(.+)$/i);
  const grade = m ? Number(m[1]) : 0;
  const section = m ? m[2].trim() : "";
  if (!m || grade < 1 || grade > 12 || !SECTION.test(section)) {
    return { error: "Enter your grade and section as: Grade - Section (example: Grade 12 - ICT)." };
  }
  return { value: `Grade ${grade} - ${section}` };
}

export function checkEmail(input) {
  const value = String(input ?? "").trim().toLowerCase();
  if (!GMAIL.test(value) || value.length > 254) return { error: "Enter a valid Gmail address ending in @gmail.com." };
  return { value };
}

export function checkPhone(input) {
  const value = String(input ?? "").trim();
  if (!PH_MOBILE.test(value)) return { error: "Enter an 11-digit mobile number starting with 09 (example: 09123456789)." };
  return { value };
}

// Never trimmed or truncated: what the student typed is what gets hashed.
export function checkPassword(input) {
  const value = String(input ?? "");
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    return { error: `Password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters long.` };
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return { error: "Password must include at least one letter and one number." };
  }
  return { value };
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
