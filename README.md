# Lastmile — Digital Heroes Task A

Adith Senthil Kumar · Role 06, Mobile App Developer

**Live demo → https://adith-senthil-kumar.github.io/TaskA/**

It is talking to a real mock API, not fixtures. The server is slow, fails a
percentage of requests on purpose, and will disagree with the client about what
happened to an order — so the retry, backoff and conflict paths on the live site
are the real ones.

## What's in here

| Folder | Contents |
| --- | --- |
| `task-a-app/` | The Lastmile app. React Native + Expo, offline-first, 50 tests. Start with its own `README.md` — that's the deliverable that argues the decisions. |
| `design-prototypes/` | The HTML design prototypes. Open `Lastmile v2.dc.html` in a browser — it's the visual reference the app was built from. |
| `screenshots/` | The sync states, captured from the production build: queued offline, retry after a 503, the queue draining, and a conflict escalating to the driver. |

## Task B

Task B is a separate submission and lives in its own repository:

**https://github.com/Adith-Senthil-kumar/Taskb**

Nothing in this repository relates to it.

## Fastest path to running it

```bash
cd task-a-app
npm install
npm run mock-api     # terminal 1
npm start            # terminal 2
```

The mock API is deliberately hostile — it is slow, it fails a percentage of
requests, and it will disagree with the client on purpose. That is the point:
none of the interesting paths in the sync engine are reachable against a server
that always returns 200.

To watch the offline behaviour rather than read about it:

```bash
# queue a change with no server, then bring it back
curl -X POST localhost:4000/admin/offline -d '{"offline":true}' -H 'Content-Type: application/json'

# make dispatch change an order underneath the driver, forcing a conflict
curl -X POST localhost:4000/admin/orders/ord-005/status -d '{"status":"failed"}' -H 'Content-Type: application/json'
```

## State

- 50 tests passing, typecheck clean, verified from a fresh clone
- Runs on web; the five sync states in `screenshots/` were captured from the
  production build, not the dev server
- Not yet run on a physical device or simulator — see "What the tests could not
  catch" in `task-a-app/README.md`, which is honest about what that cost
- Deploying: `task-a-app/DEPLOY.md`

## Where I used AI

I used Claude Code throughout, and the split is worth stating plainly rather
than blurring. The architecture is mine and it is what I would defend in a
review: choosing a delivery-driver context so offline-first was a requirement
rather than a feature, keeping `src/core` free of React Native imports so the
sync logic is testable without a simulator, committing the order, history and
outbox writes as a single transaction, ranking statuses instead of trusting
device clocks, and escalating `delivered` versus `failed` to a human rather
than guessing. Claude wrote most of the code against those decisions, and did
the part that reading alone cannot: the first real run surfaced five defects I
would not have found on paper — an unbound `fetch` that only breaks in a
browser, a Zustand selector that re-rendered until React gave up, a
`Link asChild` style merge that silently discarded every row style, a router
root that excluded the entire UI from the bundle, and a status card reporting
"All caught up" while the network was down. It also handled the deployment, the
mock API as a Cloud Function, and the Android build. What I changed afterwards
came from auditing the result against the brief myself: search, created date,
last sync time, app version, a Force Sync button and dark mode were all
missing and got added, the screen and field names were corrected to match the
brief exactly, and the footer credit moved from one screen to all five. The
honest summary is that Claude out-typed me and I out-decided it, and both
halves were necessary — the bugs it caught were ones I could not have seen
without running the app, and the gaps I caught were ones it had no way to know
mattered.
