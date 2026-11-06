# Saravanaa Bhavan Staff Clock

Shared staff clock, with no employee sign-in. Staff select their name for clock actions. Only the authorized admin email `reborngamming1@gmail.com` can access daily attendance reports and roster management after verifying a six-digit email code.

## Preserve the existing Supabase connection

This ZIP does not contain `config.js`. Keep the existing `config.js` from your Saravanaa app; it contains the existing Supabase URL and publishable key. Do not replace those values or upload this package to the Retail Forecast project.

## Set up the admin email code

1. In Supabase, open **Authentication → Users**. Make sure `reborngamming1@gmail.com` already exists as a confirmed user. The app will not allow public sign-up.
2. In **Authentication → Email Templates → Magic Link**, edit the message to include the OTP token. For example:

```html
<h2>Saravanaa admin sign-in</h2>
<p>Enter this verification code in the app: {{ .Token }}</p>
```

3. Confirm that email authentication is enabled and that Supabase can deliver to this address. Supabase’s built-in sender has recipient restrictions and rate limits; if this Gmail address is not an organization member or the built-in sender blocks it, you need a real SMTP provider or Auth email hook. Random SMTP details cannot send mail.
4. After the migration below, promote this user's Auth UUID as the admin using the SQL snippet in the next section.

The app uses Supabase's `signInWithOtp` with account creation disabled, then verifies the six-digit code. A magic-link-only template may send a link instead of the code field expected by the app.

## Update your existing database

1. Open the existing Saravanaa Supabase project and go to **SQL Editor**.
2. Run `supabase/migrate_to_public_clock_admin.sql` once. It retains current staff and clock records and changes the access rules so public users cannot read attendance events.
3. In **Authentication → Users**, copy the UUID for `reborngamming1@gmail.com`. Run this in SQL Editor after replacing the placeholder:

```sql
insert into public.user_profiles (user_id, role)
values ('YOUR_AUTH_USER_UUID'::uuid, 'admin')
on conflict (user_id) do update set role = 'admin';
```

For a completely new Supabase database, run `supabase/setup.sql` instead of the migration, then create/confirm the admin Auth user and add its UUID to `user_profiles` as above.

## Upload the app

1. Extract this ZIP.
2. Replace the matching app files in your existing Saravanaa GitHub repository or Cloudflare Worker static upload.
3. Keep the existing `config.js` in the uploaded app folder. The app login button stays clickable, but authentication needs the correct project URL and publishable key in that file.
4. Redeploy the existing Saravanaa app and open it.
5. Click **Admin login**, request the code, check inbox/spam, enter the six-digit code, and choose **Verify code and sign in**.

## Admin dashboard

- Search the daily report by typing a name or choosing a suggestion from staff already in the system.
- Search existing names in the staff manager; add or deactivate roster entries there.
- Select a date and load the report. Columns show employee, sign-in time, break starts, break ends, sign-out time, and total work hours excluding breaks.
- Select **Download CSV** to save the daily report. Excel can open the CSV file.
- Times are in Sydney time. An open shift is counted up to now for today, or to the end of the selected day for an earlier date.

## Shared-clock limitation

The public clock intentionally lets a person with access to the page submit an action for a listed name. Since staff do not log in, it cannot verify who tapped the button. Use the clock on a controlled staff device. The public page can read active names and roles, but attendance history and the report require the admin session.

## Troubleshooting

- **Admin login button does not open:** keep the package's current `index.html`, `styles.css`, and `src/app.js` together. The button is no longer disabled when settings are missing; the login screen will explain if `config.js` is not connected.
- **Code is not sent:** confirm the `{{ .Token }}` template, email delivery settings, and Supabase Auth logs. If the built-in email service cannot deliver to this recipient, a working SMTP provider is required.
- **Code verifies but access is denied:** confirm this email's Auth UUID has `role = 'admin'` in `public.user_profiles`.
- **Staff list/report fails:** verify the existing `config.js` still points to the Saravanaa Supabase project and the database migration completed.
