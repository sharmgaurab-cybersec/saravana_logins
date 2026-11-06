# Saravanaa Bhavan Staff Clock

A mobile-friendly staff clock for email one-time-code sign-in, shift sign-in, breaks, sign-out, and administrator-managed staff records. Supabase Auth and Postgres let staff and managers use shared data from different devices.

## Included

- Saravanaa Bhavan branding and responsive mobile layout.
- Email OTP verification for staff and administrators.
- A–Z employee directory with search.
- Staff can record their own sign-in, break start/end, and sign-out.
- Admins can add employees by name, role, and email, or assign an email to an existing staff member.
- Supabase SQL setup and an upgrade script for an existing phone-auth database.
- GitHub Pages-compatible static files. No build step is required.

## Important: preserve your existing Supabase connection

This update bundle intentionally **does not include `config.js`**. Keep the `config.js` already in your GitHub repository; it contains your Supabase Project URL and publishable key. When uploading the update, do not delete or replace that file.

## Configure email OTP in Supabase

1. In the same Supabase project already connected to the app, open **Authentication → Sign In / Providers → Email** and enable email sign-in. Keep email confirmation enabled.
2. In **Authentication → Email Templates**, set the **Confirm signup** and **Magic Link** templates to show the one-time code using `{{ .Token }}`. The app expects a six-digit code, not a clickable link.
3. Supabase's built-in email service has sending limits and may only deliver to project team addresses. If staff emails cannot receive a code, configure a custom SMTP provider in Supabase Auth.

## Database setup

Choose **one** path:

- **New database:** run `supabase/setup.sql` once in **SQL Editor**. It creates the email mapping, access policies, and protected clock/admin functions.
- **You already ran the old phone setup:** run `supabase/migrate_phone_to_email.sql` once in **SQL Editor**. It preserves the existing staff and clock history. Phone numbers are not converted to emails automatically.

For an existing database, after the migration log in with the manager's email and OTP. Then use **Set employee email** in the admin panel to assign emails to existing staff. The former phone-auth admin account is a different Supabase user; promote the new email-auth account as an administrator using the next section.

In **Project Settings → API → Data API settings**, ensure the `public` schema is available to the API. The SQL grants the required authenticated access and enables row-level security.

## Promote the first email administrator

1. Open the updated app and sign in once using the manager's email. Enter the code from the email. If the account is new, it may show that access is pending.
2. In Supabase **Authentication → Users**, copy the email user's UUID.
3. In **SQL Editor**, run this after replacing the placeholder:

```sql
insert into public.user_profiles (user_id, role)
values ('YOUR_AUTH_USER_UUID'::uuid, 'admin')
on conflict (user_id) do update set role = 'admin';
```

4. Refresh the app. Add employees with their email addresses, or use **Set employee email** to link existing roster entries. Staff sign in using the exact email the admin assigned.

Only administrators can add or deactivate staff. Deactivation preserves historical clock events.

## Upload and publish the update

1. Extract this ZIP.
2. Upload and replace the files from the ZIP in your existing GitHub repository. Keep the repository's current `config.js` untouched.
3. If you use GitHub Pages, wait for its deployment to finish. Keep the existing Supabase project and URL Configuration settings.
4. Open the published site and test email OTP with an address that can receive mail.

The app uses a pinned Supabase JavaScript client from a CDN. The browser contains only the project's URL and publishable key; never add a Supabase secret/service-role key to the repository.

## Troubleshooting

- **Code email doesn't arrive:** check spam/junk, the Supabase Auth logs, email templates, and whether the project's built-in email service permits that recipient. Configure SMTP if required.
- **“Access pending”:** make sure the admin added or assigned that same email to the employee. Then sign out and sign in again.
- **Email user is not an admin:** promote the new email-auth user's UUID in `user_profiles`; the old phone-auth user has a different UUID.
- **Staff or history is missing:** confirm the migration completed, `config.js` still contains the original project values, and the GitHub Pages site is connected to the same Supabase project.
- **Admin controls are missing:** verify the signed-in user's `user_profiles.role` is `admin`, then sign out and back in.

The app records clock events and current status. It does not calculate award rates, overtime, paid breaks, or payroll. It can later be wrapped in a native iOS/Android shell; the PWA manifest supports home-screen installation now.
