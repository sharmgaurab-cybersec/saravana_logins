# Saravanaa Bhavan Staff Clock

A shared staff clock with no employee accounts. Staff choose their name to sign in, start/end breaks, and sign out. Only an administrator can sign in to view daily attendance details or manage the staff list.

## What changed

- Staff clock actions no longer ask each employee to log in.
- Public visitors can see only active staff names and roles; they cannot read attendance events or the daily report.
- One administrator account uses email and password. This does not depend on Supabase sending OTP or magic-link emails.
- The admin report shows each person's sign-in time, break starts, break ends, sign-out time, and total hours worked after subtracting breaks. Multiple breaks are listed. Times use Sydney time.
- Existing staff and clock event records are retained by the migration.

## Keep your Supabase settings

This update ZIP intentionally does not include `config.js`. Keep the `config.js` already in your repository or Worker assets. It contains the existing Supabase project URL and publishable key. Do not delete or replace it.

## Update your existing Supabase project

1. Open the existing Saravanaa Supabase project and go to **SQL Editor**.
2. Open `supabase/migrate_to_public_clock_admin.sql` from this ZIP, copy all its contents into a new SQL query, and run it once. It updates the permissions and RPC functions without dropping staff or attendance records.
3. In **Authentication → Users**, create one administrator user with an email and password (or set a password for the existing admin account if the dashboard offers that option). If the dashboard offers an email-confirmation option, mark this administrator as confirmed. No SMTP setup is needed for password sign-in.
4. Copy that user's UUID from the Users page. In SQL Editor run the following, replacing the placeholder:

```sql
insert into public.user_profiles (user_id, role)
values ('YOUR_AUTH_USER_UUID'::uuid, 'admin')
on conflict (user_id) do update set role = 'admin';
```

5. Sign in to the app using that email and password. Confirm the admin screen shows the daily report and staff manager.

For a completely new Supabase database, run `supabase/setup.sql` instead of the migration, then create/promote the admin user using steps 3–5.

## Upload the app files

1. Extract this ZIP.
2. Replace the matching app files in the existing Saravanaa GitHub repository or the Saravanaa Cloudflare Worker upload.
3. Keep your existing `config.js` in place. Do not change the Supabase URL or publishable key.
4. Publish/redeploy the existing Saravanaa app and open its URL.

The ZIP includes static HTML, CSS, and JavaScript files. For Cloudflare's static asset upload page, upload the extracted app files while retaining the existing `config.js` in the upload folder. Do not upload this package to a different project such as Retail Forecast.

## How the shared clock works

The staff clock deliberately allows anyone with access to the shared page to submit a clock action for a listed employee. Use it on a controlled staff tablet or internal network. Because there is no employee login or identity check, the clock cannot prove which person tapped a button. Attendance history and report data remain inaccessible through the public app; the admin report requires an authenticated account whose `user_profiles.role` is `admin`.

## Report details

The report date defaults to the current date in Sydney. It lists active staff, plus inactive staff who have attendance records for that date. A shift still in progress shows the hours accumulated so far. The calculation sums working intervals and excludes time between each break start and break end. It is an attendance summary, not payroll: it does not calculate overtime, pay rates, or award rules.

## Troubleshooting

- **Admin sign-in fails:** confirm the Auth user has a password and that the exact user's UUID has `role = 'admin'` in `public.user_profiles`.
- **Staff list will not load:** confirm the app still has the correct existing `config.js`, the SQL migration succeeded, and the public schema is enabled in Supabase's Data API settings.
- **Clock action is rejected:** the action may not match the current shift state (for example, break end before break start). Ask the admin to check the report and correct the sequence.
- **Report is blank or access denied:** sign in with the administrator account and confirm its profile role is `admin`.
