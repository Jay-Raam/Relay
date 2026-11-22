# Hosted setup (no Docker)

Relay needs two services: **PostgreSQL + TimescaleDB** (storage) and an **MQTT broker**
(ingest). Both run as free hosted services, so nothing needs installing locally.

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

Then create the tables and the demo device:

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

## 3. Run the pipeline

Open three terminals in the repo root:

```powershell
pnpm --filter @relay/worker start           # subscribes, validates, inserts
pnpm --filter @relay/mock-publisher start   # publishes a fake temperature every 2s
pnpm --filter @relay/api start              # GraphQL at http://localhost:4000/graphql
```

The worker logs a line per stored reading. In GraphiQL (`/graphql`) run:

```graphql
{
  latest(deviceId: "dev-001", metric: "temperature") {
    value
    ts
  }
  history(deviceId: "dev-001", metric: "temperature", limit: 10) {
    value
    ts
  }
}
```

## Troubleshooting

| Symptom                                   | Likely cause                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ECONNREFUSED 127.0.0.1:…`                | `.env` still points at `localhost`; paste the hosted connection URL.                     |
| `password authentication failed`          | Wrong DB password in `DATABASE_URL`.                                                     |
| MQTT `Connection refused: Not authorized` | Wrong `MQTT_USERNAME`/`MQTT_PASSWORD`, or the credential lacks publish/subscribe rights. |
| MQTT connects, no data in the DB          | Worker not running, or publisher and worker use different clusters.                      |
