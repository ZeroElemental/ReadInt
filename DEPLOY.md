# Deploying ReadInt

The app itself is a static site and needs nothing but hosting. This document is
really about the one server ReadInt has — `POST /api/define`, which answers
definition lookups the public dictionary can't, using Gemini Flash.

**Everything here needs your Google account, so none of it can be automated for
you.** Roughly 15 minutes, most of it waiting on the console.

Until this is done the app works: PDFs, annotations, search and single-word
definitions all run locally. Only the AI fallback is missing, and it says so.

---

## Before you start

Three things, and the second one stops the deploy dead if you skip it.

### 1. Install the Firebase CLI

Not currently installed on this machine.

```
npm install -g firebase-tools
firebase --version
```

### 2. A Firebase project on the **Blaze** plan

Create a project at [console.firebase.google.com](https://console.firebase.google.com),
then upgrade it to **Blaze (pay-as-you-go)**.

This is not optional and it is the step most likely to surprise you:

- Cloud Functions **gen2 is unavailable on the free Spark plan**, and
  `firebase.json` deploys gen2.
- Even if it deployed, a function on Spark **cannot make outbound network
  requests** — so the call to Gemini would fail regardless.

Blaze has a generous free tier and this app's usage is tiny, but it is a real
billing account. Step 6 below puts a hard alert on it, and the function itself
is already capped in code (see [Cost](#cost)).

### 3. A Gemini API key

From [Google AI Studio](https://aistudio.google.com/apikey). Keep it on your
clipboard for step 5 — you'll paste it into a prompt, never into a file.

---

## Deploy

### 4. Log in and pick the project

`firebase login` opens a browser and needs your input, so run it yourself. In
Claude Code, prefix it with `!` so the output lands in the session:

```
! firebase login
```

Then link the project:

```
firebase use --add
```

This writes `.firebaserc`. That file holds only a project id — no secrets — so
it is safe to commit, and committing it means you won't be asked again.

### 5. Store the API key as a secret

```
firebase functions:secrets:set GEMINI_API_KEY
```

Paste the key at the prompt. It goes to Google Secret Manager, not into the
repo — `functions/src/index.ts` reads it via `defineSecret`, so the key is
never in your source, your build, or your git history.

### 6. Set a $1 budget alert

In the [Cloud Billing console](https://console.cloud.google.com/billing) →
**Budgets & alerts** → create a budget of $1 on the project, alerting at 50%,
90% and 100%.

Do this before your first deploy, not after. It can't be done from this repo:
a budget is a Cloud Billing setting, not a deploy artifact, so `firebase.json`
has no way to create one.

### 7. Build and deploy

```
npm run build && firebase deploy
```

This uploads `dist/` to Hosting and the function to `asia-south1` — both named
in `firebase.json`. The function build runs automatically via the `predeploy`
hook.

---

## Verify it worked

Open your deployed URL and load a PDF, then:

1. **Select a single word** → a definition with a `DICTIONARY` badge. This path
   already worked locally; it confirms the deploy didn't break anything.
2. **Select a phrase** (two or more words) → a definition with an `AI` badge.
   If it still says *"Definition service not available yet"*, the function
   isn't answering — check `firebase functions:log`.
3. **Select that same phrase again** → it should appear instantly with **zero
   network requests** in the Network tab. That's the local cache.
4. **Check the refusal path.** The 300-character context cap is enforced on the
   server too, so a hand-rolled request with a longer `sentence` must come back
   `400`, not a definition:

   ```
   curl -X POST https://YOUR-DOMAIN/api/define \
     -H 'content-type: application/json' \
     -d "{\"term\":\"x\",\"sentence\":\"$(printf 'a%.0s' {1..400})\"}"
   ```

---

## Cost

The function is already capped in code (`functions/src/index.ts`):

| Guard | Value |
|---|---|
| `maxInstances` | 3 |
| `timeoutSeconds` | 20 |
| `memory` | 256 MiB |
| Per-IP rate limit | 20 requests / minute |

One caveat, flagged in the source: the rate limiter is an in-memory `Map`, so
it is **per instance**. With `maxInstances: 3` the real ceiling is 3× that
number. That's deliberate — it's enough to stop a runaway loop, and a shared
limiter (Firestore or Redis) isn't worth the complexity until this serves real
traffic.

Every answer is cached in the browser per `(term, document)`, so repeat lookups
cost nothing at all.

---

## Notes

**Node version.** This machine runs Node 24; `functions/package.json` pins
`engines.node: 22` and `firebase.json` deploys the `nodejs22` runtime. The
local version only affects the local TypeScript build, so the mismatch is
harmless — the CLI will print an `EBADENGINE` warning and you can ignore it.

**Rolling back.** `firebase hosting:rollback` reverts the site. To take the
function down entirely, `firebase functions:delete api` — the app degrades
back to dictionary-only lookups, which is the state it ships in today.
