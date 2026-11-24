# Hosted setup (no Docker)

Relay needs two services: **PostgreSQL + TimescaleDB** (storage) and an **MQTT broker**
(ingest), plus a `SESSION_SECRET` you generate yourself for sign-in (step 4). A third, **optional** service — **Redis** — adds a fast latest-value cache and live
push. All run as free hosted services, so nothing needs installing locally.

> Free tiers change. Timescale Cloud's free plan is a time-limited trial; check the
> current terms when you sign up. Everything below only needs a connection string,
> so you can swap providers later by editing `.env`.

## 1. TimescaleDB — Timescale Cloud

1. Sign up at <https://console.cloud.timescale.com> and create a service (the smallest size is enough).
2. Copy the **service URL** (a `postgres://tsdbadmin:…@….tsdb.cloud.timescale.com:PORT/tsdb` string).
3. Put it in `.env` as `DATABASE_URL`, and make sure it ends with `?sslmode=require`.

```
DATABASE_URL=postgres://tsdbadmin:PASSWORD@HOST:PORT/tsdb?sslmode=require
```

Then create the tables and the five demo devices (three sensors, a pump and a valve; safe to re-run):

```powershell
pnpm --filter @relay/db migrate:seed
```

If you see a certificate error such as `self-signed certificate`, change the end of the
URL to `?sslmode=no-verify` (encrypted, but the server certificate isn't checked).

## 2. MQTT broker — HiveMQ Cloud

1. Sign up at <https://www.hivemq.com/mqtt-cloud-broker/> and create a free cluster.
2. Open **Access Management** and create credentials (username + password) with publish **and** subscribe permission.
3. Copy the cluster host from the overview page.
4. Put these in `.env`:

```
MQTT_URL=mqtts://YOUR_CLUSTER.s1.eu.hivemq.cloud:8883
MQTT_USERNAME=your-username
MQTT_PASSWORD=your-password
```

Use `mqtts://` and port `8883` (TLS). Plain `mqtt://` on 1883 is not available on the free cluster.

The same credentials are used by the worker (to listen) and by the API (to publish commands to
pumps and valves), so they need both publish **and** subscribe permission.

## 3. Redis — Upstash (optional, recommended)

Redis makes the dashboard **live**: the worker stores each reading's latest value there and
announces it, and the API pushes it to the browser. Without Redis everything still works, the
dashboard just polls every 2 seconds instead.

1. Sign up at <https://upstash.com> and create a Redis database (pick the region closest to you).
2. Copy the **TLS connection string** (it starts with `rediss://`, two s's).
3. Put it in `.env`:

```
REDIS_URL=rediss://default:YOUR_PASSWORD@YOUR_HOST.upstash.io:6379
```

Both the worker and the API read `REDIS_URL`. If Redis is unreachable at any point they log a
warning and carry on; it is an optimisation, never a dependency.

## 4. Sign-in and accounts

The dashboard and API need a login. There are two roles:

| Role       | Can do                                                          |
| ---------- | --------------------------------------------------------------- |
| `viewer`   | See devices, live values and charts.                            |
| `operator` | Everything a viewer can, plus turn pumps and valves on and off. |

No account is created for you and none is stored in the repo. Set it up once:

1. Put a signing secret in `.env` (it signs the login cookie; keep it private):

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # paste the output as SESSION_SECRET=... in .env
   ```

2. Apply the new database migration (adds the `users` table and a `user_id` column on
   `device_commands`):

   ```powershell
   pnpm --filter @relay/db migrate
   ```

3. Create your account. You are asked for the password (hidden); it is stored only as a salted
   scrypt hash.

   ```powershell
   pnpm --filter @relay/api create-user you@example.com operator
   pnpm --filter @relay/api create-user someone@example.com viewer
   ```

   Running it again for an existing email changes that account's password and role. Passwords
   must be 10 to 200 characters.

How it behaves:

- Every API request needs the session cookie, including the live stream. `/health` stays open.
- The cookie is `HttpOnly` (page scripts can't read it) and lasts `SESSION_TTL_HOURS` (default 12).
  The role is looked up on every request, so removing an account or changing its role takes effect
  immediately.
- After 5 wrong passwords for one email (or 20 from one address) in 15 minutes, sign-in is blocked
  for the rest of that window. The counters live in the API's memory, so restarting it clears them.
- Browser requests from any origin other than `WEB_ORIGIN` are refused.
- Every command records which account sent it (`device_commands.user_id`).

**Known limits.** Signing out removes the cookie from your browser, but the token itself stays
valid until it expires (sessions are not stored server-side), so treat a stolen cookie as valid
until `SESSION_TTL_HOURS` runs out; change `SESSION_SECRET` to end every session at once. There
is no self-service password reset or user-management screen yet: use `create-user`. When the
dashboard and API run on different sites, serve both over https and set `COOKIE_SAMESITE=none`.

## 5. Run the pipeline

Open four terminals in the repo root (sign-in is set up in step 4):

```powershell
pnpm --filter @relay/worker start           # subscribes, validates, inserts
pnpm --filter @relay/mock-publisher start   # 3 fake temperature sensors + a simulated pump and valve
pnpm --filter @relay/api start              # GraphQL at http://localhost:4000/graphql
pnpm --filter @relay/web dev                # dashboard at http://localhost:3000
```

The worker logs a line per stored reading. Open <http://localhost:3000>, sign in, and you get a card per
device with its latest value and Live/Stale status, click one to chart it, and with Redis set
the pill in the corner reads **Live (push)** (otherwise **Polling**).

To query the API directly you need the session cookie, so the easiest way is to sign in on the
dashboard first and then open GraphiQL at <http://localhost:4000/graphql> in the same browser:

```graphql
{
  devices {
    id
    name
    location
    latest(metric: "temperature") {
      value
      ts
    }
  }
  history(deviceId: "dev-001", metric: "temperature", limit: 10) {
    value
    ts
  }
}
```

`devices { latest }` is batched: ten devices cost one cache lookup and at most one SQL query.
Live updates are a GraphQL subscription over Server-Sent Events:

```graphql
subscription {
  readingAdded(metric: "temperature") {
    deviceId
    value
    ts
  }
}
```

To simulate other devices, set `DEVICE_IDS` (sensors) or `ACTUATOR_IDS` (pumps/valves), comma
separated, before starting the publisher.

## 6. Controlling devices (pumps and valves)

Signed in as an `operator`, the two actuator cards on the dashboard have **Turn on** / **Turn off**
buttons (a `viewer` sees "View only"). Click one and
the card shows "waiting for the device…" until the device confirms, normally in well under a second.

What happens behind the button:

1. The dashboard calls the GraphQL mutation `sendCommand`.
2. The API checks the session is an `operator`, that the device exists and is a pump or valve, writes the command to the
   `device_commands` table (the audit log, with who sent it), and publishes it to `devices/{id}/commands` at QoS 1.
3. The device switches and publishes `devices/{id}/state` with the same `commandId`.
4. The worker stores the state and marks the command `confirmed`; the dashboard sees it and updates.

```graphql
mutation {
  sendCommand(deviceId: "dev-004", command: "on") {
    id
    status
  }
}
```

If the device never answers, the card shows "No confirmation from the device after 5s. It may be
offline." and the command stays `sent` in the log. If the broker itself is unreachable the API
refuses straight away and marks the command `failed`.

**Safety rules built in.** A command is a physical action, so:

- A command is never queued while the broker connection is down (no surprise "pump on" minutes later).
- Devices must ignore commands older than 30 seconds, or older than one they already applied. The
  simulated devices do, and a real controller should too. This needs roughly synchronised clocks
  (NTP) between the API host and the devices.
- Only `on` and `off` are accepted, and only for pumps and valves; sensors cannot be commanded.

> Signing in protects the API, but the broker and database credentials in `.env` are just as
> powerful: keep `.env` out of git and use separate credentials per environment.

## Troubleshooting

| Symptom                                    | Likely cause                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `ECONNREFUSED 127.0.0.1:…`                 | `.env` still points at `localhost`; paste the hosted connection URL.                     |
| `password authentication failed`           | Wrong DB password in `DATABASE_URL`.                                                     |
| MQTT `Connection refused: Not authorized`  | Wrong `MQTT_USERNAME`/`MQTT_PASSWORD`, or the credential lacks publish/subscribe rights. |
| MQTT connects, no data in the DB           | Worker not running, or publisher and worker use different clusters.                      |
| Pill says **Polling**, not **Live (push)** | `REDIS_URL` missing in `.env`, or the worker and API don't share the same Redis.         |
| Dashboard shows "No devices yet"           | Run `pnpm --filter @relay/db migrate:seed` to create the demo devices.                   |
| API stops at start: `SESSION_SECRET`       | `SESSION_SECRET` is missing or shorter than 32 characters in `.env` (see step 4).        |
| `relation "users" does not exist`          | Run `pnpm --filter @relay/db migrate` to apply the sign-in migration.                    |
| Sign-in says "Too many failed attempts"    | 5 wrong passwords in 15 minutes. Wait, or restart the API to clear the counters.         |
| Sign-in works, dashboard drops to the form | The cookie isn't sent: `WEB_ORIGIN` must equal the dashboard's address exactly.          |
