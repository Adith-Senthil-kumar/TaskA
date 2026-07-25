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

I used Claude Code throughout. The architecture is mine and it is what I would
defend in a review: a delivery-driver context so offline-first was a requirement
rather than a feature, `src/core` kept free of React Native imports so the sync
logic tests without a simulator, the order, history and outbox writes committed
as one transaction, statuses ranked instead of device clocks trusted, and
`delivered` versus `failed` escalated to a human rather than guessed. Claude
wrote most of the code against those decisions and found five defects that only
appear once the app actually runs. What I changed afterwards came from auditing
it against this brief myself — search, created date, last sync time, app
version, Force Sync and dark mode were missing and got added, and the credit
line moved from one screen to all five.
