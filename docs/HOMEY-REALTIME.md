# Direct Homey realtime updates

Both CrowPanel Advance models (5 and 7 inches) and the desktop simulator subscribe
directly to Homey notifications using the existing `HOMEY_ADDRESS`, `HOMEY_TOKEN`
and configured device/price-variable IDs. No web server or extra credential is
required. Installing a new firmware build enables this on an existing display;
compiling alone does not update hardware.

The web app has an independent server-side Homey connection and sends normalized
snapshots to browsers through SSE; see [web transport details](WEB.md). Both paths
retain the same source restrictions, validation and units. Sonos, weather and
history keep their independent refresh paths.

## Protocol and reconciliation

The component implements Homey's Engine.IO 3 / Socket.IO 2 notification protocol,
matching the official local `homey-api` client: get the Homey ID through the
read-only system ping, authenticate the root socket, join the returned namespace
and acknowledge subscriptions to configured devices and Logic. Empty (`[]`) and
null (`[null]`) subscription acknowledgements are accepted. Logic events are
filtered to the configured price variable. No capability writes or Flows are
sent on this socket.

Notifications schedule the existing source-specific REST readers. Event values
never bypass their validation. Availability/deletion events also schedule reads;
normal failure handling clears missing values. Evohome events coalesce into one
controller-and-zones refresh. A running reader finishes before a later event
schedules another read.

Existing 10-second fast reads, 60-second summaries, 30-second climate reads and
15-minute price refresh remain as reconciliation and fallback. Denied or
unsupported subscriptions therefore leave direct polling usable. Existing value
expiry rules still apply: a connected socket does not keep measurements fresh.
Actual latency depends on device reporting and Homey's REST response time.

## UI priority, limits and recovery

All socket I/O and authentication run on a separate worker. On ESP32 it uses an
8 KiB stack on core 0 at priority 1, below the display loop. The worker publishes
only a bounded atomic bitmask. The foreground drains it in fair round-robin
order, once per source per second, at least 20 ms between sources, and only in
the existing touch/scroll quiet window. Event bursts cannot grow an unbounded
queue. Running readers defer new notifications rather than restarting requests.

Messages are bounded to 32 KiB and JSON nesting is bounded. WebSocket fragments
are reassembled and control pings receive pongs. Engine.IO heartbeats follow the
advertised interval/timeout. Missing heartbeats, malformed messages, rejected
subscriptions and disconnects close the session. Retry delays grow from 1 to
30 seconds; a successful connection re-authenticates, restores subscriptions and
reconciles sources.

HTTP uses local WS; HTTPS uses WSS with certificate and hostname verification.
ESP32 uses ESP-IDF's built-in WebSocket transport and certificate bundle. The
simulator uses the same application protocol with an OpenSSL-backed host
transport. Credentials, identifiers, addresses and message bodies are not logged.

## Verification

Build the simulator and both firmware targets with the normal repository setup.
Do not flash hardware unless explicitly requested.

```sh
.venv/bin/python scripts/test-homey-realtime.py
.venv/bin/python scripts/test-ui-priority.py
npm test --prefix web
```

The realtime test uses synthetic credentials and a loopback peer with ASan/UBSan.
It checks authentication, acknowledgements, scoped filtering, bounds, fragmented
text, interleaved WebSocket pings, Engine.IO heartbeats and disconnect handling.
The UI-priority test links the built simulator and verifies input, publication
and existing HTTP/artwork behavior.

Optional explicit read-only verification against the configured Homey:

```sh
.venv/bin/python scripts/test-homey-realtime.py --live
```

This reads the local `.env`, subscribes to the configured P1 meter and price
variable, and reports counts without printing identifiers or household readings.
It never controls devices. Host tests and builds do not establish physical-device
memory or touch latency; those need a separate requested hardware rollout.
