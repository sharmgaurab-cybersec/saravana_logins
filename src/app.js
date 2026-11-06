import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const config = window.APP_CONFIG || {};
const configured = config.SUPABASE_URL?.startsWith("https://") &&
  config.SUPABASE_PUBLISHABLE_KEY &&
  !config.SUPABASE_PUBLISHABLE_KEY.includes("YOUR_");

const $ = (selector) => document.querySelector(selector);
const loginView = $("#login-view");
const dashboardView = $("#dashboard-view");
const emailForm = $("#email-form");
const otpForm = $("#otp-form");
const loginMessage = $("#login-message");
const appMessage = $("#app-message");
let supabase;
let currentUser;
let profile;
let staff = [];
let activity = [];
let clockTimer;

if (configured) {
  supabase = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
  });
  start();
} else {
  loginMessage.textContent = "Connect this project to Supabase first: add your project URL and publishable key in config.js.";
  $("#send-code").disabled = true;
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

function cleanEmail(email) {
  return email.trim().toLowerCase();
}

async function start() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) await loadDashboard(session.user);
  supabase.auth.onAuthStateChange((_event, sessionNow) => {
    setTimeout(() => {
      if (sessionNow) loadDashboard(sessionNow.user);
      else showLogin();
    }, 0);
  });
  updateClock();
  clockTimer = setInterval(updateClock, 30_000);
}

async function requestOtp(event) {
  event.preventDefault();
  const email = cleanEmail($("#email").value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showMessage(loginMessage, "Enter a valid email address.", true);
    return;
  }
  const button = $("#send-code");
  button.disabled = true;
  button.textContent = "Sending…";
  showMessage(loginMessage, "");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true }
  });
  button.disabled = false;
  button.textContent = "Send verification code";
  if (error) {
    showMessage(loginMessage, error.message, true);
    return;
  }
  emailForm.classList.add("hidden");
  otpForm.classList.remove("hidden");
  showMessage(loginMessage, `A verification code was emailed to ${email}. Check your inbox and spam folder.`);
  $("#otp").focus();
}

async function verifyOtp(event) {
  event.preventDefault();
  const email = cleanEmail($("#email").value);
  const token = $("#otp").value.trim();
  if (!/^\d{6}$/.test(token)) {
    showMessage(loginMessage, "Enter the 6-digit code from your email.", true);
    return;
  }
  const button = otpForm.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Verifying…";
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  button.disabled = false;
  button.textContent = "Verify and sign in";
  if (error) showMessage(loginMessage, error.message, true);
}

async function loadDashboard(user) {
  currentUser = user;
  const { data: row, error } = await supabase
    .from("user_profiles")
    .select("role, staff_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    showMessage(loginMessage, `Could not load account profile: ${error.message}`, true);
    return;
  }
  if (!row || !["admin", "employee"].includes(row.role)) {
    showMessage(loginMessage, "This account does not have staff-clock access. Ask an administrator.", true);
    loginView.classList.remove("hidden");
    dashboardView.classList.add("hidden");
    $("#sign-out").classList.remove("hidden");
    return;
  }
  if (row.role === "employee" && !row.staff_id) {
    loginView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
    $("#sign-out").classList.remove("hidden");
    $("#greeting").textContent = "Staff access pending";
    $("#account-label").textContent = user.email || "Verified email account";
    $("#admin-panel").classList.add("hidden");
    $(".summary-grid").classList.add("hidden");
    $(".panel").classList.add("hidden");
    showMessage(appMessage, "Your email is verified, but it is not linked to an active staff member. Ask the manager to add this email, then sign in again.", true);
    profile = row;
    return;
  }
  profile = row;
  loginView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
  $("#sign-out").classList.remove("hidden");
  $("#admin-panel").classList.toggle("hidden", row.role !== "admin");
  $(".summary-grid").classList.remove("hidden");
  $(".panel").forEach?.(() => {});
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("hidden"));
  $("#greeting").textContent = row.role === "admin" ? "Admin dashboard" : "Your shift";
  $("#account-label").textContent = user.email || "Verified email account";
  showMessage(appMessage, "");
  await loadData();
}

async function loadData() {
  const [staffResult, activityResult] = await Promise.all([
    supabase.from("staff_members")
      .select("id,name,role,clock_status,status_changed_at,is_active")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase.from("shift_events")
      .select("id,staff_name,action,created_at")
      .order("created_at", { ascending: false })
      .limit(25)
  ]);
  if (staffResult.error) {
    showMessage(appMessage, `Could not load staff: ${staffResult.error.message}`, true);
    return;
  }
  staff = staffResult.data || [];
  activity = activityResult.data || [];
  if (activityResult.error) showMessage(appMessage, `Staff loaded; activity could not load: ${activityResult.error.message}`, true);
  renderStaff();
  renderActivity();
}

function renderStaff() {
  const query = $("#search").value.trim().toLocaleLowerCase();
  const visible = staff.filter((person) => person.name.toLocaleLowerCase().includes(query));
  const list = $("#staff-list");
  $("#team-count").textContent = String(staff.length);
  $("#working-count").textContent = String(staff.filter((person) => person.clock_status === "working").length);
  $("#break-count").textContent = String(staff.filter((person) => person.clock_status === "break").length);
  $("#team-caption").textContent = profile?.role === "admin"
    ? `${staff.length} active team member${staff.length === 1 ? "" : "s"}`
    : "Only your verified account can record your shift";
  if (!visible.length) {
    list.innerHTML = `<div class="empty-row">${staff.length ? "No names match your search." : "No active staff members yet. Ask an administrator to add the team."}</div>`;
    return;
  }
  const staffSelect = $("#existing-staff-select");
  if (staffSelect) {
    const selectedId = staffSelect.value;
    staffSelect.innerHTML = '<option value="">Select an employee</option>' + staff
      .map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`)
      .join("");
    if (staff.some((person) => person.id === selectedId)) staffSelect.value = selectedId;
  }
  list.innerHTML = visible.map((person) => {
    const status = person.clock_status || "off";
    const statusLabel = status === "working" ? "On the clock" : status === "break" ? "On a break" : "Signed out";
    const isSelf = person.id === profile?.staff_id;
    const actions = [];
    if (isSelf && status === "off") actions.push(actionButton("in", "Sign in", "primary"));
    if (isSelf && status === "working") actions.push(actionButton("break_start", "Start break", "warm"), actionButton("out", "Sign out", "remove"));
    if (isSelf && status === "break") actions.push(actionButton("break_end", "End break", "primary"), actionButton("out", "Sign out", "remove"));
    if (profile?.role === "admin") actions.push(actionButton("remove", "Remove", "remove"));
    return `<article class="staff-row">
      <div class="person"><div class="avatar" aria-hidden="true">${escapeHtml(initials(person.name))}</div><div><div class="person-name">${escapeHtml(person.name)}</div><div class="person-role">${escapeHtml(person.role || "Team member")}${isSelf ? " · You" : ""}</div></div></div>
      <div class="status ${status === "working" ? "working" : status}"><span class="dot"></span>${statusLabel}</div>
      <div class="actions">${actions.join("")}</div>
    </article>`;
  }).join("");
}

function actionButton(action, label, style) {
  return `<button class="action ${style}" type="button" data-action="${action}">${label}</button>`;
}

function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function renderActivity() {
  const root = $("#activity-list");
  if (!activity.length) {
    root.innerHTML = '<div class="activity-empty">No clock activity recorded yet.</div>';
    return;
  }
  root.innerHTML = activity.map((event) => `<div class="activity-row"><span><strong>${escapeHtml(event.staff_name)}</strong> ${escapeHtml(actionLabel(event.action))}</span><time datetime="${escapeHtml(event.created_at)}">${escapeHtml(formatDateTime(event.created_at))}</time></div>`).join("");
}

function actionLabel(action) {
  return ({ sign_in: "signed in", break_start: "started a break", break_end: "ended a break", sign_out: "signed out" })[action] || action;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function updateClock() {
  const now = new Date();
  $("#time-now").textContent = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit" }).format(now);
  $("#date-now").textContent = new Intl.DateTimeFormat("en-AU", { weekday: "long", month: "long", day: "numeric" }).format(now);
}

async function doClockAction(action) {
  const { error } = await supabase.rpc("record_shift_action", { p_action: action });
  if (error) {
    showMessage(appMessage, error.message, true);
    return;
  }
  showMessage(appMessage, `Shift updated: ${actionLabel(action)}.`);
  await loadData();
}

async function addStaff(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  const role = String(data.get("role") || "").trim();
  const email = cleanEmail(String(data.get("email") || ""));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showMessage(appMessage, "Enter a valid employee email address.", true);
    return;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  const { error } = await supabase.rpc("admin_add_employee", {
    p_name: name,
    p_role: role || null,
    p_email: email
  });
  button.disabled = false;
  if (error) {
    showMessage(appMessage, error.message, true);
    return;
  }
  form.reset();
  showMessage(appMessage, `${name} was added. They can now sign in with ${email}.`);
  await loadData();
}

async function linkStaffEmail(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const staffId = String(data.get("staff_id") || "");
  const email = cleanEmail(String(data.get("email") || ""));
  if (!staffId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showMessage(appMessage, "Choose an employee and enter a valid email address.", true);
    return;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  const { error } = await supabase.rpc("admin_set_employee_email", {
    p_staff_id: staffId,
    p_email: email
  });
  button.disabled = false;
  if (error) {
    showMessage(appMessage, error.message, true);
    return;
  }
  form.reset();
  showMessage(appMessage, `Email login was set for ${staff.find((person) => person.id === staffId)?.name || "the employee"}.`);
}

async function handleStaffAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const row = button.closest(".staff-row");
  const name = row?.querySelector(".person-name")?.textContent || "this employee";
  if (action === "remove") {
    const person = staff.find((entry) => entry.name === name);
    if (!person || profile?.role !== "admin") return;
    if (!confirm(`Remove ${name} from the active staff list? Past shift events will remain for records.`)) return;
    const { error } = await supabase.rpc("admin_deactivate_employee", { p_staff_id: person.id });
    if (error) showMessage(appMessage, error.message, true);
    else showMessage(appMessage, `${name} was removed from the active staff list.`);
    await loadData();
    return;
  }
  const mapping = { in: "sign_in", break_start: "break_start", break_end: "break_end", out: "sign_out" };
  if (mapping[action]) await doClockAction(mapping[action]);
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) showMessage(appMessage, error.message, true);
}

function showLogin() {
  profile = null;
  currentUser = null;
  staff = [];
  activity = [];
  dashboardView.classList.add("hidden");
  loginView.classList.remove("hidden");
  $("#sign-out").classList.add("hidden");
  $("#admin-panel").classList.add("hidden");
  $(".summary-grid").classList.remove("hidden");
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("hidden"));
  emailForm.classList.remove("hidden");
  otpForm.classList.add("hidden");
  $("#otp").value = "";
}

emailForm.addEventListener("submit", requestOtp);
otpForm.addEventListener("submit", verifyOtp);
$("#change-email").addEventListener("click", () => {
  otpForm.classList.add("hidden");
  emailForm.classList.remove("hidden");
  showMessage(loginMessage, "");
});
$("#sign-out").addEventListener("click", signOut);
$("#refresh").addEventListener("click", loadData);
$("#search").addEventListener("input", renderStaff);
$("#staff-list").addEventListener("click", handleStaffAction);
$("#add-staff-form").addEventListener("submit", addStaff);
$("#link-staff-form").addEventListener("submit", linkStaffEmail);

setInterval(() => {
  if (profile) loadData();
}, 45_000);
