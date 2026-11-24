# Hosted setup (no Docker)

Relay needs two services: **PostgreSQL + TimescaleDB** (storage) and an **MQTT broker**
(ingest). A third, **optional** service — **Redis** — adds a fast latest-value cache and live
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

## 4. Run the pipeline

Open four terminals in the repo root:

```powershell
pnpm --filter @relay/worker start           # subscribes, validates, inserts
pnpm --filter @relay/mock-publisher start   # 3 fake temperature sensors + a simulated pump and valve
pnpm --filter @relay/api start              # GraphQL at http://localhost:4000/graphql
pnpm --filter @relay/web dev                # dashboard at http://localhost:3000
```

The worker logs a line per stored reading. Open <http://localhost:3000>: you get a card per
device with its latest value and Live/Stale status, click one to chart it, and with Redis set
the pill in the corner reads **Live (push)** (otherwise **Polling**).

To query the API directly, open GraphiQL at <http://localhost:4000/graphql> and run:

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

## 5. Controlling devices (pumps and valves)

The two actuator cards on the dashboard have **Turn on** / **Turn off** buttons. Click one and
the card shows "waiting for the device…" until the device confirms, normally in well under a second.

What happens behind the button:

1. The dashboard calls the GraphQL mutation `sendCommand`.
2. The API checks the device exists and is a pump or valve, writes the command to the
   `device_commands` table (the audit log), and publishes it to `devices/{id}/commands` at QoS 1.
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

> **There is no login yet.** Anyone who can reach the API URL can send commands. That is fine on
> your own machine; add authentication before exposing the API publicly (planned).

## Troubleshooting

| Symptom                                    | Likely cause                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `ECONNREFUSED 127.0.0.1:…`                 | `.env` still points at `localhost`; paste the hosted connection URL.                     |
| `password authentication failed`           | Wrong DB password in `DATABASE_URL`.                                                     |
| MQTT `Connection refused: Not authorized`  | Wrong `MQTT_USERNAME`/`MQTT_PASSWORD`, or the credential lacks publish/subscribe rights. |
| MQTT connects, no data in the DB           | Worker not running, or publisher and worker use different clusters.                      |
| Pill says **Polling**, not **Live (push)** | `REDIS_URL` missing in `.env`, or the worker and API don't share the same Redis.         |
| Dashboard shows "No devices yet"           | Run `pnpm --filter @relay/db migrate:seed` to create the demo devices.                   |
