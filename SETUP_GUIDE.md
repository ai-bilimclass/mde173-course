# MDE 173 Course Site — Publish & Accounts Setup Guide

The site now supports three things on top of the static course:

1. **Free hosting on GitHub Pages** — anyone with the link can open it.
2. **Learner accounts** — visitors must register (free) to see the course; their progress, quiz scores and certificate sync to their account and follow them across devices.
3. **Teacher editing** — your account gets an "✎ Edit this page" button on every lesson; edits are saved online and shown to all learners instantly, with no re-publishing needed.

Accounts and edits are powered by [Supabase](https://supabase.com) (free tier), since GitHub Pages itself can only serve static files.

---

## Part 1 — Supabase (accounts backend), ~10 minutes

1. Go to <https://supabase.com>, sign up free, and click **New project**.
   - Name: `mde173-course` (anything works). Choose a region near your learners. Set a database password (Supabase keeps it; you won't need it daily).
2. When the project finishes creating, open **SQL Editor → New query**, paste the entire contents of `supabase_setup.sql` from this folder, and click **Run**. You should see "Success".
3. Open **Project Settings → API** (or "Data API") and copy two values:
   - **Project URL** (like `https://xxxx.supabase.co`)
   - **anon / public key** (long string starting `eyJ...`)
4. Open `supabase-config.js` in this folder and paste them in:
   ```js
   window.SUPABASE_URL = "https://xxxx.supabase.co";
   window.SUPABASE_ANON_KEY = "eyJ...";
   ```
5. Optional but recommended for a smooth start: in Supabase go to **Authentication → Sign In / Providers → Email** and turn **Confirm email** OFF. Then learners can start immediately after registering. (Leave it ON if you prefer verified emails — learners then get a confirmation link first.)

### Make yourself the teacher

1. Publish the site (Part 2) or open it locally, and **register a normal account** with your email.
2. In Supabase **SQL Editor**, run:
   ```sql
   update public.profiles set role = 'teacher'
     where email = 'abdulkarim9315@gmail.com';
   ```
3. Sign out and back in on the site — you'll see a **Teacher** badge and an **✎ Edit this page** button on every lesson.

You can promote co-teachers the same way with their email. Everyone else who registers is a learner automatically.

---

## Part 2 — Publish on GitHub Pages, ~10 minutes

Run these commands **in the `site` folder** (Git must be installed; get it from <https://git-scm.com> if needed).

> **First**: if a hidden `.git` folder already exists in `site` (left over from setup), delete it before starting — in PowerShell: `Remove-Item -Recurse -Force .git`

```bash
git init
git add .
git commit -m "MDE 173 online course"
```

Then:

1. On <https://github.com/new> create a repository, e.g. `mde173-course` (Public). Don't add a README.
2. Push (replace `YOUR-USERNAME`):
   ```bash
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/mde173-course.git
   git push -u origin main
   ```
   GitHub will ask you to log in the first time.
3. In the repository: **Settings → Pages → Source: Deploy from a branch → Branch: main / (root) → Save**.
4. After 1–2 minutes your course is live at:
   `https://YOUR-USERNAME.github.io/mde173-course/`

### Updating the site later

Teacher content edits need **no republishing** — they go straight to Supabase. Only republish when you change the site files themselves:

```bash
git add .
git commit -m "update"
git push
```

---

## How it works / limitations

- **Locked content**: the course UI only loads after login. Note that the raw files (PDFs, `course_data.json`) are still technically downloadable by someone who knows the direct URL — GitHub Pages can't password-protect files. For a university course this is normally fine; true file-level protection would require moving hosting off GitHub Pages.
- **Teacher edits** are stored as per-page overrides in Supabase. "Restore original" on any page removes your edit and brings back the original Moodle content.
- **Learner progress** (completed items, quiz scores, certificate) is saved to their account and works from any device.
- **Free tiers**: GitHub Pages is free; Supabase free tier covers ~50,000 monthly active users — far more than enough.
- If `supabase-config.js` still has placeholder values, the site runs in **open preview mode** (no accounts, progress on-device only) — handy for testing locally.
