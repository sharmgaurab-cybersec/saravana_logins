# Saravanaa Bhavan Staff Clock

A mobile-friendly web app for staff phone verification, shift sign-in, breaks, sign-out, and administrator-managed staff records. The starter uses Supabase Auth and Postgres so staff and managers share the same live data from different phones.

## Included

- Saravanaa Bhavan branding and responsive mobile layout.
- SMS one-time-code sign-in for staff and administrators.
- A–Z employee directory with search.
- Staff can record their own sign-in, break start/end, and sign-out.
- Administrators can add staff with a verified phone number and deactivate staff. Deactivation keeps historical shift events.
- Supabase SQL setup with row-level security and server-checked clock actions.
- GitHub Pages-compatible static files. No build step is required.

## 1. Create and configure Supabase

1. Create a Supabase project.
2. In **Authentication → Providers**, enable **Phone** and configure an SMS provider (for example Twilio). Supabase phone OTP requires an SMS provider; the provider may charge for messages.
3. In **Project Settings → API**, copy the Project URL and the **publishable** key.
4. Open **SQL Editor**, paste all of `supabase/setup.sql`, and run it once. The SQL creates the tables, access policies, phone-to-staff linking, and protected clock/admin functions.
5. In the Data API settings, make sure the `public` schema is available to the API. The setup SQL grants only the required `authenticated` permissions; row-level security still controls access.

The app uses the `@supabase/supabase-js` browser module from a pinned CDN version. It never needs a service-role or secret key in the browser.

## 2. Connect the website

Edit `config.js` and replace the two placeholders:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_..."
};
```

The publishable key is designed to be visible in a browser. **Never paste a Supabase secret or service-role key into `config.js`, GitHub, or the website.** Security depends on the supplied row-level policies and database functions.

## 3. Create the first administrator

1. Open the app and sign in once using the manager’s mobile number in international format, such as `+61412345678`. Enter the SMS code. Until promoted, the new account will show that staff access is pending.
2. In Supabase **Authentication → Users**, copy that user’s UUID.
3. In **SQL Editor**, run the statement below after replacing the placeholder with that UUID:

```sql
insert into public.user_profiles (user_id, role)
values ('YOUR_AUTH_USER_UUID'::uuid, 'admin')
on conflict (user_id) do update set role = 'admin';
```

4. Refresh the app. Admins can add employees by name, role, and phone number. Use international format for each number. Staff then sign in with the same phone and a fresh SMS verification code.

Only administrator accounts can add or remove people. Removing a person deactivates their staff record and keeps earlier clock events for reporting.

## 4. Upload to GitHub and publish

1. Create a new GitHub repository.
2. Upload the contents of this folder to the repository root, including `index.html`, `config.js`, `src/`, `assets/`, `styles.css`, `manifest.webmanifest`, and `supabase/`.
3. In GitHub, open **Settings → Pages** and publish from the `main` branch and `/ (root)`.
4. In Supabase **Authentication → URL Configuration**, set the published GitHub Pages URL as the Site URL and add it to the allowed redirect URLs. For a repository site, the URL will look like `https://YOUR_GITHUB_NAME.github.io/YOUR_REPOSITORY/`.
5. Open the published app over HTTPS. On mobile, use **Add to Home Screen** (iPhone Safari) or **Install app** (Android Chrome) for an app-like icon and full-screen view.

## Important setup notes

- Phone OTP cannot send until a working SMS provider is configured in Supabase Auth.
- Employees must be added by an administrator before they can record shifts. Unlisted phone accounts cannot read the staff directory or write shift events.
- The app uses one shared Supabase project. Do not switch the GitHub Pages site to public with a different database or remove the RLS policies.
- The browser contains only the Supabase URL and publishable key. Privileged operations are checked by database functions and RLS; no admin code or employee PIN is embedded in the client.
- This starter records shift events and current status. It does not calculate award rates, overtime, paid breaks, or payroll. Review local workplace requirements before relying on it for payroll.
- The website is ready to wrap in a native iOS/Android shell later (for example with Capacitor); the included PWA manifest supports home-screen installation now.

## Troubleshooting

- **No SMS arrives:** confirm Phone Auth is enabled, the SMS provider is verified/configured, and the number is in E.164 format (starts with `+` and country code).
- **A new employee sees “access pending”:** confirm the administrator added the same phone number to the roster, then sign out and request a fresh OTP.
- **No staff appears after setup:** confirm `supabase/setup.sql` completed, `config.js` has the correct project values, and the `public` schema is exposed to the Data API.
- **Admin controls are missing:** verify that the correct `user_profiles.user_id` was promoted to `admin`, then sign out and sign in again.
