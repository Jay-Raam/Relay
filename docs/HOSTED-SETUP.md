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

Then create the tables and the three demo devices (safe to re-run):

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
pnpm --filter @relay/mock-publisher start   # publishes a fake temperature for 3 devices every 2s
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

To simulate other devices, set `DEVICE_IDS` (comma separated) before starting the publisher.

## Troubleshooting

| Symptom                                    | Likely cause                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `ECONNREFUSED 127.0.0.1:…`                 | `.env` still points at `localhost`; paste the hosted connection URL.                     |
| `password authentication failed`           | Wrong DB password in `DATABASE_URL`.                                                     |
| MQTT `Connection refused: Not authorized`  | Wrong `MQTT_USERNAME`/`MQTT_PASSWORD`, or the credential lacks publish/subscribe rights. |
| MQTT connects, no data in the DB           | Worker not running, or publisher and worker use different clusters.                      |
| Pill says **Polling**, not **Live (push)** | `REDIS_URL` missing in `.env`, or the worker and API don't share the same Redis.         |
| Dashboard shows "No devices yet"           | Run `pnpm --filter @relay/db migrate:seed` to create the demo devices.                   |
