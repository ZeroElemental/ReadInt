# Deploying ReadInt

The app itself is a static site and needs nothing but hosting. This document is
really about the one server ReadInt has — `POST /api/define`, which answers
definition lookups the public dictionary can't, using Gemini Flash.

**Everything here needs your Google account, so none of it can be automated for
you.** Roughly 15 minutes, most of it waiting on the console.

Until this is done the app works: PDFs, annotations, search and single-word
definitions all run locally. Only the AI fallback is missing, and it says so.

> Done once, against `readint-6b7d2` in `asia-south1`. The notes below marked
> **in practice** are what actually happened, as opposed to what the docs
> promised.

---

## Before you start

Three things, and the second one stops the deploy dead if you skip it.

### 1. Install the Firebase CLI

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

### 3. A Gemini API key, with a balance

From [Google AI Studio](https://aistudio.google.com/apikey). Attach it to the
project from step 2, not a different one.

**In practice — this is where the deploy actually stalls.** Prepay has been the
default for new users since March 2026, and a fresh key starts at a **$0
balance**, so every call comes back `429 RESOURCE_EXHAUSTED` ("Your prepayment
credits are depleted") even though nothing has been spent. Buy credits at
[AI Studio → Billing](https://aistudio.google.com/billing); the minimum is $5.

If you have a Google AI Pro subscription its $10/month Cloud credit does **not**
rescue you here: promotional credits cannot apply to a zero prepay balance, so
the $5 has to go in first. It does cover the Cloud Run side.

Which tier the key sits on is also a privacy decision, not just a billing one.
On the paid tier Google "doesn't use your prompts ... or responses to improve
our products"; on the free tier it does. This app tells its users their reading
does not leave their device, so the key belongs on a billing-enabled project.

Keep the key on your clipboard for step 5 — you'll paste it into a prompt,
never into a file.

---

## Deploy

### 4. Log in and pick the project

`firebase login` opens a browser and needs your input, so run it yourself. In
Claude Code, prefix it with `!` so the output lands in the session:

```
! firebase login
```

**In practice** `firebase login` fell back to a paste-a-code flow and then died
with a libuv assertion (`src\win\async.c`) on Windows, because the CLI tries to
prompt on a stdin that is not a TTY. The URL it prints is still valid: visit it,
then run `firebase login <code>`. Running it in a normal terminal window avoids
the whole problem — credentials persist to your user config either way.

Then link the project:

```
firebase use --add
```

This should write `.firebaserc`. **In practice** it stored the selection in the
CLI's own config, keyed by directory, and wrote nothing to the repo — so the
link would not survive a clone. `.firebaserc` is committed here instead; it
holds only a project id, no secrets.

### 5. Store the API key as a secret

```
firebase functions:secrets:set GEMINI_API_KEY
```

Paste the key at the prompt. It goes to Google Secret Manager, not into the
repo — `functions/src/index.ts` reads it via `defineSecret`, so the key is
never in your source, your build, or your git history.

**In practice** the same non-TTY problem bites: the prompt reads empty and the
call fails with `400 Secret Payload cannot be empty`, having already created the
secret container with **zero versions**. Two ways round it, and the first is
better — the second leaves the key in your shell history and appends a newline
that ends up inside the secret:

1. [Secret Manager](https://console.cloud.google.com/security/secret-manager) →
   the `GEMINI_API_KEY` secret → **New version** → paste.
2. `... | firebase functions:secrets:set GEMINI_API_KEY --data-file -`

Confirm with `firebase functions:secrets:get GEMINI_API_KEY` — you want one
version, `ENABLED`. The deploy grants the function's service account access
automatically.

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
in `firebase.json`, and they **must agree**: Hosting resolves the `/api/**`
rewrite by function id *and* region, so a mismatch 404s. The function build runs
automatically via the `predeploy` hook.

**In practice** the first run deployed the function fine and then exited
non-zero on a missing Artifact Registry cleanup policy — which aborted Hosting
before it released, leaving the site on "Site Not Found" despite a successful
upload. Set the policy, then deploy again:

```
firebase functions:artifacts:setpolicy --location asia-south1 --force
```

Without `--location` it looks in `us-central1` and reports the repository does
not exist. The policy deletes build images older than a day; without it they
accumulate and quietly bill you.

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
   `400`, not a definition (`{1..400}` is bash-only; use `$(seq 400)` in sh):

   ```
   curl -X POST https://YOUR-DOMAIN/api/define \
     -H 'content-type: application/json' \
     -d "{\"term\":\"x\",\"sentence\":\"$(printf 'a%.0s' {1..400})\"}"
   ```

   Verified against the live deployment: 301 characters → `400`, exactly 300 →
   `200`, `GET` → `405`, an unknown path under `/api/` → `404`, a missing term
   → `400`. The server refuses rather than truncating, which is the point —
   a client sending too much is a bug on the side of the boundary that matters
   and should hear about it.

---

## Cost

The function is already capped in code (`functions/src/index.ts`):

| Guard | Value |
|---|---|
| `maxInstances` | 3 |
| `timeoutSeconds` | 20 |
| `memory` | 256 MiB |
| Per-IP rate limit | 20 requests / minute |
| `maxOutputTokens` | 800 |
| Artifact cleanup | images older than 1 day |

A lookup takes 1.8–2.2 s at `thinkingLevel: 'minimal'`, which is the floor —
3.x Flash cannot switch thinking off. At `'low'` it was 4.2–4.8 s. Thinking
tokens count against `maxOutputTokens`, so lowering that number does not save
money so much as truncate the answer to nothing.

One caveat, flagged in the source: the rate limiter is an in-memory `Map`, so
it is **per instance**. With `maxInstances: 3` the real ceiling is 3× that
number. That's deliberate — it's enough to stop a runaway loop, and a shared
limiter (Firestore or Redis) isn't worth the complexity until this serves real
traffic.

Every answer is cached in the browser per `(term, document)`, so repeat lookups
cost nothing at all.

---

## Notes

**The OCR assets ship with the site.** `public/tessdata/` is ~5.8MB — a wasm
core and an English model — which Vite copies into `dist/` verbatim. After a
deploy, check one is actually being served:

```
curl -sI https://readint-6b7d2.web.app/tessdata/eng.traineddata.gz
```

It must come back as the file, **not** `text/html`. The SPA rewrite in
`firebase.json` answers anything it cannot find with `index.html`, so a missing
asset reaches tesseract as a page of HTML and fails as a corrupt wasm rather
than as a 404.

**Node version.** This machine runs Node 24; `functions/package.json` pins
`engines.node: 22` and `firebase.json` deploys the `nodejs22` runtime. The
local version only affects the local TypeScript build, so the mismatch is
harmless — the CLI will print an `EBADENGINE` warning and you can ignore it.

**A retired model is now visible, and retried once.** A `404` from Gemini —
the answer for "no such model" — retries against `gemini-flash-latest`, and any
failure returns Google's status and reason in the 502 body under `upstream`
(the client also logs it), so it no longer lives only in `firebase functions:log`.
The fallback alias has **not been exercised against this project's key** and is
not the model `thinkingLevel: 'minimal'` was tuned on — if it ever fires, check
the latency and the answers before trusting it. Tests: `cd functions && npm test`
(Node 24; the deploy runtime, 22, cannot strip types).

**The model id expires.** `functions/src/index.ts` names a specific Gemini
model. `gemini-2.5-flash` was closed to new projects between that line being
written and this project being created, and answered `404` with a pointer to
its replacement. If definitions start failing after a quiet period, read the
upstream status in `firebase functions:log` before suspecting your own code.

**Rolling back.** `firebase hosting:rollback` reverts the site. To take the
function down entirely, `firebase functions:delete api` — the app degrades
back to dictionary-only lookups, which is the state it ships in today.
