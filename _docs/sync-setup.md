# Private pages + sync: setup (Supabase)

Personal pages (like `personal/dashboard/`) show a sign-in screen and sync their data across devices through
[Supabase](https://supabase.com). The site stays on free GitHub Pages; Supabase's free tier holds the accounts and the data.

This guide is the one-time setup, done with the dashboard. To make more private pages afterwards, see
[private-pages.md](private-pages.md).

How it fits together:

- `assets/sync.js` is the shared piece. It shows the sign-in screen (email + password), keeps a copy of each synced
  value in the browser (so pages load instantly and work offline), and uploads/downloads changes.
- **Accounts are created by hand** in the Supabase dashboard. The site has no "create account" form, and public
  sign-ups are switched off in Supabase itself. That second part matters: the Supabase key in `sync.js` is public,
  so anyone could call Supabase's sign-up API directly, form or no form. With sign-ups off, Supabase refuses them.
- Supabase has one table, `kv`, with one row per (user, key). A database rule (row-level security) lets a signed-in
  user read and write **only their own rows**. That rule is what protects the data.
- Only the data is private. The HTML/JS of the pages is still publicly readable on GitHub, so never put secrets in
  page code.

---

## Setup

### 1. Create the Supabase project

1. Go to <https://supabase.com>, sign up, and click **New project**.
2. Name it (e.g. `tai-moe`), set a database password (save it in your password manager; you won't need it day to
   day), and pick the region closest to you.
3. Wait a minute or two for it to finish setting up.

### 2. Create the table and its access rule

1. In the project, open **SQL Editor** (left sidebar), then **New query**.
2. Paste this and press **Run**:

   ```sql
   -- One row per (user, key). value holds any JSON.
   create table public.kv (
     user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
     key        text        not null,
     value      jsonb       not null,
     updated_at timestamptz not null default now(),
     primary key (user_id, key)
   );

   -- Only signed-in users may touch the table, and only their own rows.
   alter table public.kv enable row level security;

   create policy "own rows" on public.kv
     for all to authenticated
     using ((select auth.uid()) = user_id)
     with check ((select auth.uid()) = user_id);

   revoke all on public.kv from anon;
   grant select, insert, update, delete on public.kv to authenticated;
   ```

3. It should say **Success. No rows returned**. Under **Table Editor** you'll now see `kv` with **RLS enabled**.

### 3. Turn off public sign-ups

Do this **before** going live, so there's never a moment when strangers could register.

1. Open **Authentication → Sign In / Providers**.
2. Under **User Signups**, turn **off** "Allow new users to sign up", then **Save**.
3. Under **Auth Providers**, leave **Email** enabled. That's what lets existing users sign in with a password.
   Every other provider (GitHub, Google, phone, anonymous sign-ins, …) should stay disabled.

Users you create yourself in the dashboard (next step) still work. This setting only blocks people registering
themselves.

### 4. Create your user

1. Open **Authentication → Users** and click **Add user → Create new user**.
2. Enter your email and a **strong, unique password**. A password manager is ideal; it will also auto-fill the
   sign-in form on each device.
3. Make sure **Auto Confirm User** is ticked, so no confirmation email is needed. Click **Create user**.

### 5. Put your project's address and key into `sync.js`

1. **Project URL**: it's `https://<project-id>.supabase.co`, where the project ID is under
   **Project Settings → General → Project ID** (also shown ready-made under **Project Settings → Data API**, or the
   **Connect** button at the top).
2. **Publishable key** (`sb_publishable_…`): under **Project Settings → API Keys**. If you only see "anon / public",
   use that; it works the same way.
   **Never** use the `secret` / `service_role` key. It bypasses all the rules.
3. Open [assets/sync.js](../assets/sync.js) and fill in the two lines near the top:

   ```js
   const SUPABASE_URL = 'https://abcdefgh.supabase.co';
   const SUPABASE_KEY = 'sb_publishable_...';
   ```

Until these are filled in, the dashboard keeps working exactly as before (data stays on that device), and a
small pill in the corner says "Sync not set up".

### 6. Test locally and sign in for the first time

1. Run `start_server.bat` and open <http://localhost:8000/personal/dashboard/>.
2. You should see **Private page** with an email and password form. Sign in with the user from step 4.
3. The dashboard appears, and the pill at the bottom right goes **Syncing… → Synced** (green).
4. Your existing tasks, history, events and settings from this browser are uploaded on this first sign-in.
   Check **Table Editor → kv** in Supabase: you'll see rows for `daily-tasks-v1` and `dash-cfg`.

Do this first sign-in on the device that has your real dashboard data.

### 7. Deploy and sign in on your other devices

1. Commit and push as usual (`sync.js`, the dashboard files, these docs).
2. Open `https://tai.moe/personal/dashboard/` on each device and sign in.
   - If that device has no dashboard data yet, it downloads yours.
   - If it already has its own data, the two are **combined** (tasks, checked-off days and events from both are
     kept). After that first time, the newest change always wins.

You stay signed in on each device until you press **Sign out** in the pill. Signing out also removes the synced
data from that browser (it stays safe on the server), which is what you want on a borrowed computer.

---

## Managing users

All of this happens in the Supabase dashboard. The site itself can only sign in and sign out.

- **Add a user**: **Authentication → Users → Add user → Create new user**, tick **Auto Confirm User**. They sign in
  on the same page and get their own, separate data. They can't see yours.
- **Change a password**: the dashboard has no "set password" button, so use the **SQL Editor**:

  ```sql
  update auth.users
  set encrypted_password = extensions.crypt('NEW-PASSWORD', extensions.gen_salt('bf'))
  where email = 'you@example.com';
  ```

  Devices that are already signed in stay signed in. To sign out **every** device too (e.g. a lost phone), also run
  `delete from auth.sessions where user_id = 'THE-UID';`, using the user's UID from **Authentication → Users**.
  Each device is locked out within the hour, when its current login expires.
- **Remove a user**: **Authentication → Users → ⋯ → Delete user**.
  ⚠ This also **deletes all of that user's synced data** (the table is set to clean up after deleted users).
  Never do this to your own account unless you mean it. Export a JSON backup from the dashboard first.
- **Wrong password attempts** are rate-limited by Supabase, but a long, unique password is still your real
  protection.

---

## How syncing behaves

- **Saving**: every change saves in the browser right away and uploads about a second later.
- **Getting changes from other devices**: when you switch back to the tab, come back online, or reload.
  The page updates in place.
- **Conflicts**: if the same thing was changed on two devices while one was offline, the most recent change wins
  for that whole key (e.g. the whole task list). Rare in practice, but worth knowing.
- **Offline**: everything works offline; changes upload when you're back.
- **What syncs on the dashboard**: tasks/history/events (`daily-tasks-v1`) and settings (`dash-cfg`: MAL
  username and YouTube channels). The exchange rate and MAL stats are caches and stay per device.
- **Backups**: the Export JSON button still works and is still a good idea now and then.

## Things to know about the free tier

- **Inactive projects get paused** after about a week without any requests. Using the dashboard keeps it awake.
  If it does pause, the pill shows a sync error but the page still works from the local copy. Press
  **Restore** on the project in the Supabase dashboard; nothing is lost.
- Limits (500 MB database, 50,000 monthly users, etc.) are far beyond what personal pages need.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Wrong email or password." | Check for typos. If you forgot it, set a new one with the SQL under *Managing users*. |
| "Email not confirmed" | The user was created without **Auto Confirm User**. In **Authentication → Users**, open the user and confirm them, or delete and re-create with the box ticked. |
| Pill says "Sync error" | Hover it for the message. Usually: project paused, wrong key, or the SQL in step 2 wasn't run. Details also appear in the browser console. |
| Pill says "Sync not set up" | `SUPABASE_URL` / `SUPABASE_KEY` in `sync.js` are empty, or the Supabase script didn't load. |
| A device's data was replaced instead of combined | Its old copy is saved in that browser under the key `<key>.backup` (e.g. `dash-cfg.backup`), viewable in DevTools → Application → Local Storage. |
