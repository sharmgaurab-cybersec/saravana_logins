# Saravanaa Bhavan Staff Clock

Shared staff clock with no employee sign-in. Only the admin account `reborngamming1@gmail.com` can view attendance reports and manage the staff list. Admin access uses email and password, so routine sign-in does not send authentication email.

## Preserve the existing Supabase connection

This ZIP does not contain `config.js`. Keep the existing `config.js` from your Saravanaa app beside `index.html`; it contains the existing Supabase URL and publishable key. Do not replace those values or upload this package to the Retail Forecast project.

## Set up the administrator account

1. In the Saravanaa Supabase project, open **Authentication → Users**.
2. If `reborngamming1@gmail.com` is not listed, click **Add user → Create new user**. Enter this email, set a strong password, and mark the email confirmed if that option appears. Record the password securely; this is the password used on the app's admin login screen.
3. If this email is already listed, use the password that was set for that Auth user. Supabase cannot show you an existing password. If you do not know it, use the Supabase password recovery flow (email delivery is required) or have a trusted server-side administrator reset it. Never put a Supabase secret/service-role key in the website or GitHub.
4. In **SQL Editor**, promote the Auth user to admin. Replace the email only if it differs from the one above:

```sql
insert into public.user_profiles (user_id, role)
select id, 'admin'
from auth.users
where lower(email) = 'reborngamming1@gmail.com'
on conflict (user_id) do update set role = 'admin';
```

If the profile role query runs successfully but matches no Auth user, first create that user in **Authentication → Users**.

## Update your existing database

For this updated version, run the complete `supabase/migrate_to_public_clock_admin.sql` in the existing Saravanaa Supabase project's **SQL Editor**. It fixes the report query and adds a limited RPC for current clock status and completed-shift hours. It is safe to rerun and preserves staff and attendance events. Do not run `setup.sql` on an existing project. For a brand new database, run `setup.sql` instead.

## Upload the app

1. Extract this ZIP.
2. Replace the matching app files in the existing Saravanaa GitHub repository or Cloudflare Worker static upload.
3. Keep the existing `config.js` beside `index.html`.
4. Redeploy the existing Saravanaa app.
5. Click **Admin login** and sign in with the fixed email and the password from the Auth user.

## Admin dashboard

- Search the daily report by typing a name or choosing a suggestion from staff already in the system.
- Search existing names in the staff manager; add or deactivate roster entries there.
- Select a date and load the report. The columns show employee, sign-in, break starts, break ends, sign-out, and total work hours excluding breaks.
- Select **Download CSV** to save the daily report. Excel can open the CSV file.
- Times are shown in Sydney time. An open shift counts up to now for today, or to the end of the selected day for an earlier date.

## Shared-clock limitation

Staff can search the roster, filter by clock status, refresh statuses on demand, and see the current state beside each name. Statuses also refresh automatically every 30 seconds.

The public clock intentionally lets a person with access to the page submit an action for a listed name. Since staff do not log in, it cannot verify who tapped the button. Use it on a controlled staff device. The public page can read active names and roles, but attendance history and the report require the authorized admin session.

## Troubleshooting

- **Admin login button does not open:** keep `index.html`, `styles.css`, and `src/app.js` together. The app shows a connection message if `config.js` is missing or still contains placeholders.
- **Invalid login:** confirm the email's password in Supabase Auth and verify its `user_profiles.role` is `admin`.
- **Staff list or report fails:** confirm `config.js` still points to the Saravanaa Supabase project and the database migration completed.
