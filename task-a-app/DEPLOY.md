# Deploying

Two things have to go up, in this order. The web build bakes the API URL in at
build time, so the API has to exist first.

## Currently deployed

| | |
| --- | --- |
| Web app | **https://adith-senthil-kumar.github.io/TaskA/** |
| Mock API | **https://us-central1-busbuddy-1cb30.cloudfunctions.net/taskAMockApi** |

### The mock API, as a Cloud Function

`functions/index.js` runs the same rules as the local server — both import
`mock-api/domain.js`, which is where the conflict, ranking and idempotency
decisions actually live. Only the storage differs.

That difference is the whole reason the function exists in this shape. A Cloud
Function is stateless and can cold-start between any two requests, and this
API's entire job is to hold a version number long enough for a client to
collide with it. So the state is one JSON document in Firestore, mutated inside
a transaction, because the conflict demo *is* a race between two writers.

`firebase.json` copies `domain.js` into `functions/` as a predeploy step, so the
deployed rules cannot drift from the tested ones. `functions/domain.js` is
generated and gitignored — do not edit it.

Deploy it with:

```bash
cd task-a-app
firebase deploy --only functions:taska:taskAMockApi
```

**Always deploy with that exact `--only` scope.** The target project also runs
an unrelated live application with four functions of its own, plus Firestore
rules and a Hosting site. A bare `firebase deploy` would consider all of those
in scope. `firebase.json` deliberately declares *only* a functions block and
puts this function in its own `taska` codebase, so both the config and the
command have to be wrong before anything else can be touched.

Useful while demoing:

```bash
API=https://us-central1-busbuddy-1cb30.cloudfunctions.net/taskAMockApi

curl -X POST $API/admin/reset                             # back to the 18 seeded stops
curl -X POST $API/admin/offline -d '{"offline":true}' -H 'Content-Type: application/json'
curl -X POST $API/admin/orders/ord-005/status -d '{"status":"failed"}' -H 'Content-Type: application/json'
```

`render.yaml` is still in the repo as an alternative host for the same server if
you ever want it off Firebase.

### The web app, on GitHub Pages

It is served from the `gh-pages` branch, which holds the built output only.
Two details that Pages requires and that are easy to lose:

- **`.nojekyll`** must exist at the root, or Pages runs the output through
  Jekyll and silently drops `_expo/` — every asset 404s because the directory
  name starts with an underscore.
- **`404.html` is a copy of `index.html`.** Pages has no SPA rewrite, so a deep
  link like `/TaskA/outbox` is served as the 404 document. The status code
  is still 404, but the shell boots and the router resolves the path, so it
  works. Anything expecting a 200 on a deep link will disagree.

Because Pages serves from a subpath, `expo.experiments.baseUrl` is set to
`/TaskA` in `app.json`. **Remove it if you ever deploy to a root domain**, or
every asset path will be wrong in the other direction.

Redeploy with:

```bash
cd task-a-app
EXPO_PUBLIC_API_URL=<api-url> npx expo export --platform web --clear
cd dist && touch .nojekyll && cp index.html 404.html
git init -q && git add -A && git commit -qm "Deploy web build"
git push -f https://github.com/Adith-Senthil-kumar/TaskA.git HEAD:gh-pages
```

The build is wired to the Cloud Function above via `EXPO_PUBLIC_API_URL`, so the
live site pulls a real route and pushes real status changes.

## 1. The mock API

`render.yaml` in this directory is a Render blueprint. Point Render at the repo,
pick "Blueprint", and it will read it. Nothing to configure.

Check it with:

```bash
curl https://<your-service>.onrender.com/health
```

You should get `{"ok":true,"orders":18}`.

**Render's free tier sleeps after 15 minutes idle**, and the first request after
that takes roughly 50 seconds. A reviewer hitting the live URL cold will see the
app sit on "No route yet" and reasonably assume it is broken. Options, in order
of preference:

- Use Fly.io or Railway instead, which do not cold-start as harshly
- Keep it warm with an uptime pinger (cron-job.org, every 10 minutes, free)
- Say so in the submission notes

The server holds all state in memory, so a restart resets the 18 orders to their
seed state. For a demo that is a feature, not a problem.

## 2. The web build

```bash
EXPO_PUBLIC_API_URL=https://<your-service>.onrender.com npx expo export --platform web --clear
```

**`--clear` is not optional.** `EXPO_PUBLIC_*` values are inlined into the
bundle at transform time, but Metro's transform cache lives outside the project
and is keyed on file contents, not on the environment. Without it you get a
cache hit and silently ship a build still pointing at `http://localhost:4000` —
which produces a live site that loads, looks fine, and shows an empty route.

So always confirm the URL actually made it in. This takes two seconds and
catches the whole failure mode:

```bash
grep -c 'onrender.com' dist/_expo/static/js/web/entry-*.js   # expect 1, not 0
grep -c 'localhost:4000' dist/_expo/static/js/web/entry-*.js # expect 0, not 1
```

The Profile screen also prints the value under "Dispatch server", so it is
visible in the running app.

Then deploy `dist/` as a static site:

```bash
npx netlify-cli deploy --dir dist --prod
```

or drag `dist/` onto app.netlify.com/drop, or `npx vercel --prod dist`.

**The app is exported as a single-page app** (`web.output: "single"` in
`app.json`), so the host must serve `index.html` for unknown paths or deep links
like `/outbox` will 404 on refresh. Netlify and Vercel both do this
automatically for SPA output. For GitHub Pages, copy `index.html` to `404.html`.

## The phone build

The app is a phone app, and the web build is a demo surface rather than the
thing itself. The Android build is what a reviewer should actually install.

```bash
eas build --platform android --profile preview
```

The `preview` profile in `eas.json` produces an **APK** with internal
distribution, which is what makes the install page work: EAS returns a page
with a QR code and a direct download, so a reviewer scans it, installs, and
runs the real app. No Expo account and no Expo Go on their side.

`EXPO_PUBLIC_API_URL` is baked in from the profile's `env` block, so the
installed app talks to the hosted mock API rather than localhost.

**Expo Go will not load this project.** Every native module it uses is in Expo
Go's bundled set, so the code would run — but the project is configured for EAS
Update with an `appVersion` runtime policy, and Expo Go asks for
`exposdk:57.0.0`. The manifest endpoint answers `204 No Content` to that, which
is correct: those are different runtimes and serving one to the other is how you
get a crash that looks like a bug in the app. The APK is the honest artifact.

iOS is not built here. An `.ipa` that installs on someone else's iPhone needs a
paid Apple Developer account for ad-hoc provisioning or TestFlight, and there
isn't one. iOS reviewers get the web build.

Over-the-air updates are wired up on the `preview` channel, so a JS-only change
can be shipped to an already-installed APK without rebuilding:

```bash
eas update --branch preview --environment preview --message "..."
```

## 3. Check before sending

- Open the live URL in a private window — the route list should populate
- Profile → "Dispatch server" shows the public API URL, not localhost
- The footer credit reads "Built for Digital Heroes Training Task" and links to
  digitalheroesco.com
- Deep link straight to `/outbox` and reload it

## What is not deployed

There is no Expo Go / EAS Update link yet. `npx expo start --tunnel` gives a
QR code that only works while your machine is running, which is not much use to
a reviewer. `eas update` is the real answer and needs an Expo account.
