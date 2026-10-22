# Public PWA screenshots

These JPEGs are real browser screenshots of the EnergyDeck PWA at a 430×1100 CSS-pixel viewport, in Dutch. Overview is captured at the top; Energy, Sonos and Climate are scrolled to their main content. Charging and Weather show the lower Overview cards. The charging button was exercised only in demo mode to show a simulated 7.3 kW session. No interface elements or data were edited for the captures.

All readings, room names, playback state and history come from the built-in demo. The screenshot server does not load `.env` and is isolated from the real Homey and Sonos configuration. Station logos are the existing bundled assets and belong to their broadcasters.

To refresh the screenshots, install the web dependencies if needed and start a separate demo server from the repository root:

```sh
npm ci --prefix web --ignore-scripts
ENERGYDECK_WEB_DEMO=true \
ENERGYDECK_WEB_HOST=127.0.0.1 \
ENERGYDECK_WEB_PORT=8084 \
ENERGYDECK_WEB_SECURE_COOKIE=false \
ENERGYDECK_WEB_ORIGIN=http://127.0.0.1:8084 \
ENERGYDECK_WEB_ACCESS_CODE=public-readme-demo-only-code-1234567890 \
HOMEY_CHARGE_FLOW_ID=demo \
node web/server.mjs
```

Open `http://127.0.0.1:8084`, sign in with the disposable demo code above, choose Dutch and set a mobile viewport. Save one JPEG for each page and the lower Overview cards using the filenames in this directory. For the charging image, start the simulated session with the button and demo confirmation dialog. Confirm that demo mode is active before capturing and stop the server afterward. Never use the live server, a real access code or real household data for public documentation captures.
