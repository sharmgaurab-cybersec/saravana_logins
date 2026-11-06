import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const config = window.APP_CONFIG || {};
const configured = config.SUPABASE_URL?.startsWith("https://") &&
  config.SUPABASE_PUBLISHABLE_KEY &&
  !config.SUPABASE_PUBLISHABLE_KEY.includes("YOUR_");
const $ = (selector) => document.querySelector(selector);

const publicView = $("#public-view");
const adminLoginView = $("#admin-login-view");
const adminView = $("#admin-view");
const publicMessage = $("#public-message");
const adminLoginMessage = $("#admin-login-message");
const adminMessage = $("#admin-message");
const reportMessage = $("#report-message");
let supabase;
let staff = [];
let reportRows = [];

if (configured) {
  supabase = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
  });
  start();
} else {
  showMessage(publicMessage, "Supabase is not connected. Keep your existing config.js with its project URL and publishable key.", true);
}

function showMessage(target, message, isError = false) {
  target.textContent = message || "";
  target.classList.toggle("error", Boolean(isError));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function showPublic(message = "", isError = false) {
  publicView.classList.remove("hidden");
  adminLoginView.classList.add("hidden");
  adminView.classList.add("hidden");
  $("#admin-open").classList.remove("hidden");
  $("#admin-sign-out").classList.add("hidden");
  showMessage(publicMessage, message, isError);
}

function showAdminLogin(message = "", isError = false) {
  publicView.classList.add("hidden");
  adminView.classList.add("hidden");
  adminLoginView.classList.remove("hidden");
  $("#admin-open").classList.add("hidden");
  $("#admin-sign-out").classList.add("hidden");
  $("#admin-otp-label").classList.add("hidden");
  $("#admin-otp").classList.add("hidden");
  $("#admin-verify-submit").classList.add("hidden");
  $("#admin-resend-code").classList.add("hidden");
  $("#admin-login-submit").classList.remove("hidden");
  $("#admin-login-submit").disabled = false;
  showMessage(adminLoginMessage, message, isError);
}

function showAdmin() {
  publicView.classList.add("hidden");
  adminLoginView.classList.add("hidden");
  adminView.classList.remove("hidden");
  $("#admin-open").classList.add("hidden");
  $("#admin-sign-out").classList.remove("hidden");
  showMessage(adminLoginMessage, "");
}

async function start() {
  $("#report-date").value = sydneyDate();
  updateClock();
  setInterval(updateClock, 30_000);
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(async () => {
      if (session?.user) await authorizeAdmin(session.user);
      else showPublic();
    }, 0);
  });

  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) await authorizeAdmin(session.user);
  else showPublic();
  await loadStaff();
}

function sydneyDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function loadStaff() {
  const { data, error } = await supabase
    .from("staff_members")
    .select("id,name,role,is_active")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) {
    showMessage(publicMessage, `Could not load the staff list: ${error.message}`, true);
    return;
  }
  staff = data || [];
  renderStaff();
  renderAdminStaff();
  renderNameOptions();
}

function renderStaff() {
  const query = $("#search").value.trim().toLocaleLowerCase();
  const visible = staff.filter((person) => person.name.toLocaleLowerCase().includes(query));
  const list = $("#staff-list");
  if (!visible.length) {
    list.innerHTML = `<div class="empty-row">${staff.length ? "No names match your search." : "No active staff members yet. Ask the administrator to add the team."}</div>`;
    return;
  }
  list.innerHTML = visible.map((person) => `
    <article class="staff-row public-staff-row" data-staff-id="${escapeHtml(person.id)}">
      <div class="person">
        <div class="avatar" aria-hidden="true">${escapeHtml(initials(person.name))}</div>
        <div><div class="person-name">${escapeHtml(person.name)}</div><div class="person-role">${escapeHtml(person.role || "Team member")}</div></div>
      </div>
      <div class="clock-actions">
        ${actionButton("sign_in", "Sign in", "primary")}
        ${actionButton("break_start", "Start break", "warm")}
        ${actionButton("break_end", "End break", "quiet")}
        ${actionButton("sign_out", "Sign out", "remove")}
      </div>
    </article>`).join("");
}

function actionButton(action, label, style) {
  return `<button class="action ${style}" type="button" data-action="${action}">${label}</button>`;
}

function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function actionLabel(action) {
  return ({ sign_in: "signed in", break_start: "started a break", break_end: "ended a break", sign_out: "signed out" })[action] || action;
}

async function recordAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const row = button.closest("[data-staff-id]");
  const staffId = row?.dataset.staffId;
  const person = staff.find((item) => item.id === staffId);
  if (!person) return;
  row.querySelectorAll("button").forEach((item) => { item.disabled = true; });
  const { error } = await supabase.rpc("record_staff_clock_action", {
    p_staff_id: staffId,
    p_action: button.dataset.action
  });
  row.querySelectorAll("button").forEach((item) => { item.disabled = false; });
  if (error) {
    showMessage(publicMessage, "That clock action could not be recorded. Check the current shift with the administrator.", true);
    return;
  }
  showMessage(publicMessage, `${person.name}: ${actionLabel(button.dataset.action)} recorded.`);
}

async function authorizeAdmin(user) {
  if (user.email?.toLowerCase() !== "reborngamming1@gmail.com") {
    await supabase.auth.signOut();
    showAdminLogin("This email is not authorized as the administrator.", true);
    return false;
  }
  const { data, error } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || data?.role !== "admin") {
    await supabase.auth.signOut();
    showAdminLogin("This account is not authorized as the administrator.", true);
    return false;
  }
  showAdmin();
  await loadStaff();
  await loadReport();
  return true;
}

async function requestAdminCode() {
  if (!supabase) {
    showMessage(adminLoginMessage, "Supabase is not connected. Keep the existing config.js with its project URL and publishable key.", true);
    return;
  }
  const email = $("#admin-email").value.trim().toLowerCase();
  const button = $("#admin-login-submit");
  button.disabled = true;
  button.textContent = "Sending code…";
  showMessage(adminLoginMessage, "");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false }
  });
  button.disabled = false;
  button.textContent = "Send verification code";
  if (error) {
    showMessage(adminLoginMessage, error.message, true);
    return;
  }
  $("#admin-otp-label").classList.remove("hidden");
  $("#admin-otp").classList.remove("hidden");
  $("#admin-verify-submit").classList.remove("hidden");
  $("#admin-resend-code").classList.remove("hidden");
  button.classList.add("hidden");
  $("#admin-otp").focus();
  showMessage(adminLoginMessage, `A verification code was requested for ${email}. Check inbox and spam.`);
}

async function adminLogin(event) {
  event.preventDefault();
  if (!$("#admin-otp").classList.contains("hidden")) return verifyAdminCode();
  return requestAdminCode();
}

async function verifyAdminCode() {
  if (!supabase) {
    showMessage(adminLoginMessage, "Supabase is not connected. Keep the existing config.js with its project URL and publishable key.", true);
    return;
  }
  const token = $("#admin-otp").value.trim();
  if (!/^\d{6}$/.test(token)) {
    showMessage(adminLoginMessage, "Enter the six-digit code from the email.", true);
    return;
  }
  const button = $("#admin-verify-submit");
  button.disabled = true;
  button.textContent = "Verifying…";
  const email = $("#admin-email").value.trim().toLowerCase();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  button.disabled = false;
  button.textContent = "Verify code and sign in";
  if (error) {
    showMessage(adminLoginMessage, error.message, true);
    return;
  }
  await authorizeAdmin(data.user);
}

async function loadReport() {
  const day = $("#report-date").value;
  if (!day) {
    showMessage(reportMessage, "Choose a work date.", true);
    return;
  }
  const button = $("#load-report");
  button.disabled = true;
  button.textContent = "Loading…";
  const { data, error } = await supabase.rpc("admin_daily_attendance", { p_day: day });
  button.disabled = false;
  button.textContent = "Load day";
  if (error) {
    showMessage(reportMessage, `Could not load the report: ${error.message}`, true);
    return;
  }
  reportRows = data || [];
  renderReport();
  renderNameOptions();
  showMessage(reportMessage, `${reportRows.length} staff row${reportRows.length === 1 ? "" : "s"} for ${day}.`);
}

function renderReport() {
  const body = $("#report-body");
  const query = $("#report-search").value.trim().toLocaleLowerCase();
  const visible = reportRows.filter((row) => String(row.staff_name || "").toLocaleLowerCase().includes(query));
  if (!visible.length) {
    body.innerHTML = `<tr><td colspan="6" class="report-empty">${reportRows.length ? "No staff names match your search." : "No staff or clock actions found for this date."}</td></tr>`;
    return;
  }
  body.innerHTML = visible.map((row) => `
    <tr>
      <td>${escapeHtml(row.staff_name)}</td>
      <td>${escapeHtml(row.sign_in_times || "—")}</td>
      <td>${escapeHtml(row.break_start_times || "—")}</td>
      <td>${escapeHtml(row.break_end_times || "—")}</td>
      <td>${escapeHtml(row.sign_out_times || "—")}</td>
      <td class="hours-cell">${Number(row.hours_worked || 0).toFixed(2)} hrs</td>
    </tr>`).join("");
}

function renderNameOptions() {
  const names = [...new Set([...staff.map((person) => person.name), ...reportRows.map((row) => row.staff_name)].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const options = names.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  $("#staff-name-options").innerHTML = options;
  $("#report-name-options").innerHTML = options;
}

function renderAdminStaff() {
  const list = $("#admin-staff-list");
  if (!list) return;
  const query = $("#admin-staff-search").value.trim().toLocaleLowerCase();
  const visible = staff.filter((person) => person.name.toLocaleLowerCase().includes(query));
  if (!visible.length) {
    list.innerHTML = '<div class="empty-row">No active staff members.</div>';
    return;
  }
  list.innerHTML = visible.map((person) => `
    <div class="admin-staff-row" data-admin-staff-id="${escapeHtml(person.id)}">
      <span><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.role || "Team member")}</small></span>
      <button class="action remove" type="button" data-remove-staff>Remove</button>
    </div>`).join("");
}

function downloadReport() {
  const day = $("#report-date").value;
  if (!reportRows.length) {
    showMessage(reportMessage, "Load a date with attendance data before downloading.", true);
    return;
  }
  const headers = ["Employee", "Sign in", "Break start(s)", "Break end(s)", "Sign out", "Hours worked"];
  const quote = (value) => {
    let cell = String(value ?? "");
    if (/^[\s]*[=+@\-]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replaceAll('"', '""')}"`;
  };
  const rows = reportRows.map((row) => [
    row.staff_name, row.sign_in_times, row.break_start_times,
    row.break_end_times, row.sign_out_times, Number(row.hours_worked || 0).toFixed(2)
  ]);
  const csv = [headers, ...rows].map((row) => row.map(quote).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `saravanaa-attendance-${day}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function addStaff(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  const role = String(data.get("role") || "").trim();
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  const { error } = await supabase.rpc("admin_add_staff", {
    p_name: name,
    p_role: role || null
  });
  button.disabled = false;
  if (error) {
    showMessage(adminMessage, error.message, true);
    return;
  }
  form.reset();
  showMessage(adminMessage, `${name} was added to the clock.`);
  await loadStaff();
}

async function removeStaff(event) {
  const button = event.target.closest("button[data-remove-staff]");
  if (!button) return;
  const row = button.closest("[data-admin-staff-id]");
  const person = staff.find((item) => item.id === row?.dataset.adminStaffId);
  if (!person || !confirm(`Remove ${person.name} from the active staff list? Earlier attendance records will remain.`)) return;
  button.disabled = true;
  const { error } = await supabase.rpc("admin_deactivate_employee", { p_staff_id: person.id });
  if (error) {
    button.disabled = false;
    showMessage(adminMessage, error.message, true);
    return;
  }
  showMessage(adminMessage, `${person.name} was removed. Earlier attendance records remain.`);
  await loadStaff();
}

async function adminSignOut() {
  await supabase.auth.signOut();
  showPublic("Admin signed out.");
}

function updateClock() {
  const now = new Date();
  $("#time-now").textContent = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit"
  }).format(now);
  $("#date-now").textContent = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney", weekday: "long", month: "long", day: "numeric"
  }).format(now);
}

$("#admin-open").addEventListener("click", () => showAdminLogin());
$("#admin-cancel").addEventListener("click", () => showPublic());
$("#admin-login-form").addEventListener("submit", adminLogin);
$("#admin-verify-submit").addEventListener("click", verifyAdminCode);
$("#admin-resend-code").addEventListener("click", requestAdminCode);
$("#admin-sign-out").addEventListener("click", adminSignOut);
$("#staff-list").addEventListener("click", recordAction);
$("#search").addEventListener("input", renderStaff);
$("#load-report").addEventListener("click", loadReport);
$("#report-search").addEventListener("input", renderReport);
$("#download-report").addEventListener("click", downloadReport);
$("#report-date").addEventListener("change", () => showMessage(reportMessage, ""));
$("#add-staff-form").addEventListener("submit", addStaff);
$("#admin-staff-list").addEventListener("click", removeStaff);
$("#admin-staff-search").addEventListener("input", renderAdminStaff);
