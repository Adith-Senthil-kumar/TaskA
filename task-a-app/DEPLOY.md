# Deploying

Two things have to go up, in this order. The web build bakes the API URL in at
build time, so the API has to exist first.

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
