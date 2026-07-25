# Lastmile

An offline-first order management app for delivery drivers, built with React Native and Expo.

Submitted for the Digital Heroes Mobile App Developer task (Role 06, Task A).

---

## Why a delivery app

The brief asked for a four-screen order management app that works offline. I picked delivery drivers as the user because it is the context where offline-first stops being a feature and becomes the requirement. A driver loses signal in basements, lifts, underground car parks and on rural routes — and the moment they most need to record something is the moment they are standing at a door, which is exactly where the signal is worst.

That single decision drives everything else in this codebase. If the app can be unusable for ninety seconds while a request retries, none of the design below is justified. Because it cannot, all of it is.

---

## Running it

```bash
npm install
npm run mock-api      # terminal 1 — mock server on :4000
npm start             # terminal 2 — Expo
```

The mock API is deliberately hostile. By default it adds 150–300ms of latency and fails 15% of writes with a 503, because a mock that always returns 200 instantly leaves every interesting branch of the sync engine unreachable.

```bash
LATENCY_MS=800 FAILURE_RATE=0.5 npm run mock-api   # a genuinely bad day
```

Two admin endpoints exist to force situations that are otherwise hard to reproduce by hand:

```bash
# Simulate a total outage — the server drops connections
curl -X POST localhost:4000/admin/offline -d '{"offline":true}' -H 'Content-Type: application/json'

# Simulate dispatch changing an order underneath the driver (forces a conflict)
curl -X POST localhost:4000/admin/orders/ord-005/status -d '{"status":"failed"}' -H 'Content-Type: application/json'
```

```bash
npm test          # 50 tests
npm run typecheck
```

---

## Architecture

```
src/core/     pure TypeScript — no React, no React Native, no SQLite
src/data/     the adapters: expo-sqlite, fetch, NetInfo
src/store/    Zustand — a projection of the database, not a second truth
src/ui/       design tokens, shared components, sync-state vocabulary
src/app/      composition root, the only file that knows every concrete type
app/          expo-router screens (route, detail, status, outbox, profile)
mock-api/     Node standard library mock server
```

### The core has no framework imports

Everything in `src/core` — the sync engine, the conflict rule, the status machine, the backoff — depends only on the interfaces in `core/ports.ts`. Storage, HTTP and connectivity are injected.

This is the decision I would defend hardest, because of what it buys:

- **The tests that matter run in plain Node.** No `jest-expo` preset, no native module mocks, no simulator. The full suite is 50 tests in about two seconds. Sync logic that is slow or awkward to test does not get tested, and untested sync logic is where offline apps lose people's work.
- **The failure paths are reachable.** Testing "the server accepted the third retry but the response was lost" against a real network is impractical. Against a programmable fake it is four lines.
- **Swapping an adapter is a one-file change.** Moving from SQLite to WatermelonDB, or from fetch to something else, does not touch the engine or its tests.

The cost is one extra indirection and about 120 lines of interface definitions. For a layer whose bugs are silent data loss, that is cheap.

### State management: Zustand, with SQLite as the source of truth

The store holds a projection of the database. Every mutation goes to the sync engine, which writes SQLite; the store is then refilled by reading SQLite back.

That extra read is deliberate. It means what the driver sees on screen is what is actually on disk — a force-quit mid-shift loses nothing, and the UI can never display a change that was never persisted.

**Why not Redux Toolkit.** Its real strengths — enforced action shapes, middleware, time-travel debugging — solve a coordination problem this app does not have. All writes funnel through a single engine, and the logic worth inspecting lives in `src/core`, where it is unit-tested directly rather than through the store. Redux would be the better answer on a larger team with many independent writers.

**Why not TanStack Query.** It is excellent when the server cache *is* the state. Here it is not: SQLite is authoritative and the server is a peer that syncs with it. Using a server-cache library would mean fighting its model on every mutation.

### Offline: local write, then an outbox

A status change is committed to SQLite and acknowledged on screen before the network is consulted at all. The app behaves identically with and without signal, because the network is not on the path between the driver's tap and the app's response.

The order update, the history entry and the outbox entry are written **in a single transaction** (`SqliteStore.commitStatusChange`). If those were three separate writes, a crash between them would leave the driver looking at a delivered order that the server will never hear about — the exact failure offline-first exists to prevent. This is also the specific reason I chose SQLite over AsyncStorage or MMKV: key-value stores give no transactional guarantee across two keys.

The outbox drains when signal returns. There is no polling timer — regaining connectivity is the trigger, because a phone in a dead zone should not spend its battery on requests that cannot succeed.

**Ordering.** Entries are processed oldest-first, and if one entry for an order cannot be sent, every later entry *for that same order* is held back for that pass. Without this, a driver who marks an order in transit and then delivered while offline could have the delivery land first, and the server's history would describe a journey that never happened. Other orders are unaffected — one stalled stop does not block the route.

**Retries** use exponential backoff with full jitter, capped at five minutes, giving up after eight attempts. The jitter is not decoration: a depot of vans regains signal simultaneously when they leave an underground car park, and without jitter every device retries in lockstep and the retry storm becomes indistinguishable from the outage that caused it.

**Idempotency.** Every outbox entry carries a UUID that is sent as `Idempotency-Key` and reused on every retry. The server must return the original outcome for a repeat of that key, because a response lost on a flaky link must not become a second write. The mock server implements this, and there is a test asserting a replayed key does not advance the order version twice.

### Conflict handling: status never moves backwards

Two people can act on the same order while one of them is offline. When they disagree, the rule is that an order's status never moves backwards.

Statuses are ranked: `pending(0) → confirmed(1) → in_transit(2) → delivered(3) / failed(3)`. The higher rank wins.

**Why not last-write-wins.** It depends on client clocks, and a driver's phone can be minutes or hours out after a timezone change or a manual clock edit. Worse, it fails in exactly the case that matters most: a driver marks a parcel delivered while offline, dispatch marks it in transit a minute later, and on reconnect the newer write silently erases the delivery. Ranking by status means the outcome depends on what physically happened to the parcel, not on whose clock was ahead.

**The one case the rule cannot settle** is `delivered` versus `failed`. Both are terminal, neither is further along, and the difference is a real-world fact the app cannot infer. This is the only path to `needs_review`, and it is deliberate: a wrong automatic answer means either a customer charged for a parcel they never received, or a parcel written off that was actually handed over. So the app shows the driver both versions and asks. Their answer re-enters the outbox as an ordinary change, so it takes the same tested path as every other write.

**Nothing is ever silently dropped.** Every branch that removes work from the outbox either applies it, supersedes it under a stated rule, or escalates it to the driver. There is no path that discards a change quietly — including permanent server rejections and exhausted retries, both of which flag the order for review rather than vanishing.

---

## Design

The interface was designed before it was built, from a written brief that specified only what each screen had to do — no colours, no layout, no navigation pattern — so the visual argument would be made independently of the data model.

**The thesis: calm by default. Colour only when the phone still owes the server something.**

Hue carries meaning, and the assignment is the design's argument rather than decoration:

| Colour | Meaning |
| --- | --- |
| Grey | Offline. A fact, not an error, and never styled as one |
| Orange | The phone is holding work the server has not confirmed |
| Red | The server refused. The only state that may eventually need the driver to act |
| Purple | A conflict. Rare by design |
| Green | Used exactly twice: shift progress, and the all-caught-up moment |

**Synced work carries no badge at all.** The absence of the orange pill is the "done" state. This is the decision I would point at first — it is what keeps a list of twelve stops readable at arm's length, and it is only possible because sync state is derived per row rather than hidden behind a settings screen.

There is one status card at the top of the route and no other permanent chrome. That card is the single place the app makes a claim about what the server has, and it is required to be honest: it says "No signal — 3 changes saved here, nothing lost" rather than implying anything has been sent.

### Five screens, not four

The brief asked for four. The design argued for splitting the fourth in two, and it was right:

- **Outbox** — the queue, sync state, and conflicts
- **Profile** — driver, vehicle, depot, sign-out

Sync is checked constantly mid-shift; settings are opened roughly once, on a driver's first day. Putting them on the same screen buries the thing that matters. All four required screens still exist; this is an addition, not a substitution.

Conflicts resolve **on the order detail**, not on a screen of their own, because the decision needs the address, the items and the history next to it.

### Where I diverged from the prototype

**No blur.** The prototype uses translucent iOS bars. Those only read correctly on iOS, and a cross-platform app that looks right on one platform and approximate on the other is worse than one that looks deliberate on both. The bars are opaque.

**Delivered does not outrank failed.** The prototype's demo data ranked `delivered` above `failed`, which would let the app auto-resolve that pair. The engine treats them as equal terminal states and escalates instead — see the conflict section above. I kept the engine's rule: silently choosing between "the customer got it" and "the customer did not" is the one call the app has no business making.

## Edge states

These were designed before they were built, because they are where an offline app is actually judged:

| State | What the driver sees |
| --- | --- |
| Offline | Grey, not red. "No signal · 3 changes saved here, nothing lost" |
| Sending | Orange, pulsing, with a count remaining |
| Sync failed | Red — visually distinct from offline, because the server was reachable and refused, and that may need attention |
| Conflict | Both versions side by side with timestamps, and two buttons. The app states plainly that it will not choose, and records the answer as a decision with the driver's name on it |
| Empty route | "No route yet", with a way to check again |
| Empty filter | A separate state, naming the filter and offering to clear it. Saying "no stops" when the driver has twelve would be a lie |
| All caught up | Green, once. The moment the driver is waiting for |

Every row carries its own sync state — `Decide`, `Sending`, `Retry 2`, `2 to send`, or nothing at all. The driver should never have to open another screen to find out whether their work left the phone.

The Outbox is the audit trail: every change still on the device, how long it has waited, how many attempts have failed and why. If the app is going to hold someone's work, it should be able to account for it.

---

## Tests

50 tests, ~2 seconds.

- **`conflict.test.ts`** — the resolution rule, including a symmetry property test asserting that swapping the inputs never produces two winners, and a case that fails under last-write-wins but passes here
- **`syncEngine.test.ts`** — offline queuing, transactional commit, retry and backoff, exhausted retries, permanent failures, per-order ordering, concurrent flush, all three conflict resolutions, reconnect behaviour
- **`integration.test.ts`** — five tests against the real mock API process: pull, push, a replayed idempotency key, a 409 rebase, and an escalation to review

### A bug the tests found

The integration suite originally used a sequential id generator. Two engine instances both produced `id-1`, the mock server correctly replayed its cached response instead of writing again, and a test failed. The bug was in the key generator, not the server — which is exactly why production uses `randomUUID`. I have left the fake that caused it in the repo with a comment, because it is a better argument for idempotency keys than any explanation I could write.

A second bug surfaced the same way: the conflict-rebase path was mutating an outbox entry object in place. That works against an in-memory store and silently loses the rebase against SQLite, which hands back copies. It is now an explicit `rebaseOutboxEntry` write on the port.

### What the tests could not catch

Fifty passing tests and a clean typecheck did not mean the app ran. The first time it was actually started, five things were broken — and the shape of them is the case for isolating `src/core`, because not one of them was in it.

- **Expo Router was loading the wrong directory.** `src/app/runtime.ts` made `src/app` look like a routes folder, and Expo Router prefers it over the top-level `app/`. The entire UI was absent from the bundle and `runtime` shipped as a route. The router root is now named explicitly in `app.json`.
- **Every network call failed in a browser.** `HttpOrderApi` stored the global `fetch` and called it as `this.fetchImpl(...)`, which rebinds the receiver. Hermes does not check the receiver; browsers throw `Illegal invocation`. A test that injects `fetchImpl` never exercises the default, so nothing caught it.
- **Selectors that allocate on every call.** Zustand 5 compares a selector's result by identity, and `selectCounts` builds a fresh object each time, so React re-rendered until it bailed out. The store is tested through the engine rather than through React, so the loop could not exist until a component subscribed.
- **`Link asChild` discarded every row style.** `asChild` passes the child through a Radix `Slot`, which merges `style` by object spread — and a `Pressable` style *function* spreads to `{}`. The route rows rendered with no layout at all. This one was broken on native too, not just web.
- **The status card said "All caught up" while the network was down.** A failed pull set the phase to `error`; the flush that immediately followed reset it to `idle`, because an empty queue really had flushed cleanly. The app was telling the driver the exact opposite of the truth in the one situation it exists to handle. The engine now carries a failed pull into the phase, and this is the bug I would most want to be asked about — every other failure here was loud, and this one was designed to be quiet.

The conclusion I draw is not that the tests were weak but that they were aimed at one layer and only that layer. Everything above `core/ports.ts` — composition, transport binding, the store's contract with React, the navigator — was unverified until something ran it.

---

## Assumptions

The brief was ambiguous in places. Where it was, I made a call and recorded it here.

1. **A driver owns their route.** Two drivers do not share a stop, so conflicts are driver-versus-dispatch, not driver-versus-driver. This is why a single status rank is sufficient and CRDTs are not needed.
2. **Authentication is out of scope.** The mock API takes no credentials. Adding tokens would mean handling refresh-while-offline, which is a substantial subsystem and not what this task is testing.
3. **Photos are captured but not uploaded.** The status change carries a local file URI. Binary upload needs its own queue with different retry economics — resumable, bandwidth-aware, deferred to wifi — and folding it into the status outbox would have been the wrong design. The seam is there; the implementation is not.
4. **The server is the version authority.** Clients never invent version numbers, which is what makes stale-write detection reliable without trusting device clocks.
5. **Timestamps shown to the driver are device-local.** Fine for a single-timezone shift; would need revisiting for cross-border routes.

## Known limits

- No background sync. The queue drains when the app is foregrounded and connected. Real deployment needs `expo-background-task` so a phone in a pocket syncs on the way back to the depot.
- The outbox has no cap. A device offline for a full week would accumulate unbounded entries; production needs a ceiling and a shed policy.
- Photo upload, as above.
- The web build is included for the live-URL requirement, but this is a phone app. `expo-sqlite` on web runs on a WASM build with different persistence characteristics, and the web target should be treated as a demo surface, not a supported platform. It is exported as a single-page app rather than statically rendered: prerendering buys nothing for a database-backed client, and the prerendered HTML shipped the light palette into a dark UI.

---

## Where I used AI

I used Claude throughout, and the honest description is that I directed it rather than accepted it.

The interface was designed with AI as well, from a brief I wrote that deliberately specified function and state only — every screen, every edge state, what each one had to do — and explicitly left colour, typography, layout and navigation open, with an instruction to take a point of view and commit to it. Two directions came back; I chose the calmer, platform-native one and then overrode it in two places, both recorded above.

It wrote most of the boilerplate — the SQLite row mappers, the mock server's seed data, the React Native StyleSheet blocks — and I barely edited those. The parts I want to be judged on are the decisions it was given rather than the ones it made: choosing a delivery-driver context so offline-first was a requirement rather than a feature, ranking statuses instead of comparing timestamps, insisting the three-part write be one transaction, holding back later changes to the same order during a flush, and refusing to auto-resolve `delivered` versus `failed`.

I also changed things after the fact. The engine originally fired a background flush on every write, which made the tests non-deterministic; I made auto-flush an injected policy so a test can drive a pass deliberately. The first version of `flush()` returned an empty report when a flush was already running, which is a lie to the caller — it now returns the in-flight pass. And the two bugs described above were found by tests I asked for specifically because I did not trust the retry path.

---

Built for Digital Heroes Training Task — [digitalheroesco.com](https://digitalheroesco.com)
