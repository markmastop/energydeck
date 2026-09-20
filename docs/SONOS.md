# Sonos: dedicated local player and favorites

The dashboard's right-hand **Sonos** button shows the compact player in the
Gas/Climate card position, with the active tab highlighted green. Its **Detail**
button, replacing the former Radio button, opens the
full-screen player. The **back arrow** returns to the compact Sonos card. Playback
changes never navigate between pages. Opening either view or changing the
displayed room never starts music or a Homey Flow.

Both players share room selection, current title/artist, volume, waiting/error
state and playback controls. The compact cover scales the same decoded image to
62×62 pixels without another network request; the full page uses a 272px cover.

The compact live energy header stays at the top on both pages. Sonos starts at
y=154, the top edge of the dashboard's Today/Tomorrow tabs. The same header widgets
are moved between pages, so clock, price and gauges retain their normal updates.
On Sonos Detail the gauges show current grid power (left), battery percentage,
power and charging/discharging status (middle), and solar power/yield (right).
The battery arc copies the main battery bar's low/medium/high charge colors;
its status/power copy the charging/discharging/standby text colors. Unavailable
battery data shows dashes. Returning restores the original daily-energy gauge;
solar stays on the right on both pages. This is display-only, with no extra polling.

The page has a 272×272 cover, ellipsized title/artist, room selector, playback,
skip, volume and mute controls, plus a scrollable two-column favorites grid.
The cover fills a rounded square with an aspect-preserving center crop. Playback
and volume controls sit in a slim column to its right, with only Play/Pause filled.
Title and artist sit below the cover. The back arrow and Sonos heading form a
single navigation row, with the group name underneath as borderless text. Unavailable
controls use muted icons rather than grey rectangles. A combined group is a read-only heading;
separate room names retain their selection arrow. Favorites show a small type
icon and up to two title lines, with six tiles visible before scrolling. Missing
font glyphs are omitted from display only; playback metadata remains untouched.
Favorites come directly from Sonos; no Homey Flow is involved. This also means
starting a favorite does not switch power outlets, regroup speakers or set a
starting volume. It uses the selected room's current group and volume.

## Why not read playback metadata from Homey?

A simultaneous read on 2026-09-20 found that Homey's cloud Sonos devices still
reported John Mayer — Slow Dancing in a Burning Room, last updated 27 minutes
earlier, while the local group coordinator reported Eric Clapton — Wonderful
Tonight. More frequent Homey reads cannot repair that stale source.

EnergyDeck now polls Sonos locally every **10 seconds** (formerly Homey every
30 seconds). It reads ZoneGroupTopology first, then transport state, media source
and track metadata/actions from each distinct coordinator, and volume/mute from each room.
Requests are sequential with an 80 ms yield for the UI. A slow cycle is not
overlapped. Failed/truncated replies show offline/missing data instead of silently
falling back to stale Homey titles.

This uses the speakers' local UPnP/SOAP interface, not the Sonos cloud Control API
or its OAuth credentials. It was checked against the service descriptions exposed
by these speakers. Local firmware compatibility must be retested after major
Sonos updates.

## Rooms, groups and TV

- Woonkamer and Keuken in the same group: one **Woonkamer + Keuken** card.
  Metadata follows the actual coordinator, not a fixed preferred speaker.
- Separate rooms: show the playing room; music takes priority over TV when both
  are playing. If both play music, retain the current room.
- Tap the room heading (with **>**) to switch rooms manually. That choice remains
  while the selected room is playing; stopping or regrouping restores automatic
  selection.
- TV is detected from the coordinator's `x-sonos-htastream:` source. Show **TV**
  and clear old song/artist/artwork. TV volume remains available; Pause/Play is
  disabled because the TV controls its source.
- Starting/stopping playback does not change the current page. Dashboard Gas and
  Climate remain available regardless of playback.

Pause/Play goes directly to the selected room's coordinator. Minus/plus adjust
the displayed room by two percentage points, clamped to 0–100. For the combined
Woonkamer/Keuken group, both configured rooms are adjusted, preserving their
volume offset except at the bounds. Other household rooms are not volume targets.
Mute toggles both configured rooms when grouped, or just the selected room when
separate. Previous/Next are enabled only when Sonos reports the action available.
Playback controls and favorite selection inherently affect the coordinator's
actual group, so avoid adding unrelated rooms if they should remain unaffected.

Commands are only created after a user click. The displayed target is captured,
fresh topology/volume is read, and a changed group scope cancels the command.
Controls are disabled during requests and unavailable data; read-back verifies
the result. There is no automatic command retry.

## Sonos favorites

ContentDirectory `Browse` reads `FV:2` in pages of eight when the page opens
and every five minutes while open. There is no section heading or manual refresh
button; the favorite tiles follow the player directly. A complete, consistent
UpdateID is required; unavailable or malformed data disables favorites rather
than silently using an outdated list. Collection and payload sizes are bounded.
Entries without playable URI/metadata (such as pinned discovery shortcuts) are
omitted. Tiles show title and a radio/music icon, not remote thumbnail downloads.

- Radio: set the favorite URI with its original metadata, then Play.
- Playlist/album/track: append to the existing queue, select that queue, seek to
  the first newly added track, then Play. The old queue is never cleared.
- A failed command stops the remaining sequence. There is no automatic retry.
- Waiting appears immediately; fresh playback URI (and queue track when relevant)
  must confirm the selection within 30 seconds. Existing unrelated playback is
  not sufficient confirmation. A timeout reports an unconfirmed action, not proof
  that the speaker did nothing; check before retrying to avoid duplicate entries.

The original Sonos favorite metadata is preserved and XML-escaped when sent.
No music-service credentials are stored on the deck. Availability still depends
on the associated music service and the speaker's local API support.

## Network and artwork

The current bootstrap addresses in `esphome/packages/music.yaml` are:

- Woonkamer: `http://192.168.0.190:1400`
- Keuken: `http://192.168.0.191:1400`

Reserve these IPs in the router's DHCP settings. Either reachable speaker's
topology resolves both configured player UUIDs and their current coordinator,
including coordinator changes. This version does not run multicast discovery
on the deck; if both bootstrap IPs change, update the substitutions. The deck
must be allowed to reach the speakers on TCP port 1400 (no client isolation).

No Sonos request carries the Homey bearer token. Topology endpoints are restricted
to private IPv4 addresses on port 1400. Artwork must be a relative path on the
coordinator, an absolute URL with that same origin, or HTTPS on the Sonos radio
image proxies `sali.sonos.superhi.fi` and `sali.sonos.radio`. Other external hosts
are rejected. Automatic redirects remain disabled on the shared client. Artwork
alone may follow exactly one HTTPS redirect from either Sonos proxy to
`cdn-profiles.tunein.com`, without forwarding any request headers. Other hosts,
HTTP downgrades and further redirects are rejected; Homey credentials are never
sent with the redirected request.

JPEG and PNG covers are decoded at up to 272×272 pixels, above ellipsized title
and artist. Track artwork takes precedence over the station artwork from
`CurrentURIMetaData`. Radio stream titles use the station name as their subtitle,
never the technical stream URL. The compact grouped-room label is transparent.
Both cover widgets detach before decoding, and the LVGL image cache and descriptor
dimensions are refreshed before displaying a newly decoded buffer.
New cover downloads only start while either Sonos view is selected.
Cover changes include URL, title, artist and a one-minute refresh bucket. Failed
downloads retry on the next poll; late results cannot reveal the wrong cover
after a room/source change. Missing/unsupported artwork uses the music-note
fallback. TV never displays an old music cover.

The vendored online_image component still handles complete chunked JPEG downloads
on ESP-IDF with bounded size/time; see its README.

## Validation

Run `node scripts/test-music-controls.cjs` for the actual C++ model's offline
tests: XML/entity handling, malformed replies, URL restrictions, coordinator
changes, separate/grouped rooms, TV/music priority, manual selection, missing
speakers, command scope changes, volume bounds and command confirmation. Favorites
tests cover pagination, invalid/stale pages, filtering, radio, queue append/seek,
failure aborts, mute, skip and read-back confirmation.

Run `node scripts/test-chunked-cover.cjs` for the JPEG download regression tests.
Run `node scripts/test-cover-formats.cjs` for PNG/JPEG selection, PNG completion,
decoder initialization failures and shared-widget lifecycle safeguards.

The C++ test's `--probe` mode emits only Get* requests for a read-only live
comparison; `--favorites-probe` emits only Browse requests. Automated/live diagnostic
checks must not start favorites, modify queues, change groups, pause music or
change volume. Compile the simulator and physical
firmware separately; upload to the deck only when explicitly requested.

2026-09-20 dedicated-page validation: all regression scripts and the native
simulator/ESP32 builds passed. A read-only live favorites probe decoded 13 playable
favorites, excluding three non-playable discovery entries. A regression check
also verifies that the shared header moves to both pages and Sonos starts at
the energy tabs' y=154 position. The automation tool could not reliably inspect
the final SDL preview; visual layout verification remains manual. The preview
was restricted to Sonos TCP port 1400, blocking unrelated weather/Homey requests.
No live playback, queue, mute, volume or grouping changes were used for testing;
command behavior was verified with synthetic replies. No firmware upload was
performed.
