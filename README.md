# MDE 173 ICT — Self-Paced Online Course

A standalone, self-contained MOOC website generated from your Moodle course backup
(`backup-moodle2-course-513-mde173-...mbz`). It runs entirely in the browser — no
server, database, or Moodle installation required.

## What's inside

- **18 weeks / 117 learning items** — readings, slide decks, videos, links, an
  interactive H5P crossword, and a discussion/announcements page — restructured
  from the original course sections.
- **16 real quizzes, 141 questions** pulled directly from the original Moodle
  question bank (multiple-choice, true/false, matching, short answer, essay),
  with instant client-side grading and a 60% pass mark.
- **Progress tracking** — each learner's progress, quiz scores, and completion
  status are saved in their browser (`localStorage`). Nothing is sent to a server.
- **Certificate of completion** — once a learner finishes every item and passes
  every quiz, they can enter their name and download a PDF certificate, generated
  entirely in the browser.

## How to publish it so "anyone can access" it

This is a static site — three files plus an `assets/` folder. Any static host works.
Two free options, pick one:

### Option A — Netlify (easiest, ~1 minute)
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag the whole `site` folder onto the page.
3. Netlify gives you a public URL immediately (e.g. `random-name.netlify.app`).
   You can rename it or attach your own domain for free in Site settings.

### Option B — GitHub Pages
1. Create a new GitHub repository and upload the contents of the `site` folder.
2. Repo Settings → Pages → Deploy from branch → `main` / root.
3. Your course will be live at `https://<username>.github.io/<repo>/`.

### Option C — Vercel, Cloudflare Pages, your own web host
Any of these work the same way — it's just static files. Upload the contents of
`site/` to the web root and it will run as-is.

## Important things to know before you publish

- **No accounts / no central grade record.** Progress lives in each learner's
  own browser. If they clear their browser data or switch devices, progress
  resets. This was the trade-off for "free, no backend, anyone can use it
  instantly." If you later want real accounts and a gradebook that persists
  across devices, the natural upgrade path is either (a) adding a small backend
  (e.g. Supabase/Firebase) to this same site, or (b) restoring the original
  `.mbz` file into a hosted Moodle instance (Moodle Cloud or self-hosted),
  which is what it was designed for natively.
- **Certificates are not cryptographically verifiable.** They're a nicely
  designed PDF with a random certificate ID, generated in the browser — good
  enough for personal/portfolio use, not for high-stakes credentialing.
- **One very large file was excluded.** `IT-PC_Professional_English_in_Use_
  ICT_hi-res.pdf` (188 MB, a published textbook) was left out to keep the site
  a reasonable size and avoid redistributing a large copyrighted textbook.
  Everything else — lecture slides, readings, images — is included.
- **A few activity types don't fully translate to a static site:**
  - **LTI tools** (2 items, e.g. "Mid term 1") were external tool launches
    tied to the original Moodle server; they're shown as an informational note.
  - **H5P interactives** — one crossword puzzle was rebuilt as a simple
    fill-in-the-blank exercise; other H5P content types aren't present in
    this backup.
  - **Assignments** have no file-upload box (no backend to receive files) —
    learners self-mark them complete after doing the task described.
  - **"Lesson" activities** (8 items) had no branching pages saved in the
    backup (only intro video/text), so they're shown as simple reading pages.

## Customizing

- **Pass mark:** edit `PASS_THRESHOLD` near the top of `app.js` (currently `0.6` = 60%).
- **Branding/colors:** edit the CSS variables at the top of `style.css`.
- **Content:** everything is data-driven from `course_data.json` — you can hand-edit
  that file (it's plain JSON) to fix typos, add items, or remove sections without
  touching the code.

## Regenerating from the original backup

If you want to re-run the extraction (e.g. after editing the course in Moodle and
exporting a new backup), the parsing script used to build `course_data.json` is
available on request — it's a single Python file that reads the `.mbz` (a gzipped
tar archive) and rebuilds the JSON + assets automatically.
