// Client-side checks give instant feedback; the server repeats every one of them.
const NAME_PART = /^[\p{L}][\p{L}\p{M} .'’-]*$/u;
const SECTION = /^[A-Za-z0-9][A-Za-z0-9 .&'-]{0,29}$/;

const validators = {
  full_name(raw) {
    const parts = String(raw).trim().split(",").map(p => p.trim());
    if (parts.length !== 3 || parts.some(p => !p)) return "Enter your name as: Surname, First Name, Middle Name (example: Dela Cruz, Juan, Santos).";
    if (!parts.every(p => NAME_PART.test(p))) return "Names can only contain letters, spaces, periods, hyphens and apostrophes.";
    if (parts.join(", ").length > 120) return "Your full name is too long.";
    return "";
  },
  student_id(raw) {
    const m = String(raw).trim().match(/^grade\s*(\d{1,2})\s*-\s*(.+)$/i);
    if (!m || +m[1] < 1 || +m[1] > 12 || !SECTION.test(m[2].trim())) return "Enter your grade and section as: Grade - Section (example: Grade 12 - ICT).";
    return "";
  },
  email(raw) {
    const v = String(raw).trim();
    return /^[a-z0-9._%+-]+@gmail\.com$/i.test(v) && v.length <= 254 ? "" : "Enter a valid Gmail address ending in @gmail.com.";
  },
  phone(raw) {
    return /^09\d{9}$/.test(String(raw).trim()) ? "" : "Enter an 11-digit mobile number starting with 09 (example: 09123456789).";
  },
  password(v) {
    if (v.length < 6 || v.length > 8) return "Password must be 6 to 8 characters long.";
    if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return "Password must include at least one letter and one number.";
    return "";
  }
};
// form field name -> input element id
const FIELD_IDS = { full_name: "fullName", student_id: "studentId", email: "email", phone: "phone", password: "password", confirm_password: "confirmPassword" };

function setFieldError(name, message) {
  const id = FIELD_IDS[name];
  const input = document.getElementById(id), out = document.getElementById(id + "-error");
  if (!input || !out) return;
  out.textContent = message || "";
  if (message) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
}

document.addEventListener("DOMContentLoaded", async () => {
  // Already signed in? Go straight to the right dashboard.
  api("/api/auth/me").then(({ user }) => { location.href = homeFor(user.role); }).catch(() => {});

  if ($("#loginForm")) {
    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault(); clearMessage();
      const email = $("#email").value.trim(), password = $("#password").value;
      if (!email || !password) return showMessage("Enter your email address and password.", "error");
      const button = $("#loginBtn"); button.disabled = true; button.textContent = "Signing in...";
      try {
        const { user } = await api("/api/auth/login", { method: "POST", body: { email, password } });
        location.href = homeFor(user.role);
      } catch (error) {
        showMessage(friendlyError(error), "error"); button.disabled = false; button.textContent = "Log in";
      }
    });
  }

  if ($("#registerForm")) {
    const form = $("#registerForm");
    const values = () => ({
      full_name: $("#fullName").value, student_id: $("#studentId").value, email: $("#email").value,
      phone: $("#phone").value, password: $("#password").value, confirm_password: $("#confirmPassword").value
    });
    function validateAll(v) {
      const errors = {};
      for (const name of Object.keys(validators)) { const msg = validators[name](v[name]); if (msg) errors[name] = msg; }
      if (!v.confirm_password) errors.confirm_password = "Please re-enter your password.";
      else if (v.confirm_password !== v.password) errors.confirm_password = "Passwords do not match.";
      return errors;
    }
    // Validate a field when the student leaves it, and clear its error as soon as it becomes valid.
    for (const [name, id] of Object.entries(FIELD_IDS)) {
      const input = document.getElementById(id);
      input.addEventListener("blur", () => { if (input.value) setFieldError(name, validateAll(values())[name]); });
      input.addEventListener("input", () => { if (input.getAttribute("aria-invalid") && !validateAll(values())[name]) setFieldError(name, ""); });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault(); clearMessage();
      const v = values(), errors = validateAll(v);
      for (const name of Object.keys(FIELD_IDS)) setFieldError(name, errors[name]);
      const first = Object.keys(FIELD_IDS).find(n => errors[n]);
      if (first) { document.getElementById(FIELD_IDS[first]).focus(); return showMessage("Please fix the highlighted fields.", "error"); }

      const button = $("#registerBtn"); button.disabled = true; button.textContent = "Creating account...";
      try {
        await api("/api/auth/register", { method: "POST", body: v });
        showMessage("Account created successfully! Taking you to your dashboard...", "success");
        button.textContent = "Account created";
        setTimeout(() => { location.href = "student-dashboard.html"; }, 1500);
      } catch (error) {
        showMessage(friendlyError(error), "error");
        for (const [name, msg] of Object.entries(error.fields || {})) setFieldError(name, msg);
        const firstServer = Object.keys(error.fields || {})[0];
        if (firstServer && FIELD_IDS[firstServer]) document.getElementById(FIELD_IDS[firstServer]).focus();
        button.disabled = false; button.textContent = "Create account";
      }
    });
  }
});
