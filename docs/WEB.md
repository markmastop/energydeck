# Mobile web dashboard

EnergyDeck includes an independent, responsive dashboard for phones, tablets and desktop browsers. It runs in one Node.js container with no npm dependencies, database or frontend build step. The ESPHome display and simulator continue to work independently.

The first web version shows live grid/solar power, daily electricity/solar/gas totals, Sessy battery state, EV connection/charging status, Evohome zone temperatures, and today/tomorrow quarter-hour prices. It supports Dutch and English. It is read-only: there are no Flow triggers, charger controls or thermostat writes. Sonos, weather and Insights history are not included in this version.

## Start on a trusted home network

1. Install Docker Engine with Docker Compose on your NAS or home server, and clone this repository there.
2. Copy `.env.example` to `.env` if you do not already have one. Fill in the existing `HOMEY_ADDRESS`, `HOMEY_TOKEN` and device/price-variable IDs as described in the main README. Existing display configuration can be reused. The Homey token needs device and Logic read permissions; this app does not need Flow-start permission.
3. Generate a unique random access code:

   ```sh
   openssl rand -hex 32
   ```

4. Add the result and the following settings to `.env`:

   ```dotenv
   ENERGYDECK_WEB_ACCESS_CODE=replace-with-the-generated-code
   ENERGYDECK_WEB_BIND_ADDRESS=0.0.0.0
   ENERGYDECK_WEB_PORT=8080
   ENERGYDECK_WEB_SECURE_COOKIE=false
   ENERGYDECK_WEB_DEMO=false
   ```

   HTTP does not encrypt the access code or session. Use this configuration only on a trusted LAN, preferably with a firewall limiting access to that LAN. Keep the port closed on your router. For HTTPS, use the configuration below.

5. Start the container from the repository root:

   ```sh
   docker compose up -d --build
   ```

6. Open `http://YOUR-SERVER-IP:8080` on your phone and enter the access code. Do not append the code to the URL. Your phone stays signed in for seven days unless you sign out or restart the container.

To update, pull the repository and run `docker compose up -d --build` again. After changing `.env`, run the same command to recreate the container. `docker compose restart` alone does not apply changed environment variables. Run `docker compose down` to stop it.

The secure defaults in `.env.example` and Compose bind only to `127.0.0.1` and require Secure cookies. They deliberately require the LAN opt-in above or an HTTPS proxy before phone sign-in works. Inside the container the app always listens on port 8080; `ENERGYDECK_WEB_PORT` changes the published host port.

## HTTPS and access from outside the home

Prefer access through a private VPN or a trusted HTTPS reverse proxy. A proxy must be able to reach the container's HTTP port and preserve the external Host header. Set the exact browser-facing origin, including its port if nonstandard:

```dotenv
ENERGYDECK_WEB_ACCESS_CODE=your-generated-code
ENERGYDECK_WEB_BIND_ADDRESS=127.0.0.1
ENERGYDECK_WEB_SECURE_COOKIE=true
ENERGYDECK_WEB_ORIGIN=https://energydeck.example.com
```

This loopback binding works for a proxy on the Docker host. A proxy in another container needs a shared private Docker network or another explicitly reachable binding; `127.0.0.1` inside the proxy container points to the proxy itself. Do not publish the plain HTTP upstream publicly. The browser uses HTTPS, while the private proxy-to-app hop can use HTTP. The app does not trust forwarded headers; `ENERGYDECK_WEB_ORIGIN` is the authority for sign-in/sign-out origin validation.

You can add the app to your phone's home screen using the browser menu. Manifest support is included; installation availability depends on the browser and HTTPS. No service worker caches private data, and there is no offline dashboard.

The energy-dial/bolt logo includes an SVG favicon, a multi-size ICO fallback, a 180 px Apple touch icon, and 192/512 px maskable app icons. Regenerate these assets with `.venv/bin/python scripts/generate-web-icons.py` (Pillow required). Phone icons use a full background so the operating system can apply its own corner shape.

## Authentication design

- A shared, random code of at least 32 characters is required at startup. Generate 32 random bytes as 64 hexadecimal characters using the command above. Keep it in `.env` or your deployment's environment, never in Git.
- The code is submitted in a same-origin JSON POST. Codes in query strings are not authentication. URLs can leak through browser history, copied links, server logs and referrers.
- A successful sign-in generates a new random 256-bit session. Only its SHA-256 digest is kept in server memory. The browser receives an HttpOnly, SameSite=Strict cookie, with Secure and the `__Host-` prefix enabled by default. JavaScript cannot read that cookie; authentication is never stored in localStorage.
- Sessions expire after seven days. Sign-out revokes that session immediately. Restarting/recreating the container revokes all sessions. Change the access code and recreate the container to revoke access for everyone.
- Sign-in is limited to 10 attempts per minute per socket address and 60 globally. X-Forwarded-For cannot bypass these limits. Phones behind the same proxy share the per-address limit. There are at most 256 active sessions and 1,024 rate-limit entries. All state is local to one process; do not scale replicas without adding shared session/rate-limit storage.
- Mutating authentication requests require a matching Origin; cross-site fetches are rejected. No CORS access is enabled. CSP, frame blocking, no-referrer and no-store headers limit browser exposure.
- Only an explicit list of static files is served. `.env`, source files and Homey credentials cannot be retrieved through the web server. API responses contain normalized readings, not raw Homey device objects or tokens.
- Homey requests never follow redirects, use a timeout and a response-size limit, and are always GET requests. The Docker build context contains only web sources and public assets. Compose passes only needed settings, excluding Wi-Fi credentials and Flow IDs.
- The container runs as the unprivileged `node` user with a read-only filesystem, no Linux capabilities, no new privileges, a PID limit and a 128 MB memory limit. It needs no host network, Docker socket or writable volume.

This follows the cookie and URL guidance in the [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). A shared household code is not a multi-user account system or MFA; use a private network/VPN or an additional identity-aware proxy if that is needed.

## Data behavior

The browser refreshes every 15 seconds while visible, and refreshes immediately when reopened. All phones share a 15-second server cache and a single in-flight refresh; at most three Homey requests run concurrently. No polling happens when nobody requests the dashboard. A failed device fetch clears its readings instead of retaining stale values. A disconnected browser hides live readings and retries automatically. Missing capabilities appear as a dash, never as zero.

The backend reads the same configured Homey device IDs as the display. Climate accepts only `homey:app:com.honeywell:zone` devices, with the same temperature bounds. Negative net power means grid export. Sessy battery power is negative while charging and positive while discharging. Daily totals come from the configured summary devices.

Prices come from `HOMEY_PRICES_VARIABLE_ID`, populated by `homeyscript/energydeck-prices.js`. The web app does not independently call external price providers. It preserves the bridge's per-day source and cached-day indicators and warns for reserve, cached or unknown sources. A valid day must match the Amsterdam calendar date and contain exactly 96 finite numeric quarter-hour values. Incomplete 92/100-quarter arrays are not stretched into 96. Yesterday's stored tomorrow can become today's matching date. A day rollover invalidates the shared cache even within its 15-second lifetime.

All-in prices in ct/kWh use the same calculation and defaults as the display:

```text
(market_EUR_per_kWh × 100 + tax_ct) × (1 + VAT_percent / 100) + fee_ct
```

Defaults are tax 9.161 ct before VAT, VAT 21%, and supplier fee 2 ct including VAT. Existing `ENERGYDECK_ENERGY_TAX_EX_VAT_CT`, `ENERGYDECK_VAT_PERCENT` and `ENERGYDECK_SUPPLIER_FEE_INCL_VAT_CT` override them; blank values retain defaults. Negative all-in prices are supported. The chart shows the selected calendar day; the cheapest three-hour block is calculated over that entire day, including elapsed hours for today. It does not use the display's rolling 24-hour chart window.

## Local development and demo

Node.js 22 or newer is required. From the repository root, reuse your `.env` without installing packages:

```sh
node --env-file=.env web/server.mjs
```

Direct Node execution listens on `0.0.0.0` by default. Use `ENERGYDECK_WEB_HOST=127.0.0.1` in `.env` to restrict development to localhost. This setting affects direct Node execution; Compose controls host publication with `ENERGYDECK_WEB_BIND_ADDRESS` instead.

Set `ENERGYDECK_WEB_DEMO=true` for explicitly labelled example data. Demo mode still requires sign-in and never calls Homey. It is never enabled as a fallback when live data fails. Turn it off before normal use.

```sh
npm test --prefix web
node --check web/public/app.js
```

Tests exercise session authentication/revocation/expiry, origin validation, login throttling, private routes, input bounds, security headers, data mapping, failure invalidation, cache sharing, request concurrency, date rollover, price calculations and translation keys. Integration tests open temporary localhost ports and use fake Homey responses; they never trigger real charging Flows.

The web UI is buildless: the container serves its HTML/CSS/JS files directly. Validate the Docker image on a Docker-capable host with `docker compose build` and `docker compose up -d`, then check `docker compose ps` for health. Do not print or share `docker compose config` output without redacting it: interpolation can expose environment secrets.
