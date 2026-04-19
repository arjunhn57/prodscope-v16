# Google OAuth Setup (Phase 7, Day 1)

This is the one-time manual step you need to complete alongside the Day 1 code
changes. Allow ~10 minutes.

## What you are creating

A single OAuth 2.0 "Web application" client in Google Cloud Console. The Client
ID goes into two places:

- `GOOGLE_CLIENT_ID` — backend env (used to verify Google ID tokens)
- `VITE_GOOGLE_CLIENT_ID` — frontend env (used by `@react-oauth/google`)

Both read the **same** Client ID string. There is no separate secret on the
frontend.

## Steps

1. Open https://console.cloud.google.com/ and sign in as `arjunhn57@gmail.com`.
2. Create a new project (or reuse an existing one) — name suggestion:
   `prodscope-prod`. Leave billing as-is (OAuth itself does not cost anything).
3. In the left sidebar, go to **APIs & Services → OAuth consent screen**.
   - User Type: **External**
   - App name: `ProdScope`
   - User support email: `arjunhn57@gmail.com`
   - Developer contact: `arjunhn57@gmail.com`
   - Scopes: leave defaults (email + profile are automatically included)
   - Test users: add `arjunhn57@gmail.com` and any design-partner emails you
     plan to invite during the unverified phase. Apps in "Testing" mode only
     allow signed-in test users — we will submit for verification later once
     we have 50+ partners.
4. In the left sidebar, go to **APIs & Services → Credentials**.
   - Click **+ CREATE CREDENTIALS → OAuth client ID**
   - Application type: **Web application**
   - Name: `ProdScope Web`
   - Authorized JavaScript origins:
     - `http://localhost:5173` (Vite dev)
     - `https://prodscope.ai` (prod — replace with your actual domain)
   - Authorized redirect URIs: **leave empty** (we use Google Identity
     Services popup flow, not redirect flow)
   - Click **CREATE** → copy the **Client ID** (ends in
     `.apps.googleusercontent.com`)
5. Paste the Client ID into two env files:

   **Backend** — `/Users/.../prodscope-backend-live/.env`:
   ```
   GOOGLE_CLIENT_ID=123456789-xxxxxxxxxxx.apps.googleusercontent.com
   ```

   **Frontend** — `/Users/.../prodscope-backend-live/frontend/.env`:
   ```
   VITE_GOOGLE_CLIENT_ID=123456789-xxxxxxxxxxx.apps.googleusercontent.com
   ```

   (same value in both files)

## Verifying

Once both env files are set and the backend + frontend have been restarted:

1. Visit `http://localhost:5173/login`.
2. Click **Continue with Google** — a Google popup should appear.
3. Sign in with a test user email you added in step 3 above.
4. You should be redirected to `/dashboard`, and the Network tab should show
   a `POST /api/v1/auth/google` call that returns `{ token: "<jwt>", user: {
   email, role } }`.
5. The `localStorage` `prodscope-auth` entry should contain a real JWT (three
   dot-separated base64 segments), not the old literal `"demo-token"`.

## Gotchas

- **"Access blocked: ProdScope has not completed the Google verification
  process"** — you forgot to add the email as a Test User in step 3. Add it,
  wait ~1 minute, try again.
- **"redirect_uri_mismatch"** — you are on an origin that is not in the
  Authorized JavaScript origins list. Add it (exact match, including port).
- **Client ID leaked in git** — the Client ID is not a secret, but the .env
  files must stay gitignored. Double-check that `frontend/.env` is in the
  gitignore (it should be; `.env` at repo root is already covered).
