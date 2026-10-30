# EnergyDeck mobile web app / PWA

The web app reproduces EnergyDeck's household functions in a responsive interface with Overview, Energy, Sonos and Climate pages. It runs independently of the ESPHome display in one Node.js Docker container. Pinned npm dependencies provide local Sonos SOAP/DIDL parsing and Homey's official realtime client; no frontend build, database or cloud account is required.

## Pages and display parity

The web masthead shows the EnergyDeck brand once. On desktop the clock, date,
Homey connection state and account actions share that same row. Below 900 px,
clock/date and connection state move to a compact second row. The accessible
level-one heading is visually hidden to avoid a second visible brand title;
authenticated metadata is hidden on the login screen.

On desktop the price chart sits beside a stack containing the battery plan and
EV controls. Three compact daily totals follow, then the Home card and weather
side by side. On phones the reading and keyboard order is current energy header,
prices, battery plan, EV controls, daily totals, Home card, then weather. Cards
use their content height; the chart no longer spans unrelated rows. Tighter
spacing keeps the overview compact without shrinking control hit areas.

| View | Features |
| --- | --- |
| Shared header | Current all-in electricity price, sunrise/sunset, smart net/gas/solar-battery meters and heating/car/battery status on every page. |
| Overview | Grid/solar power and daily totals, day/year toggle, battery state and signed power, EV charging/connection/fault status, today/tomorrow prices with provenance, weather and Gas / Sonos / Climate cards. |
| Price chart | 92/96/100 quarter-hour bars, negative prices, current-quarter marker, min/mean/max and cheapest consecutive three hours. From noon, Today rolls from today's noon to tomorrow's noon when tomorrow is valid. |
| Energy | Today's five-minute signed grid-power and gas-rate graphs from Homey Insights, gaps for missing samples, separate import/export colors, and available daily/monthly/yearly summary totals and peaks. Missing capabilities remain dashes. |
| Sonos | Local discovery, visible rooms, current group, track/artist/album and cover, Play/Pause, Previous/Next when supported, room volume ±2 and mute, paged Sonos favorites, and explicit group editing. TV sources hide old music metadata and disable transport while retaining volume. |
| Climate | All nine configured Evohome zones, measured/target temperature, inferred demand and controller programme, plus weather/rain. HeatingOff overrides demand; missing data cannot imply confirmed idle. Climate is read-only, like the display. |
| Weather | Homey current weather and tomorrow's temperature range, a Buienradar two-hour five-minute rain chart with simultaneous yellow Open-Meteo sunshine caps and an explicit next-two-hours sunshine summary, Open-Meteo's exactly interpolated three-hour temperature and sunrise/sunset. |
| Charging | Starts/stops charging through the configured Homey toggle Flow only after a user click and confirmation. Waits for the requested state to be reported by Homey. |
| PWA | Manifest, favicon and phone icons, standalone launch, public-shell service worker for HTTPS/localhost. Private API readings, Sonos images, sessions and device commands are never cached by the worker. |

Price provenance follows the display: each day's `source` is authoritative;
older bridges without that field use `sources[date]`. Both canonical
`homey`/`epexprijzen` and legacy `Homey`/`EpexPrijzen.nl (raw EUR/kWh)` labels
are recognized. Missing or unrecognized provenance stays unknown; warnings or
another day's source never establish today's source.

The Sonos detail tabs are Queue (with the total track count), Rooms and Favorites.
The player separates Up next into caption, title and artist, above stacked transport and volume/mute rows; the queue marks and automatically centers the current
track inside its own scrollable card. Manual scrolling is retained until a track
change or reopening; active gestures finish before automatic following resumes. Queue browsing is read-only, scoped to the selected room's actual
coordinator, and limited to 40 visible entries while preserving the exact total.
Normal, Repeat One and Repeat All have deterministic previews; shuffle explicitly
leaves the next track unknown. Radio/TV show a no-queue message. Failed reads or
queue changes between pages clear the snapshot. Room grouping keeps all three
tabs in place and shows Apply/Cancel below the room list only for a pending draft.

The phone layout scrolls and adapts to width instead of fixing every widget at the panel's 480×800 coordinates. Physical backlight dimming, USB flashing and hardware-specific timing remain display functions. Player volume targets every visible room in the actual group, including after explicit selection. Plus/minus first reads all members, then sets each to the lowest volume plus/minus two percentage points (bounded to 0–100). The Group label shows this minimum. On the Rooms tab, volume targets only the selected physical room and is labelled Room. Missing member volumes abort before any write; uncertain writes are never retried. Mute follows the same group/room scope as volume, including explicit selections. Mixed groups are shown as audible; muted state is shown only when every member is muted. Group mute is read back for every member, matching the display. Transport and favorites affect the actual current Sonos group.

## Start on a trusted home network

1. Install Docker Engine with Docker Compose on your NAS or home server and clone this repository.
2. Copy `.env.example` to `.env` if needed. Reuse the display's `HOMEY_ADDRESS`, `HOMEY_TOKEN`, device IDs, `HOMEY_PRICES_VARIABLE_ID`, Evohome controller/zone IDs, location and Sonos bootstrap addresses. Follow the main README for Homey discovery and the price bridge.
3. Generate a random six-digit PIN:

   ```sh
   node -e "console.log(require('node:crypto').randomInt(1000000).toString().padStart(6, '0'))"
   ```

4. Put it in `.env` with your network settings:

   ```dotenv
   ENERGYDECK_WEB_ACCESS_CODE=replace-with-the-generated-six-digit-PIN
   ENERGYDECK_WEB_BIND_ADDRESS=0.0.0.0
   ENERGYDECK_WEB_PUBLISHED_PORT=65000
   ENERGYDECK_WEB_SECURE_COOKIE=false
   ENERGYDECK_WEB_DEMO=false
   ```

   HTTP does not encrypt the code or session. Use it only on a trusted LAN, limit access with your firewall and keep the port closed on your router. HTTPS configuration is below.
5. Start the container from the repository root:

   ```sh
   docker compose up -d --build
   ```

6. Open `http://YOUR-SERVER-IP:65000` and enter the six-digit PIN. Never append it to the URL. Your phone stays signed in for seven days unless you sign out or recreate/restart the container.

Pull updates and run `docker compose up -d --build` again. This also applies `.env` changes; `docker compose restart` alone does not apply changed environment variables. `docker compose down` stops the app.

The main `compose.yaml` publishes **0.0.0.0:65000 → container port 8080** using
`ports`. `ENERGYDECK_WEB_BIND_ADDRESS` and `ENERGYDECK_WEB_PUBLISHED_PORT` override
that binding. Set the address to `127.0.0.1` for host-only access, or choose
another free published port if 65000 is occupied. No extra Compose file is needed.
The container always listens on 8080. `ENERGYDECK_WEB_PORT` controls the local
Node launcher, not Docker publication. Secure cookies remain the default. The
Docker host must be able to reach Homey and Sonos on your LAN.

## Coolify deployment

Use **only `compose.yaml`** as the Compose file in Coolify. Assign your HTTPS
domain to service `web` and target container port **8080**. The Coolify proxy
routes domain traffic on HTTPS port **443** to this internal port; EnergyDeck
also publishes host port **65000** for direct NAS access. Keep `ENERGYDECK_WEB_SECURE_COOKIE=true` and set
`ENERGYDECK_WEB_ORIGIN` to the exact public origin (for example,
`https://energydeck.example.com`, without `:8080`). Keep the access code and Homey
configuration in Coolify's runtime environment.

After updating the repository, save/reload Coolify's Compose definition and
redeploy. Remove any manually configured published `8080:8080` mapping as well.
The old mapping fails with `Bind for 0.0.0.0:8080 failed: port is already allocated`
when another service uses that NAS port. Do not stop that unrelated service or
change the app's internal port to work around the collision.

[Coolify networking reference](https://coolify.io/docs/core/networking-in-coolify)
explains proxy routing through Docker networks. The default `ports` mapping
reserves 65000 instead of the conflicting NAS port 8080. The proxy still targets
internal port 8080, not 65000.

## HTTPS and outside access

Prefer a private VPN or an HTTPS reverse proxy. A proxy on the Docker host can use the loopback-published port by starting with
`docker compose up -d --build`; the default
upstream is `http://127.0.0.1:65000`. Preserve the external Host header and configure the exact browser-facing origin, including a nonstandard port if used:

```dotenv
ENERGYDECK_WEB_ACCESS_CODE=your-six-digit-PIN
ENERGYDECK_WEB_BIND_ADDRESS=127.0.0.1
ENERGYDECK_WEB_SECURE_COOKIE=true
ENERGYDECK_WEB_ORIGIN=https://energydeck.example.com
```

A proxy in another container needs a private shared Docker network or another explicitly reachable binding; its own `127.0.0.1` is not the Docker host. Do not expose the unencrypted upstream publicly. The app ignores forwarded headers; the configured origin authorizes browser sign-in, sign-out and control requests.

Add the PWA to your phone's home screen using its browser menu. Installation support depends on the browser and HTTPS. Offline launch can show the public interface, but cannot show cached household readings or control devices. Bump the shell cache version in `web/public/sw.js` when changing offline shell assets.

## Existing configuration and permissions

- Homey device and Logic read permissions provide dashboard data and the price bridge. History uses the existing Homey Insights endpoints; an unavailable log or insufficient permission leaves that graph empty with an explanation.
- `HOMEY_CHARGE_FLOW_ID` and Flow-start permission enable the charging button. Missing configuration disables it. The backend reads the charger before starting: it must be available, connected, not faulted and in the opposite state from the explicitly requested target.
- `HOMEY_THERMOSTAT_DEVICE_ID` must refer to `homey:app:com.honeywell:thermostat`. Rooms must be `homey:app:com.honeywell:zone`. Generic sensors/Logic variables never substitute for Evohome.
- `SONOS_BOOTSTRAP_ADDRESS` and optional fallback must be HTTP private IPv4 addresses on port 1400, for example `http://192.168.1.50:1400`. Hostnames, public IPs, link-local metadata addresses, other ports and HTTPS are rejected. These restrictions also apply to discovered topology destinations. No Sonos cloud token or Homey Sonos device is used.
- `ENERGYDECK_LATITUDE` and `ENERGYDECK_LONGITUDE` enable location-based rain/temperature/sun information. Only two decimal places are sent to Buienradar. Location is not included in browser API results.
- Existing tax/VAT/fee settings retain the display's units and defaults. Blank values keep defaults.

## Control behavior

The overview automatically prioritizes **Sonos when any room is playing**, then
**Climate when Evohome reports inferred heat demand**, otherwise **Gas**. Merely
enabling the thermostat programme without room demand does not select Climate.
Unknown/transitioning Sonos replies do not establish a playback stop. Manual card
choices remain usable until this automatic priority changes or five minutes pass without input. Automatic selection
never opens a detail page or sends device commands. ESP and web use the same policy.

The dashboard Gas / Sonos / Climate buttons first select their compact card when another card is visible. Tapping the button for the already visible card opens its detail page: Gas opens Energy, Sonos opens the player and Climate opens the thermostat/zones page. This matches the ESP display. Dedicated navigation and Open player / All rooms links still open details directly.

Opening pages, selecting rooms or tabs, editing a group draft and polling do not change devices. The compact player follows a currently playing room; an explicit room selection on the full player remains selected. Music starting selects the compact Sonos card; confirmed stopping returns that card to Climate when heat is requested, otherwise Gas. The full player also returns to the appropriate home card after previously playing music stops in all known rooms, while opening an already idle player leaves it open. Unknown/transitioning room states never prove playback has stopped. Manual card selection remains until the automatic priority changes or five minutes pass without input. A confirmed
playback stop returns the full player to the appropriate home card.

Sonos transport actions are matched after trimming whitespace from each comma-separated
name, matching the ESP parser. A stopped player advertising `Set, Stop, Play`
therefore enables Play; unsupported or partial names such as `NextTrack` do not
enable Next. Disabled controls show an unavailable cursor; only an active command
uses a waiting cursor.

Sonos reads and commands share one serialized worker queue; waiting controls skip queued background reads. Every command captures the displayed room and topology scope. Fresh discovery must still match before a write; external regrouping cancels stale commands/drafts. The browser sends identifiers and typed actions, never speaker URLs, arbitrary SOAP or raw favorite resources.

Volume/mute target the actual group in the player and the selected physical room on the Rooms tab; playback, skips and favorites target the fresh coordinator. Favorites are re-read from `FV:2` in bounded pages with one consistent UpdateID. Non-playable shortcuts are excluded. Radio sets the URI only when needed, waits for source readiness, then plays. Queue favorites append once, select the queue, seek to the first newly appended track and play; the old queue is never cleared. Source normalization only accepts the display's documented Sonos stream flag/percent-escape changes. Group/volume/mute are not changed by favorite playback.

Room checkboxes are a draft. Apply rechecks the full visible inventory, promotes the selected anchor without clearing its source when necessary, preserves unrelated followers under a remaining coordinator, moves followers before old leaders and confirms the resulting coordinators. Hidden bonded/stereo partners are not shown as duplicate rooms and remain attached through Sonos' own grouping semantics. Partial failure stops the sequence and the UI refreshes actual topology. Writes are never automatically retried. A two-minute overall command deadline prevents delayed multi-stage writes after the interface has given up; ordinary writes allow eight seconds and favorite source/queue loads up to thirty seconds within that deadline.

Charging requires explicit confirmation, rechecks readiness and reserves a three-minute duplicate guard for the same target before posting. The same configured Flow toggles start/stop, matching the display; a fresh charger read must still show the opposite of the requested target. An opposite command is allowed after the first transition is verified. It tries the Advanced Flow endpoint first; only a definitive HTTP 404 permits the regular-Flow fallback. A timeout, missing response or other failure never authorizes another trigger. The app waits for real charger status and reports if the requested charging state is not confirmed. It does not override your Flow's charging policy.

## Data and freshness

### ESP display parity

The ESP display is the reference for household features, values and interaction semantics. The web app uses the same Montserrat Medium font source as LVGL (bundled locally under `web/public/fonts`, with its SIL Open Font License), dark palette and semantic colors. Its responsive layout adapts the fixed 480×800 display to phones and larger screens. Browser login, HTTPS and touch navigation are web-specific.

| Display behavior | Web implementation |
| --- | --- |
| Shared current price, sunrise/sunset, net/gas/source meters and heating/car/battery status on every page | One shared header above Overview, Energy, Sonos and Climate; the same data feeds all views. |
| Live battery icon and status text | Orange while charging below −25 W, green while discharging above 25 W; standby is muted. The icon and SOC fill are gray for unknown readings. Actual charging is orange for both battery and car. |
| Battery plan graphs, action labels and legends | Orange charging, green discharging, gray holding and yellow sunshine. The measured/forecast SOC line retains its own green percentage scale. |
| Net direction with a 50 W deadband and 10-second mode hold | Same thresholds; the label becomes neutral while a direction change is pending. |
| Gas rate above 0.005 m³/h, otherwise today's total with yesterday underneath | Same stable mode selection, units and secondary values. |
| Solar/battery priority and signed power arcs | Battery takes priority when discharging above 50 W or solar is at/below 50 W; 10-second hold, immediate missing-source removal, ±5 kW per arc half. Negative export/battery charging fills left from the top marker. |
| Green/amber/red price quarters and white current-quarter marker | Same price bands and rolling 12:00–12:00 window, day buttons, source warnings and cheapest three hours. Tomorrow's comparison uses complete all-in day averages with a 0.05 ct threshold. |
| Day/year totals, battery state and charging Flow toggle | Day/year totals remain tappable; completed/waiting/disconnected/fault states match the charger. Both presentation and command readiness treat a charging flag or power above 50 W as charging; missing telemetry stays unknown. Web commands retain explicit confirmation. |
| Gas/Sonos/Climate cards and full Sonos controls | Favorites, physical-room volume, transport, grouping drafts and playback-driven return to Gas follow the display behavior. |
| Nine Evohome zones and thermostat programme | Measured/target temperatures, orange inferred heat demand, green idle status and all six programme modes; control remains through Homey. |
| Weather, rain and energy history | Current/tomorrow/three-hour weather, sunrise/sunset, rain intensity labels and five-minute history gaps; blue import, green export and pink gas history. |

Parity regression tests live in `web/test/display.test.mjs`; the matching ESP reference checks are `scripts/test-energy-state.cpp` and `scripts/test-energy-gauges.py`. Keep these rules synchronized when changing either implementation. Missing yesterday electricity/solar capabilities remain empty; totals are never synthesized from incomplete history.

Homey dashboard updates are pushed to visible browsers through an authenticated
Server-Sent Events connection (`/api/events`). One shared local Homey Socket.IO
connection subscribes only to configured devices and filters Logic events to the
configured price variable. Capability, availability and price changes invalidate
the shared REST cache; bursts are coalesced for one second before reading the
normalized snapshot, with at most three concurrent device reads. Actual latency
also depends on the device reporting to Homey and Homey's read response time.
The official [Homey API client](https://athombv.github.io/node-homey-api/HomeyAPI.html)
keeps the existing local address and token entirely on the server.

A shared 15-second reconciliation remains for missed events, midnight rollover,
older Homeys and tokens without realtime subscription support. Failed initial
Homey subscriptions retry after 30 seconds; established connections reconnect
automatically. SSE also reconnects automatically, and the browser resumes its
15-second REST timer while the stream is disconnected or unsupported. Losing
the stream clears live readings until fresh data arrives. Hidden tabs close their
stream and refresh on return. Signing out closes all streams for that session;
expiry is checked before every snapshot and on each heartbeat. The server stops
its watcher when the last stream closes and limits streams to four per session
and 128 total. Reverse proxies must allow streaming without response buffering
and use an idle timeout longer than the 15-second heartbeat (for example 60 seconds).

Sonos status/discovery retains its 10-second cache and browser polling, rotates
bounded all-room activity reads and never overlaps commands with reads. Weather
has a five-minute cache. History is requested on the Energy page and cached four
minutes, independently of live dashboard updates. Failed reads remove affected
data; no live/demo fallback invents readings. This transport change is web-specific;
the ESP has its own [direct Homey realtime connection](HOMEY-REALTIME.md), retains
read-only polling as fallback, and shares the interpretation of values.

Net grid power is negative for export. Sessy battery power is negative while charging and positive while discharging. Gas rate is already m³/hour. History power is converted from W to kW. Calendar boundaries use Europe/Amsterdam and include 23/25-hour DST days; five-minute gaps remain gaps and line colors split exactly at zero. Future samples and stale tails older than 15 minutes are rejected. Daily summary values are whatever the configured Homey summary devices provide.

The battery card can also read `HOMEY_BATTERY_PLAN_VARIABLE_ID`. It visualizes
the controller's current start/target times and top-up limit, matching the ESP
card. Valid local sunshine forecasts add expected sunshine minutes and the
remaining forecast window to the plan status. A separate yellow row follows the
same time axis: each quarter with predicted sunshine has an opaque yellow mark that grows
taller with its sunshine fraction; zero-sun quarters have a thin grey mark. It covers only the available future forecast, independently of the
green solar-first and blue grid-top-up windows. The EV controls stay beside it
without an outer frame, with a full-column charge/stop button, readiness checks
and status messages available. Stored kWh is an estimate from SoC and configured capacity. Missing/stale
plans never replace live battery measurements. See [the snapshot contract and
installation](SESSY-READY-BY-17.md).

Docker/Coolify also needs `HOMEY_BATTERY_PLAN_VARIABLE_ID` in its runtime
environment; `compose.yaml` forwards this optional setting to the container.

Prices come only from the configured HomeyScript bridge. Each price day must match the Amsterdam date and contain exactly the calendar day's 92, 96 or 100 finite numeric values. Arrays preserve actual UTC quarter order; none are stretched or truncated. The current-quarter marker and period use elapsed UTC time, and transition-day periods/tooltips include the GMT offset. Per-day source and cached status are retained, including tomorrow used as today's matching date after midnight. The server invalidates cache at a date rollover and the browser expires old dates. The visible price window determines min/mean/max and the cheapest consecutive three hours, including elapsed hours.

```text
all_in_ct_per_kWh = (market_EUR_per_kWh × 100 + tax_ct) × (1 + VAT_percent / 100) + fee_ct
```

Defaults: 9.161 ct tax before VAT, 21% VAT and 2 ct supplier fee including VAT. The web app does not independently call price providers.

## Security

`ENERGYDECK_WEB_ACCESS_CODE` keeps its existing name but now requires exactly six
digits. Replace any old long value in `.env` or Coolify runtime variables and
restart/redeploy; long codes are rejected. This is a web-login change; ESP screens
have no equivalent login. The PIN is never embedded in the public app shell.

A PIN of exactly six ASCII digits is required; use the cryptographic generator above. Leading zeroes are preserved. Keep it in `.env` or deployment secrets. It is submitted by same-origin JSON POST, never used as a URL credential. The session is a new random 256-bit token; only its SHA-256 digest is held in memory. Cookies are HttpOnly and SameSite=Strict, with Secure and the `__Host-` prefix by default. JavaScript cannot read them and authentication is never put in localStorage.

Sign-out revokes that session. Expiry is seven days; restart/recreation revokes all sessions. Rotate the code and recreate the container to revoke household access. Login limits are 5/minute per socket address and 20 globally; forwarded addresses cannot bypass them. Controls are limited to 60/minute per session, plus serialized Sonos and charging duplicate guards. At most 256 sessions and 1,024 login-limit entries exist in memory. Proxied phones share a socket limit. Do not scale to multiple replicas without shared session/rate-limit state.

All controls require an authenticated cookie, JSON body and matching Origin. No CORS access is enabled. CSP, no-store, no-referrer and frame blocking limit browser exposure. Static files are explicitly allowed; `.env`, source modules and Homey tokens are not served. Private API responses contain normalized data, not raw Homey devices or favorite metadata. APIs and artwork remain outside the service-worker cache.

Upstream reads have deadlines, response limits and no redirect following. Sonos XML rejects DTD/entity declarations before parsing. Artwork is served only by opaque server-held keys: local Sonos `/getaa` resources or a fixed list of known HTTPS music CDNs, with no redirects, SVG/HTML or caller-supplied URLs. Image response buffers are capped at 6 MB total. The existing eleven station logos are reused locally; no external station art download is needed. Homey authorization is never sent to Sonos, weather providers or artwork hosts.

The Docker build context excludes `.env`, Wi-Fi details, tests and development dependencies. Compose forwards only required settings. The container uses an unprivileged user, read-only filesystem, dropped capabilities, no new privileges, PID limit and 128 MB memory limit, with no Docker socket or writable volumes. The shared household code is not MFA or an individual account system; put an identity-aware proxy in front if needed. Cookie/URL choices follow the [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Development and verification

Use Node.js 22 or newer. From the repository root:

```sh
./run.sh web
# Equivalent: ./web/run.sh
```

The launcher reads the repository `.env` and installs the pinned npm dependencies on first use or after a lock-file change. Configure `ENERGYDECK_WEB_ACCESS_CODE` and your device settings as described above. It works from any working directory. Open the printed URL (normally `http://127.0.0.1:8080`), enter your six-digit PIN and stop with Ctrl+C. Override the port with `ENERGYDECK_WEB_PORT=8081 ./run.sh web`. Running `./run.sh` without `web` still starts the display simulator.

Local mode always binds to `127.0.0.1` and uses HTTP cookies and the matching local Origin, overriding deployment host, HTTPS Origin and Secure-cookie settings in memory. Your `.env` remains unchanged. This launcher is for the computer running it; use the HTTPS Docker/reverse-proxy setup for access from your phone and PWA installation.

Run the automated checks with:

```sh
npm test --prefix web
```

Advanced direct execution (`node --env-file=.env web/server.mjs`) uses `ENERGYDECK_WEB_PORT` (default 8080) and `ENERGYDECK_WEB_HOST` (default `0.0.0.0`) and keeps the configured Origin and Secure-cookie settings. Compose publishes NAS port 65000 by default;
`ENERGYDECK_WEB_BIND_ADDRESS` and `ENERGYDECK_WEB_PUBLISHED_PORT` control that binding.

`ENERGYDECK_WEB_DEMO=true` provides explicitly labelled data, nine climate zones, simulated Sonos controls and fake history/weather without any upstream request. Demo still requires login and is never enabled on failure. Set a demo Flow ID to enable simulated charging. Turn demo off before normal use.

Tests use fake speakers/Homey responses for device commands, including lost write replies, stale group scope, source readiness, queue append/seek, group leadership, XML/SSRF bounds, cookie/origin checks, charge readiness/duplicate suppression, DST/history gaps and price-window calculations. Real installation checks must remain read-only unless the user explicitly requests a device action. Never trigger a real charging Flow merely to test the interface.

The web app is buildless. On a Docker-capable host, verify `docker compose build`, `docker compose up -d` and `docker compose ps` health. Do not share unredacted `docker compose config` output: interpolation can expose secrets.

Regenerate app/favicons with `.venv/bin/python scripts/generate-web-icons.py` (Pillow required), and export the display's embedded station JPEGs with `python3 scripts/export-web-stations.py`. Phone icons use full-bleed backgrounds so each OS can apply its own mask. Station logos identify their respective broadcasters, which retain ownership.

## Battery color deployment (2026-10-30)

The production Coolify webhook deployment of `57ce8a2` succeeded. Live `app.js`,
`display.js`, `styles.css` and `sw.js` matched the committed files byte for byte,
including shell cache `energydeck-shell-v51`. The health endpoint returned
HTTP 200 and an unauthenticated session request correctly returned HTTP 401.
Both physical displays received the matching firmware; see the
[verified rollout](SMART_HEADER.md#battery-color-rollout-to-both-displays-and-web-2026-10-30).
Synthetic web previews verified the orange charging and green discharging
icon/status text; authenticated production rendering was not inspected.

The later graph/legend follow-up `ad21968` prepares shell v52 with the same
orange/green palette for planned areas, power bars, legend labels and action
text. All 111 web tests and synthetic overview/detail browser checks passed.
The user handles web publication and deployment; this follow-up is prepared
locally and was not deployed by the agent. See `AGENTS.md` for this working
agreement and the display rollout notes for the matching installed firmware.
