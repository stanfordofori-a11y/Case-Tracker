# Post-Analytical Tracker

Shared tracker for the MT "Outstanding Lab Specimens" list. React + Vite + Tailwind front end (design from Figma Make), Supabase for sign-in, data and live updates.

## Deploy on Render
1. Put this folder in a GitHub repository (`node_modules` and `dist` are ignored).
2. Render → **New → Static Site** → pick the repository.
3. **Build command:** `npm ci && npm run build`
   **Publish directory:** `dist`
4. Optional environment variables (the defaults in `src/lib/api.ts` already point at the project):
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` (publishable key only; never the secret key).
5. Create the site. Every push to GitHub redeploys it.

Alternatively use **New → Blueprint**: `render.yaml` sets all of the above.

## Supabase pieces this app expects
- `1_supabase_setup.sql` and `3_first_admin_setup.sql` run in the SQL Editor
- Edge Function `manage-staff` deployed, with **Verify JWT off**
- Secret `SETUP_CODE` (for creating the first admin once)
- Authentication → "Allow new users to sign up" **off**

## Run locally
```
npm install
npm run dev
```

## Where things are
- `src/lib/tracker.ts` – MT parser, date parser, per-test model, timing verdicts
- `src/lib/report.ts` – delay report maths
- `src/lib/api.ts` – Supabase reads, writes (RPCs) and the staff Edge Function
- `src/components/` – screens: sign-in, tracker, paste review, report, settings, staff
