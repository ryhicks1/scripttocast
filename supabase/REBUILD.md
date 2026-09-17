# Rebuilding the ScriptToCast Supabase project

The Supabase project that backed ScriptToCast (`yhtsoeizrfvomwrayktg`) was
deleted. Its host returns NXDOMAIN and it is not listed under the account. This
runbook recreates it from scratch.

**Any data that was in it is gone.** Supabase deletion is not recoverable past
the retention window and this repository references no backup. Saved projects,
user accounts and branding settings from the old project cannot be restored.
Users will have to sign up again.

## What is and is not broken right now

`/api/analyze` has no Supabase dependency at all — upload, analysis and results
work without a database. That is why the app appears healthy.

Everything that touches Supabase fails **silently**, because three separate call
sites swallow the error:

- `src/app/page.tsx` — the auth check is wrapped in `try {} catch {}`, so an
  unreachable Supabase renders the page logged-out with no error.
- `SmartCreator.saveProject` — `catch { return null; }`, so saves fail and the
  UI carries on as though they succeeded.
- `src/app/api/generate-pdf/route.ts` — branding lookup falls back to unbranded.

So: login, signup, the dashboard and project saving are all dead, and nothing
says so. Restoring the database fixes all of them.

## Prerequisites

- Supabase account access with permission to create a project.
- Vercel access to the `scripttocast` project's environment variables.
- This repository, for `supabase/migration.sql`.

## Step 1 — Create the project

Create a new Supabase project. Name it `scripttocast` so it is identifiable next
to the other projects on the account.

Choose a region close to the Vercel deployment region to keep query latency
down. Save the database password somewhere durable.

## Step 2 — Apply the schema

Run `supabase/migration.sql` from this repository in full, via the SQL Editor or
`supabase db push`.

It creates:

| Object | Purpose |
|---|---|
| `public.s2c_projects` | Saved analyses — the `data` column holds the breakdown JSON |
| `public.user_settings` | Per-user branding for generated PDFs |
| `logos` storage bucket | Company logos embedded in PDFs (public read) |

It is idempotent — safe to re-run.

**Row-level security is enabled on both tables and must stay that way.** The
app's page components query Supabase with the user-scoped client (anon key plus
the user's session), and the anon key is public — it ships to every browser. If
RLS is disabled, anyone who reads the key out of the JS bundle can query these
tables directly and read every customer's breakdowns. RLS is the access control
here, not a formality.

## Step 3 — Configure auth

Enable the **Email** provider. The app uses email and password:
`supabase.auth.signInWithPassword` and `supabase.auth.signUp`.

**Turn "Confirm email" OFF.** This matters: `src/app/signup/page.tsx` redirects
to `/dashboard` immediately after `signUp` returns, with no "check your inbox"
step. With confirmation on, `signUp` succeeds but creates no session, so
`/dashboard` bounces the user to `/login`, where their unconfirmed credentials
fail. They get a redirect loop and no explanation.

If email confirmation is wanted later, the signup page needs a confirmation
screen first. Do not enable it against the current code.

No OAuth providers are used. No redirect URL configuration is required beyond
the defaults, since both flows are client-side and route with the Next.js
router rather than a Supabase redirect.

## Step 4 — Update Vercel environment variables

From Supabase **Settings → API**, copy these into the Vercel `scripttocast`
project for **all** environments (Production, Preview, Development):

| Variable | Value | Sensitive |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (`https://<ref>.supabase.co`) | No — ships to the browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` / publishable key | No — ships to the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key | **Yes — server only** |

The service-role key bypasses RLS entirely. It must never be prefixed
`NEXT_PUBLIC_`, never referenced in a client component, and never committed.
It is currently used by the API routes under `src/app/api/`.

Setting these on Preview as well as Production matters: `src/lib/supabase/admin.ts`
defers client construction specifically so that a Preview deployment missing
these variables fails at request time on one route instead of breaking the
build, but the routes themselves will still 500 without them.

## Step 5 — Redeploy

Environment variables are read at build time, so redeploy after setting them.
Trigger a fresh deployment of `main` rather than promoting an existing build.

## Step 6 — Verify

Work through all of these. Several failure modes here are silent, so "no error
on screen" is not evidence of success.

1. **Signup** — create an account. It should land on `/dashboard`, logged in. A
   bounce back to `/login` means email confirmation is still on (Step 3).
2. **Analyse and save** — upload a document while logged in. Then reload
   `/dashboard` and confirm the project is listed. If analysis works but nothing
   appears on the dashboard, the save is failing silently — check the Vercel
   function logs for `/api/projects`.
3. **Open a saved project** — click through from the dashboard and confirm the
   breakdown renders.
4. **Delete a project** — confirm it disappears and does not return on reload.
5. **Branding** — set a company name and upload a logo in `/settings`, then
   generate a self-tape PDF and confirm the branding appears.
6. **Tenant isolation** — create a second account and confirm it sees an empty
   dashboard, not the first account's projects.
7. **RLS is actually on** — run:

   ```sql
   select relname, relrowsecurity from pg_class
   where relname in ('s2c_projects', 'user_settings');

   select tablename, policyname, cmd from pg_policies
   where tablename in ('s2c_projects', 'user_settings');
   ```

   Both tables must show `relrowsecurity = true`, and the second query must
   return four policies per table. Zero policies with RLS on means the app will
   read nothing; RLS off means the tables are world-readable with the public
   anon key.

## Things not to do

- **Do not disable RLS** to make something work. If a query returns nothing, the
  policy or the session is wrong — that is the control working, not a blocker.
- **Do not store uploaded scripts.** The `documents` column exists but is always
  `[]`, and there is no bucket for scripts. Raw documents live only in memory
  for the duration of an `/api/analyze` request and are never written to disk or
  database. That is deliberate: it keeps customer IP out of storage entirely.
  Caching uploads to speed up re-analysis would quietly reverse it.
- **Do not put anything other than logos in the `logos` bucket.** It is
  world-readable by policy.
- **Do not reuse the old project reference** (`yhtsoeizrfvomwrayktg`) anywhere.
  It is dead.

## Follow-up worth doing separately

Not required to restore service, but worth scheduling:

- **Move the API routes off the service-role key.** `src/app/api/projects/` and
  `src/app/api/settings/` use `supabaseAdmin()`, which bypasses RLS. The code is
  correct today — every query filters on `user_id` — but tenant isolation rests
  on application code remembering that filter, with no database backstop. Using
  the user-scoped client makes RLS the enforcement.
- **Surface the silent failures.** The three swallowed errors described above
  mean a database outage looks like a working app that quietly loses data.
- **Add a retention policy.** Nothing currently expires saved breakdowns.
- **Enable Point-in-Time Recovery** or scheduled backups, so a second deletion
  is recoverable.
