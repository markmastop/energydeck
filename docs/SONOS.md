# Sonos: dedicated local player and favorites

Both the compact Sonos card and the detail page return to the home dashboard's
Gas card when previously playing music pauses/stops in all rooms. Detail stays
open during transitions, unavailable/incomplete status and pending commands or
room selections. Opening detail while already idle keeps it open for favorites
and controls. The back arrow returns to the compact Sonos card.

2026-10-13 navigation validation: the production navigation lambda passed
synthetic stop/pause, idle reopening, manual Climate selection, unknown and
transitioning activity, other-room playback and pending-operation regressions.
The simulator build and production LVGL room-widget/input checks passed. The
SDL executable started, but its native window was not exposed to UI automation,
so visual navigation and physical behavior remain unverified. No firmware was
uploaded and no playback/grouping/volume or charging commands were issued.

The dashboard's right-hand **Sonos** button opens the full player directly,
including while idle, offline or waiting for a command. Tapping the compact
player's cover or track text also opens detail through one shared touch target.
The compact player uses a larger 92px cover on the left, with the room selector,
a two-line track title, artist/status and volume aligned in one column beside it.
The cover's left edge aligns with the volume-down button below it.
Long room/group names and titles are ellipsized within fixed two-line boxes;
waiting, pause and error text replace the artist row. The room selector opens
Rooms. Empty artist rows and unused title lines collapse. The volume label shows
Group and the lowest visible member volume, or Room and the selected room volume
while the Rooms tab is open. The selector
keeps its own touch target above the shared cover/track target. The
cover is clipped to its rounded frame; idle favorites retain their full-width
room heading. Playback controls remain in the full-width bottom row. The separate
Detail button is removed; compact minus/plus controls now occupy 62 px each and
Play/Pause occupies 122 px, with 8 px gaps. The **back arrow** returns to the
compact Sonos card in the Gas/Climate card position, with Sonos highlighted green. Starting
playback never opens detail automatically. The compact dashboard card switches to
Sonos when playback starts (including playback detected at boot), and back to
Gas when playback stops or pauses while that card is selected. Manual Gas/Climate
selections remain usable until the next playback start. Unknown or transitioning
states do not count as stopped. Opening either view or changing the
displayed room never starts music or a Homey Flow.

Both players share room selection, current title/artist, volume, waiting/error
state and playback controls. The compact cover scales the same decoded image to
92×92 pixels without another network request; the full page uses a 272px cover.

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
skip, volume and mute controls. A read-only **Up next** line shows the next
queued title and artist when Sonos exposes a deterministic order. Below the
player, **Queue / Rooms / Favorites** tabs switch between the queue, system list
and three-column favorites grid. Queue opens by default; its badge counts the
complete queue, including tracks already played. The current track is highlighted.
Room membership uses the existing per-row plus/check controls. Apply and Cancel
appear below the room list only while a grouping draft exists; all three tabs
remain available in their fixed positions.
The selected tab is retained when leaving and reopening detail. Rooms shows up
to 32 visible Sonos zones from the existing topology response, with their actual
zone names and group membership. Hidden bonded/stereo partners are omitted to
avoid duplicate rooms. Playback status is shown when the zone belongs to a
polled coordinator. The visible inventory is published as soon as the discovery
reply arrives; it no longer waits for playback, volume or all-room activity reads.
Matching cached player snapshots remain usable, while changed/removed zones
immediately lose their stale control state. Other visible groups receive one
lightweight, read-only
GetTransportInfo request per coordinator. Rooms are ordered with confirmed
playing groups first, then alphabetically within both playing and other rooms
(case-insensitive ASCII names; UUID breaks ties). Unknown activity shows Detected
and never counts as playing. These display-only reads have a 1-second deadline,
stop when a command needs the worker, and start no new reads after a 4-second scan
budget (an in-flight read can add up to one second). Scan
starting points rotate so slow/offline groups cannot permanently starve later
rooms. The normal ten-second status polling frequency is unchanged.
Unavailable topology replaces the list with an unavailable message. The left
part of each row selects that room for the shared player; its green outline
marks the selection. Selection only reads status and persists when paused or
offline. The right part edits membership of a group around that room: **Main**
marks the anchor, a checkmark means included, and plus means excluded. The anchor
cannot be unchecked. Draft subtitles describe joins and removals. **Apply** sends
the grouping commands; the cross cancels the draft. Neither selection nor draft
editing sends playback or grouping commands.

Grouping re-reads topology before any write. External regrouping, a missing room,
unsafe/incomplete discovery or the 32-zone cap disables Apply and cancels unsafe
writes. A stale draft remains visible until cancelled. The selected room becomes
the coordinator; checked rooms join its source and unchecked members of its old
group detach. Coordinator promotion uses DelegateGroupCoordinationTo with
RejoinGroup=1 and ClearSource=0 to preserve the source. When another selected
coordinator has unchecked followers, leadership transfers to one of those
followers first; those rooms retain their group. Other selected followers move
before their old coordinator. Hidden bonded/stereo partners stay with their
visible zone. Grouping does not change volume/mute, restart playback or edit
queues. Each write is sent once; partial failure stops the sequence and reads
back actual topology. Success requires the expected coordinators for every
visible zone, with up to three read-only confirmation cycles.

Dashboard idle favorites stay available
regardless of the selected detail tab, and hidden detail favorites do not start
new artwork downloads. Tab switching never sends playback or grouping commands.
The cover fills a rounded square with an aspect-preserving center crop. Playback
and volume controls sit in a slim column to its right, with only Play/Pause filled.
Title and artist sit below the cover. The back arrow and Sonos heading form a
single navigation row, with the group name underneath as borderless text. Unavailable
controls use muted icons rather than grey rectangles. Tapping the room/group
heading opens the Rooms tab in either player. Single-room headings show only
the room name, without a trailing `>`; the name remains clickable.
Both ESP player headings and the web Sonos header show all visible rooms in the
selected room's actual group, including after explicit selection or external
regrouping. They use discovered names and omit hidden bonded partners. A room
selection scopes mute to that physical room. Player volume controls the actual
group; on the Rooms tab, volume controls only the selected physical room.
Unapplied grouping drafts do not change the heading.
Favorites show a small type
icon and up to two title lines, with six tiles visible before scrolling. Missing
font glyphs are omitted from display only; playback metadata remains untouched.
Favorites come directly from Sonos; no Homey Flow is involved. When the dashboard
Sonos card is selected and neither room is playing, it shows the same favorites
in a scrollable five-column icon grid (ten visible tiles). The room label uses the
full card width while favorites are shown.
Compact tiles keep a 44×44 px touch target around the 32×32 artwork or fallback
icon, with 10 px horizontal and 4 px vertical gaps. Names remain visible in Detail.
Favorites always play on the displayed room's current coordinator and existing
group, including before any explicit room choice. They preserve volume, mute and
membership; they never automatically group Woonkamer and Keuken, detach speakers,
or set a startup volume. Joining or removing rooms requires an explicit group
edit. Fresh topology must still match the displayed scope before playback; an
unavailable coordinator disables favorites rather than regrouping speakers.
The favorite path uses one fresh preflight and sends only its playback/queue
commands, without the former setup writes, one-second setup delay or second
preflight. A failed command stops the sequence and never retries queue insertion.
No power outlets are switched. This applies to favorites in both views.

## Why not read playback metadata from Homey?

A simultaneous read on 2026-09-20 found that Homey's cloud Sonos devices still
reported John Mayer — Slow Dancing in a Burning Room, last updated 27 minutes
earlier, while the local group coordinator reported Eric Clapton — Wonderful
Tonight. More frequent Homey reads cannot repair that stale source.

EnergyDeck now polls Sonos locally every **10 seconds** (formerly Homey every
30 seconds). It reads ZoneGroupTopology first, then transport state, media source
and track metadata/actions from each distinct polled coordinator, and volume/mute
from each polled room. The two default rooms remain polled; selecting another
zone adds that room and its coordinator. Volume is also read from every visible
member of the selected room's actual group; unrelated rooms do not receive extra
volume reads. The selected zone also acts as a fallback discovery seed when the
two defaults are unavailable.
Requests are sequential on the background worker with a 10 ms UI yield. A slow
cycle is not overlapped. Each failed read gets at most one retry for a network
error, HTTP
408/429/500/502/503/504 or a malformed/truncated HTTP 200 reply, before publishing
the new snapshot. SOAP faults and permanent HTTP errors are not retried. A retry
uses the same UI yield and 1.5-second read deadline; persistently unreachable
speakers can therefore extend a cycle. Exhausted retries still show
offline/missing data rather than keeping stale titles. Writes are never retried
because a missing response does not prove the speaker ignored the command.

This uses the speakers' local UPnP/SOAP interface, not the Sonos cloud Control API
or its OAuth credentials. It was checked against the service descriptions exposed
by these speakers. Local firmware compatibility must be retested after major
Sonos updates.

## Rooms, groups and TV

- Woonkamer and Keuken in the same group: one **Woonkamer + Keuken** card.
  Metadata follows the actual coordinator, not a fixed preferred speaker.
- Separate rooms: show the playing room; music takes priority over TV when both
  are playing. If both play music, retain the current room.
- Tap the room heading to open Rooms, then tap the desired room. An explicit
  choice in the full Sonos page persists across pause, regrouping and offline
  recovery. Editing group membership also pins the displayed anchor, even
  without first tapping its row.
- Room choice updates the heading, selection highlight and cached information
  immediately, without a busy lock, a full system poll or waiting in the click
  handler. A previously unseen room shows **Updating...** until its first
  snapshot arrives; navigation and further room choices stay available.
  One coalesced flag requests the latest chosen room's six background reads
  plus the other group members' volume readings.
  Only the already-sent request is drained safely; the rest of an older status
  queue (including retries) is abandoned before fetching the latest choice.
  Priority is checked again after waiting for another worker owner. Partial
  abandoned polls never erase unrelated cached player snapshots. The chosen
  room's transport/media/position publish its title and status before optional
  action, volume and mute reads finish. Selected-only refreshes skip all-room
  activity; full refreshes render the player before that scan. Rapid choices
  skip targets that have not started, and late snapshots remain keyed by UUID.
  A selected grouped follower supplies the fresh shared metadata, rather than
  being overwritten by an older cached member of the same group.
  Cached rooms are bounded by the current visible inventory, discarded on
  discovery loss/removal, and invalidated by host/coordinator/membership changes.
  Old artwork is hidden immediately; the click handler opens no HTTP connection.
- On the dashboard, the compact player follows playback in every discovered
  room, including rooms outside Woonkamer/Keuken. Keep the displayed room while
  it plays; otherwise choose the first playing room in the Rooms list's
  case-insensitive alphabetical order. A new target gets six read-only requests
  for transport, metadata, actions, volume and mute plus one volume read for each
  other visible group member, using the just-discovered topology. Already-polled
  default rooms reuse their snapshot. No second full
  poll, extra timer, playback command or grouping change is needed.
- Automatic following pauses while the full Sonos page is open or a control or
  favorite is in flight. Automatic room selection uses the same group-volume,
  room/pair mute and
  coordinator-based transport/favorites scope as a clicked room.
  All-room activity participates in compact playback edges; unknown,
  transitioning or incompletely discovered rooms never prove that all playback
  stopped. Detection uses the existing ten-second poll and bounded activity scan.
- TV is detected from the coordinator's `x-sonos-htastream:` source. Show **TV**
  and clear old song/artist/artwork. TV volume remains available; Pause/Play is
  disabled because the TV controls its source.
- Starting or stopping playback does not change the current page. Dashboard Gas
  and Climate remain manually available.

Pause/Play goes directly to the selected room's coordinator. Player minus/plus
reads every visible member of its actual group and sets them all to the lowest
volume minus/plus two percentage points, clamped to 0–100. For example, 10%/20%
becomes 8%/8% with minus or 12%/12% with plus. Thus the first plus can lower the
louder rooms. Equal percentages do not imply equal perceived loudness.
Explicit room selection does not narrow player volume scope. On the **Rooms** tab,
the same minus/plus controls target only the selected room, labelled Room.
Grouping drafts never determine volume targets. All group volumes must be valid
before any write; a failed/uncertain write stops the sequence without retries or
rollback. Both implementations read back every group member to confirm the result. Mute keeps
its existing default-pair/explicit-room behavior. Transport and favorites follow
the actual coordinator, so they affect its current group.
Previous/Next are enabled only when Sonos reports the action available.
Playback controls and favorite selection inherently affect the coordinator's
actual group, so avoid adding unrelated rooms if they should remain unaffected.

Commands are only created after a user click. For ordinary playback controls, the displayed target is captured,
fresh topology/volume is read, and a changed group scope cancels the command.
Controls are disabled while a command is being checked/sent and for unavailable
data. Once Sonos acknowledges an ordinary playback/mute/skip or room-volume command,
controls are released immediately. Group-volume commands also verify every
member with a volume read before releasing controls. A background poll starts
without waiting for
its result; subsequent status snapshots confirm the latest command. An
unconfirmed action is reported after 15 seconds as observed by a completed poll.
There is no fixed two-second post-command delay and no automatic write retry.
Fresh room/scope checks before writes and the existing stricter favorites and
grouping confirmation safeguards remain in place. With concurrent room choice,
commands first drain any earlier display poll and then start their own fresh
topology/volume preflight; a cached snapshot alone never authorizes a write.

SOAP requests, including favorites Browse, run on one sleeping background worker
with a single request/reply mailbox. Only the owning script consumes a reply.
The worker never reads/modifies Sonos models, LVGL widgets, the ESPHome scheduler
or the shared Homey client. Models and UI updates stay on the main thread.
Replies are limited to 64 KiB; status reads and favorites Browse pages have a
1.5-second deadline. Writes use eight seconds, with 30 seconds for favorite source
loading/enqueue. Browse pages wait
until pending room choices and their snapshots have finished. The firmware
shares one deadline across
connect/send/read, rejects incomplete/oversize bodies, follows no redirects and
sends no credentials. The simulator uses separate socket timeouts and rejects
results arriving past its deadline. The inter-request UI yield is 10 ms rather
than 80 ms; network waiting no longer blocks touch.

Room widgets are reused when status, selection, names or draft membership change;
only changed rows update. Inventory or presentation-order changes rebuild the
rows together with their UUID callbacks and restore scroll position.
Room buttons disable LVGL's default scroll-on-focus behavior: touching a partly
visible row must not start a competing scroll-to-view animation before a drag.
Room selection and membership changes still require an actual click.
Periodic Sonos style/layout updates are deferred while the room or favorite list
is scrolling. New cover connections are also deferred throughout the Rooms tab,
so optional artwork does not compete with room discovery and controls. The cover
refresh resumes when Favorites is selected or the compact card is shown. The
GT911 touch interval is 20 ms rather
than the default 50 ms. Homey HTTP and artwork download/decode also run on a
separate background worker.
All reply publication waits for touch/momentum and a 150 ms quiet window across
all pages; ESP32 workers run below the foreground task priority on core 0.
See [application-wide UI priority](PERFORMANCE.md#ui-first-background-work).

## Sonos favorites

ContentDirectory `Browse` reads `FV:2` in pages of eight when the page opens on
Favorites, when Favorites is selected, when the compact Sonos card first needs
the list, and every five minutes while either Sonos view is selected. Opening
Rooms skips a new favorites refresh so discovery/room reads get the worker
first. There is no section heading or manual refresh
button; the favorite tiles follow the player directly. A complete, consistent
UpdateID is required; unavailable or malformed data disables favorites rather
than silently using an outdated list. Collection and payload sizes are bounded.
Entries without playable URI/metadata (such as pinned discovery shortcuts) are
omitted. Tiles show title and a radio/music icon, not remote thumbnail downloads.

- First verify fresh status and the displayed room/group scope without changing membership, volume or mute.
- Radio: set the favorite URI with its original metadata, verify that the new
  source is visible and the transport has settled, then Play.
  For `x-sonosapi-stream`, source matching accepts percent-escape case changes
  and the observed `flags` bit `0x40` normalization. The station, service/account,
  all other flags and parameters must still match. Other URI schemes retain exact
  matching. The same rule applies to final playback confirmation.
  If fresh preflight already sees that radio without an error or transition,
  recheck its readiness and Play without issuing another SetURI.
- Playlist/album/track: append to the existing queue, select that queue, verify
  source/transport readiness, seek to the first newly added track, verify its
  position, then Play. The old queue is never cleared.
- Readiness checks yield 200 ms between requests and repeat only reads, up to ten
  attempts per stage. A missing source, transition, old queue position, invalid
  response or failed readiness check cannot advance to the next write.
- A failed command stops the remaining sequence. Each write is sent at most once.
  A fresh playback read may confirm an applied command despite a lost response;
  there is no automatic write retry or duplicate enqueue.
- Favorite source selection and enqueue have a 30-second worker deadline for
  service-backed loading; other writes keep eight seconds and reads 1.5 seconds.
  A longer network wait does not block input, rendering or the foreground loop.
- Waiting appears immediately; fresh playback URI (and a track inside the newly
  added range for a playlist) confirms the selection. Advancing to the next added
  track does not falsely leave a successfully started playlist unconfirmed.
  After 30 seconds, one final fresh status cycle runs before declaring playback
  unconfirmed, including when touch deferred earlier reply publication. Existing
  unrelated playback is insufficient. An unconfirmed action does not prove the
  speaker did nothing; check before retrying to avoid duplicate queue entries.

Start diagnostics name the clicked favorite and displayed room. A stopped
sequence logs its action, HTTP status and UPnP error code; internal readiness
exhaustion uses -1 and an invalid enqueue result uses -2. Preflight rejection and
final playback-confirmation failures have separate log messages. No metadata,
service credentials or response bodies are logged.
Transport failures also report the failed stage (connection, sending, response
headers or body), sent/received byte counts and available internal memory.

The original Sonos favorite metadata is preserved and XML-escaped when sent.
No music-service credentials are stored on the deck. Availability still depends
on the associated music service and the speaker's local API support.

## Network and artwork

The default bootstrap addresses (configurable via `SONOS_BOOTSTRAP_ADDRESS` and `SONOS_BOOTSTRAP_FALLBACK_ADDRESS` in `.env`) are:

- Woonkamer: `http://192.168.1.50:1400`
- Keuken: `http://192.168.1.51:1400`

Reserve these IPs in the router's DHCP settings. Either reachable speaker's
topology resolves both configured player UUIDs and their current coordinator,
including coordinator changes. This version does not run multicast discovery
on the deck; if both bootstrap IPs change, update `.env` or the substitutions. The deck
must be allowed to reach the speakers on TCP port 1400 (no client isolation).

No Sonos request carries the Homey bearer token. Topology endpoints are restricted
to private IPv4 addresses on port 1400. Artwork must be a relative path on the
coordinator, an absolute URL with that same origin, or HTTPS on the Sonos radio
image proxies `sali.sonos.superhi.fi` and `sali.sonos.radio`, or the explicitly
listed Spotify artwork hosts below. Other external hosts
are rejected. Automatic redirects remain disabled on the shared client. Artwork
alone may follow exactly one HTTPS redirect from either Sonos proxy to
`cdn-profiles.tunein.com`, without forwarding any request headers. Other hosts,
HTTP downgrades and further redirects are rejected; Homey credentials are never
sent with the redirected request.

Qmusic, NPO Radio 2/5/1, Radio 538, Sky Radio, Radio 10, JOE Nederland,
Radio Veronica, 100% NL and RADIONL West-Brabant have bundled baseline JPEG logos
in both player views and favorites. Exact registered TuneIn image resources,
including encoded Sonos proxy/coordinator URLs and the legacy logo CDN, resolve
to local keys after the usual origin checks. The eleven 272x272 assets total
111,228 compressed bytes and decode on the artwork worker, publishing after the
UI quiet window without HTTPS. Wide NPO marks are padded with white to preserve
the complete logo in the existing 92x92 player and 32x32 favorite thumbnails.
Source URLs/checksums and reproducible encoding instructions are recorded in the
online_image component. The pinned assets avoid depending on remote formats
(including unsupported progressive JPEGs) or availability. Other stations,
regions and foreign/theme channels keep their own artwork; no station-name
guessing is used. Playback is unaffected.

JPEG and PNG covers are decoded at up to 272×272 pixels, above ellipsized title
and artist. Track artwork takes precedence over the station artwork from
`CurrentURIMetaData`. Radio stream titles use the station name as their subtitle,
never the technical stream URL. The compact grouped-room label is transparent.
Both cover widgets detach before decoding, and the LVGL image cache and descriptor
dimensions are refreshed before displaying a newly decoded buffer.
The compact cover uses its own persistent 92×92 RGB565 thumbnail, center-cropped
from the decoded artwork and displayed at native scale. It does not share the
large cover's transformed rendering buffer.
New cover downloads only start while either Sonos view is selected.
Cover changes include URL, title, artist and a one-minute refresh bucket. Failed
downloads retry on the next poll; late results cannot reveal the wrong cover
after a room/source change. Missing/unsupported artwork uses the music-note
fallback. TV never displays an old music cover.

The vendored online_image component still handles complete chunked JPEG downloads
on ESP-IDF with bounded size/time; see its README.

## Validation

Transport capabilities are parsed as exact comma-separated names with surrounding
whitespace trimmed. Both `Next,Previous` and Sonos' `Next, Previous` enable skip
controls; unavailable actions and partial names remain disabled.

Favorites use three columns of 146×44 px tiles (4 px gaps), a 32×32 cover and
two-line ellipsized 12 px text. Borderless tiles retain a full touch target.
Artwork is read from the favorite or embedded metadata. Visible tiles load one
cover at a time; failures retain an icon until the next list refresh. Independent
native-size thumbnails are cached for that list (up to 100 entries / 200 KiB
pixels). Unchanged polls retain widgets, covers and scroll position. Changed lists
reuse cached covers and restore the scroll position; failed refreshes retain the
last display with unavailable controls. Failed images retry on the next list
refresh. One-line names are centered vertically and fallback icons occupy the
same 32×32 footprint as covers. Only the Sonos radio proxies
and the observed Spotify hosts `i.scdn.co`, `image-cdn-ak.spotifycdn.com`,
`image-cdn-fa.spotifycdn.com`, `seed-mix-image.spotifycdn.com` are permitted.
No music service login or Homey authorization is sent with these requests.

JPEG covers use JPEGDEC; PNG covers use PNGLE. The extra stb_image decoder has
been removed. Progressive JPEGs are unsupported and leave the fallback icon
visible. The registered RADIONL West-Brabant asset bypasses remote downloading
without adding another decoder.

On CrowPanel, mbedTLS allocates from external PSRAM rather than internal SRAM.
The observed `mbedtls_ssl_setup returned -0x7F00` is a TLS allocation failure,
before artwork decoding starts. The normal PSRAM-aware malloc setting alone does
not change mbedTLS's allocation policy. HTTPS verification and timeouts remain
unchanged; this applies to all mbedTLS connections, not only artwork. Hardware
cover-download recovery must be verified after uploading this configuration.

Run `node scripts/test-music-controls.cjs` for the actual C++ model's offline
tests: XML/entity handling, malformed replies, URL restrictions, coordinator
changes, separate/grouped rooms, TV/music priority, manual selection, missing
speakers, transient read recovery, bounded/permanent failures, no write retries,
command scope changes, volume bounds and command confirmation. Dashboard-follow
tests cover playback outside the default rooms, multiple playing groups,
detail/control selection guards, coordinator/volume routing, six-read target
loading and unknown/incomplete/transitioning playback edges. Transitioning
transport does not confirm a pause. Favorites
tests cover pagination, invalid/stale pages, filtering, radio, queue append/seek,
failure aborts, mute, skip and read-back confirmation. Favorite-scope tests cover
default and explicit room choices, separate and existing groups, either/both
speakers offline, unavailable coordinators and stale scope cancellation. They
assert that radio and queued favorites issue only playback/queue commands and
preserve room selection, membership, volume and mute.
System-list tests cover hidden/duplicate members, XML-decoded names, additional
zones, unsafe origins, missing names, the 32-zone limit and offline recovery,
while ensuring inventory discovery alone adds no requests to other speakers.
Selection tests cover extra-room polling, coordinator routing, paused/offline
selection persistence, default-seed failure, individual volume/mute, preserving
favorite state and scope cancellation. Concurrent-selection tests switch rooms
while full and selected-only reads are pending, reuse each UUID's cached labels,
discard late responses for display purposes, and invalidate caches after
regrouping, read failures and removal. Group tests cover local drafts, anchor
protection, stale/incomplete topology, promotion without clearing the source,
unchecked followers of a moving coordinator, follower-before-leader ordering,
topology confirmation and stopping after an unacknowledged write.

Run `node scripts/test-chunked-cover.cjs` for actual loopback HTTP, asynchronous
actions, UI input and PNG/JPEG decoder tests (rebuild the simulator first).
Run `node scripts/test-cover-formats.cjs` for thumbnail colors/cropping, cache ownership,
redirect allowlist checks and shared-widget lifecycle safeguards.

Additional responsiveness tests (no live speaker commands):

```sh
c++ -std=c++17 -Wall -Wextra -Werror -fsanitize=thread \
  scripts/test-sonos-exchange.cpp -o /tmp/energydeck-test-exchange
/tmp/energydeck-test-exchange
c++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined \
  scripts/test-sonos-room-order.cpp -o /tmp/energydeck-test-room-order
/tmp/energydeck-test-room-order
.venv/bin/python scripts/test-sonos-room-widgets.py
```

Build the simulator before the widget test; it uses that build's actual LVGL
library and the production selection/render lambdas. It verifies immediate
selection highlighting, no busy lock, invalidation of old artwork, retained widgets and scroll
position, label updates, playing-first sorting, and correct UUID callbacks after
reordering. A pointer test presses a partly visible row, drags it and releases:
touch-down must not launch a focus scroll animation, the list follows the drag,
and no room is selected until a real tap. The same test covers momentum ending
and correct UUID selection after a tap. The mailbox test covers delayed I/O,
immutable snapshots, exclusive
reply ownership, 1,000 cross-thread exchanges and response-size bounds. Activity
tests cover shared coordinators, read-only discovery, unknown/failed replies,
unsafe endpoints and stable command identities.

The C++ test's `--probe` mode emits only Get* requests for a read-only live
comparison; `--favorites-probe` emits only Browse requests. Automated/live diagnostic
checks must not start favorites, modify queues, change groups, pause music or
change volume. Compile the simulator and physical
firmware separately; upload to the deck only when explicitly requested.

2026-10-12 immediate-selection validation: simulator and both CrowPanel builds
passed. Model/navigation and production LVGL selection/drag/tap tests passed;
the model and room-order tests also passed AddressSanitizer/UBSan. Concurrent
model tests kept the latest selected UUID visible through old default-room and
extra-room replies, reused each room's own cached snapshot, and checked
regrouping/failure/removal invalidation and fresh command routing. Both OTA
updates succeeded. A 95-second serial capture across the 5-inch update confirmed
boot success, eight usable status cycles and 149 background replies without
crash/error markers. Physical rapid-selection feel awaits user verification.
No live speaker playback, queue, volume, mute, grouping or charging commands
were used for testing.

2026-10-12 room-focus correction: a production-renderer pointer test reproduced
an unwanted scroll-to-view animation on touching a partly visible row. It
failed before disabling scroll-on-focus and passed afterward, including drag
distance, no accidental room choice, momentum completion and actual tap/UUID
selection. The simulator and both physical builds passed, as did the Sonos
model/navigation regression. Both OTA updates succeeded. A 95-second serial
capture across the 5-inch update confirmed boot success, seven usable Sonos
status cycles and 129 background replies without crash/error markers. Physical
scroll feel still awaits user verification. No live speaker or charging commands
were used for testing.

2026-10-12 dashboard-follow validation: the simulator and both CrowPanel builds
passed. Sonos model/navigation, all-room following, room ordering and the actual
LVGL room-widget tests passed; the model and room-order tests also passed
AddressSanitizer/UBSan. Both the 5-inch and 7-inch firmware updates completed
successfully over OTA. A 95-second serial capture across the 5-inch update
confirmed boot success, seven usable status cycles and 126 background replies
(12–973 ms), without crash/error markers. The native SDL preview was not exposed
to the UI automation tool. Automatic switching was tested with synthetic SOAP
replies. The user also confirmed correct image and touch on the 5-inch and that
the main screen follows a playing room outside Woonkamer/Keuken. The 7-inch
visual behavior has not yet been confirmed. The agent sent no live playback,
queue, volume, mute, grouping or charging commands for testing.

2026-10-12 responsiveness validation: simulator and both CrowPanel builds passed,
as did Sonos model/navigation, cover-format, room-order and actual LVGL room-widget
tests. The mailbox test passed ThreadSanitizer; the room-order test passed
AddressSanitizer/UBSan. After uploading the 7-inch firmware, an 85-second serial
capture confirmed boot success, eight usable Sonos status cycles and 144
background replies (10–484 ms), with no crash/error markers. The native SDL
preview was not accessible through the UI automation tool; physical scroll feel
and ordinary command responsiveness still require user verification. No live
playback, volume, mute, grouping, queue or charging actions were used for testing.
The 5-inch firmware was built but not uploaded.

2026-10-10 validation: Sonos model/navigation, cover-format, chunked-cover and
climate-priority regression checks passed, as did the production simulator build.
Three read-only local status cycles returned all 13 replies with HTTP 200 in
0.25–0.39 seconds per cycle (excluding the UI yields); intermittent instability
was not reproduced in this short probe. After simplifying navigation, the
simulator visually confirmed the wider compact controls, direct Sonos-button
navigation, track-text navigation and Back returning to the compact card. No live
playback, volume, grouping or queue changes and no firmware upload were performed.
The Favorites/Rooms tabs and switching back to favorite covers were also visually
verified. A read-only topology probe found six visible zones and three hidden
stereo partners. Native swipe automation did not visibly scroll the SDL list;
touch scrolling on the physical display remains unverified.

2026-10-10 room-controls validation: Sonos model/navigation, cover-format and
climate-priority regressions passed, as did the production simulator build.
Visual checks confirmed selecting Aanbouw, its green selection outline and Main
marker, drafting a Keuken join, enabling Apply/cancel, and cancelling back to the
actual membership. Disabled group actions retain the dark palette. Group writes,
coordinator promotion and favorite routing were tested only with synthetic SOAP
replies. No live grouping, playback, volume, mute or queue commands and no
firmware upload were performed. Physical grouping remains unverified.

2026-10-10 compact-layout validation: cover-format/thumbnail and Sonos
model/navigation regressions passed, as did the production simulator build.
Visual checks confirmed the 92px rounded cover, the aligned room/title/volume
column with an empty artist row collapsed, the paused-room status and fallback,
and separate navigation from the room heading (Rooms) and cover (detail).
The thumbnail test exercises crop coordinates, padded source rows and buffer
boundaries at the configured size. No live playback/group/volume changes or
firmware upload were performed for this layout change.

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

### Favorite scope correction (2026-10-12)

Removed the implicit Woonkamer/Keuken startup group, volume 7 and unmute sequence.
Both default and explicit selections now retain the displayed room's existing
coordinator/group and settings. Radio and queue favorites, offline coordinators
and stale scope cancellation passed synthetic regression tests with ASan/UBSan.
The simulator, both hardware builds and production LVGL room-widget tests
passed. OTA uploads to the 5-inch and 7-inch succeeded, and both were reachable
past the boot-success window. The 5-inch serial capture confirmed a successful
boot and recovered usable Sonos status after initial Wi-Fi connection retries,
with no crash markers. No live playback, queue, grouping, volume or mute commands
were sent for verification; physical favorite behavior remains user-verifiable.

2026-10-12 room-loading follow-up: simulator compilation, production LVGL
room-widget/input/priority regression, model/navigation, cover-format, room-order
and worker-mailbox checks passed. Model and room-order tests also passed
AddressSanitizer/UBSan. Regressions cover
publishing discovery after one reply, title/status before optional reads, a
selection arriving during a failed read or a worker wait, cache preservation,
regrouping invalidation and fresh selected-follower metadata. The SDL executable
started, but UI automation could not bind to its native window, so physical
interaction latency and appearance were not measured. No firmware was uploaded
and no playback, grouping, volume or charging commands were issued for testing.

## Favorite readiness follow-up (2026-10-12)

Qmusic and Deep House Relax were reported to frequently fail to start and show
"Unconfirmed". Read-only Browse confirmed Qmusic as an audio broadcast and Deep
House Relax as a playlist container. Live playback commands were not used to
reproduce the report. The old sequence issued Seek/Play immediately after SetURI
and required exactly the first enqueued track for confirmation. The sequence now
checks readiness and the added track range, reads back after a failed command,
and performs a final fresh check after the confirmation timer. Tests cover delayed
source changes, transitioning transport, old seek positions, transient read
failures, bounded exhaustion, rejected/lost writes and actual-playback read-back.
The physical cause of the reported attempts remains unproven; the diagnostics
allow a subsequent attempt to identify a specific Sonos rejection or timeout.
The simulator, 5-inch and 7-inch builds and model/room-widget/artwork/UI-priority
regressions passed. The 5-inch build from `2026-10-12 18:34:09 +0200` was uploaded
successfully over OTA. A subsequent 95-second serial capture confirmed the
boot-success check and nine status cycles without crash/watchdog/error markers;
OTA remained reachable afterward. No new favorite start was recorded during
that capture, so physical Qmusic/Deep House Relax playback remains unverified.
The 7-inch was compiled but not updated.

## Captured favorite start follow-up (2026-10-12)

On the 5-inch, a user-triggered Deep House Relax start in Woonkamer/Keuken
successfully acknowledged enqueue, source selection, readiness, Seek and Play.
An independent read-only transport check confirmed PLAYING; the user also
confirmed audible playback. A subsequent user-triggered Qmusic attempt reached
the eight-second SetAVTransportURI deadline with HTTP status 0. No Play was sent,
and read-only status still showed the prior playlist. The user confirmed the same
Qmusic favorite works from the official Sonos app. No UPnP rejection was captured.

Favorite source/enqueue writes now allow 30 seconds on the same background worker;
they are still issued only once. Transport diagnostics distinguish connection,
send, headers and body failures without exposing request content. Repeated
AES allocation errors were also captured in the independent HTTPS worker; the
physical configurations now prefer PSRAM above 1 KiB instead of 4 KiB to reduce
internal-memory pressure. A failed source selection does not silently play the
old source or repeat the selection. These observations identify a real timeout,
but do not yet prove its transport stage or whether additional time resolves it.

After that update, another user-triggered Qmusic start acknowledged SetURI in
1,126 ms but failed the source-readiness comparison. Read-only inspection on the
current group coordinator showed the same radio resource with lowercase percent
escapes and `flags` changed from 8296 to 8232, while transport was STOPPED. The
comparison now accepts those specific normalizations, allowing Play and later
confirmation for the same radio. A regression reproduces the observed mismatch
and checks that different stations, service IDs, accounts, other flags, duplicate
flags and malformed escapes still cannot confirm the source. A separate repeated
Qmusic attempt returned UPnP 402 after 10,037 ms; the longer deadline exposed that
rejection instead of reporting only an eight-second timeout. Play remains blocked
after a rejected SetURI. The user reports real playlists start promptly.

The radio-fix simulator, 5-inch and 7-inch builds and model/room-widget/UI-priority
regressions passed. The 5-inch build from `2026-10-12 18:59:24 +0200` was uploaded
over OTA. A user-triggered Qmusic start then acknowledged SetURI in 248 ms,
passed source/transport readiness and acknowledged Play in 3,878 ms. The user
confirmed success, and independent read-only inspection on the current group
coordinator confirmed the normalized Qmusic URI with PLAYING / OK. This verifies
one physical Qmusic start; it is not a long-term reliability measurement. The
7-inch was compiled but not updated. Background HTTPS AES allocation errors
remained visible despite the lower allocation threshold. One status cycle became
unknown, with repeated read timeouts and only 8,859 internal bytes free / a
4,608-byte largest block. The next cycle recovered, as the user reported; the
radio logo subsequently appeared. The dedicated internal reserve increases from
32 KiB to 64 KiB to account for worker stacks and network/crypto memory. HTTPS
transport errors now sample internal and DMA-capable memory before cleanup.
These memory changes are separate from the confirmed radio-comparison fix.
The 64 KiB-reserve build still captured an AES failure during background HTTPS:
the before-cleanup diagnostic reported 7,811 DMA-capable bytes free but only a
2,432-byte largest block. Hardware AES is disabled in favor of software AES on
the background worker, avoiding these driver staging allocations while retaining
TLS verification. Read-only inspection also confirmed RADIONL West-Brabant
PLAYING / OK after the user switched from Qmusic.

The software-AES simulator/5-inch/7-inch builds and regression checks passed.
The 5-inch build from `2026-10-12 19:08:33 +0200` was uploaded over OTA; the
7-inch remains unchanged. A 105-second capture confirmed boot success and eight
known Sonos status cycles after reset, with no unknown cycles, AES allocation
errors, crashes or watchdog events. Two background HTTP transport failures were
recorded: one immediate startup failure and one 16,125 ms timeout. The latter
still reported low/fragmented DMA headroom (919 bytes free, largest block 448
bytes), so this check does not establish that all network memory pressure or
artwork download failures are eliminated. The observed radio URI blocker is
fixed and physically verified; background HTTP diagnostics remain available for
any further intermittent failures.
The same capture ended during another status poll whose reads were timing out;
its eventual result was not captured. Read-only inspection still confirmed the
latest Qmusic start PLAYING / OK. The internal reserve therefore increases to
128 KiB to preserve DMA/socket headroom during artwork transfers; the eight
completed known cycles must not be interpreted as proof of sustained recovery.

The final 128 KiB-reserve 5-inch and 7-inch builds passed. The 5-inch build from
`2026-10-12 19:16:19 +0200` was uploaded over OTA; the 7-inch was not updated.
A 150-second serial capture spanning the update confirmed boot success and
12 completed known selected-room cycles after reset. No background HTTP/Sonos
transport failures, AES allocation errors, crashes or watchdog events were
captured. Eight cycles reported playing; the final four reported stopped, which
independent read-only inspection confirmed as STOPPED / OK. No playback write
was recorded during this capture, so the reason for that transition is unknown.
This short observation improves on the preceding low-memory capture but does
not measure long-term reliability or prove a particular artwork download.
Model, room-widget, exchange and UI-priority/artwork regressions and the simulator
build passed. UI publication still had a 111 ms sample and startup LVGL warnings;
the worker priorities do not establish a hard interaction-latency guarantee.

## RADIONL local artwork follow-up (2026-10-12)

The station artwork exclusion was replaced with the bundled baseline logo.
Music/model, cover ownership/redirect, room-widget and UI-priority regressions
passed. The actual simulator components decoded and rendered the asset at
272/92/32 pixels, deferred publication during held input, and asserted rendered
RGB565 colors. The exported LVGL frame was visually inspected at all three sizes.
The simulator, 5-inch and 7-inch builds passed. The 5-inch build from
`2026-10-12 19:31:25 +0200` was uploaded over OTA; the 7-inch was not updated.
A 120-second serial capture spanning the update confirmed boot success and
10 known selected-room cycles without transport failures, crashes or watchdog
events. No local-logo publication was recorded during this capture, so physical
logo appearance still requires user verification. No playback/grouping/volume or
charging commands were issued for this artwork change.

## Dutch station logo set (2026-10-12)

Added ten pinned baseline JPEGs alongside RADIONL West-Brabant, using the
canonical TuneIn IDs returned by its public station search. The source URLs and
SHA256 checksums are recorded in the manifest. Pillow 12.3.0 regeneration from
the downloaded source files was byte-identical. The set adds 95,127 compressed
bytes; square padding preserves the complete wide NPO Radio 1/2 marks in the
existing thumbnail cache. Foreign, regional and theme station IDs do not map to
these national station logos.

Music/model, artwork cache/redirect and room-widget regressions passed. The
production simulator components decoded and rendered all eleven logos at
272/92/32 pixels, checked RGB565 publication and held-input deferral, and exported
a visually inspected LVGL sheet. Simulator, 5-inch and 7-inch builds passed. The
5-inch build from `2026-10-12 20:05:18 +0200` was uploaded over OTA; the 7-inch
was not updated. No playback/grouping/volume or charging commands were issued.

A 120-second serial capture spanning the update confirmed boot success and ten
known selected-room cycles, without HTTP/Sonos transport errors, crashes or
watchdog events. No local-logo publication was recorded, so physical logo
appearance remains unverified. Existing startup/component/script warnings and
UI publication samples up to 109 ms remain; this short capture does not establish
long-term stability or a hard interaction-latency guarantee.

The user subsequently confirmed that the RADIONL West-Brabant logo is visible
in both the player and favorite on the physical 5-inch display.

## 7-inch rollout (2026-10-12)

After the user connected the 7-inch unit, a serial MAC read matched the previously
verified device (`[device MAC redacted]`). The current 7-inch configuration compiled
successfully and was uploaded over OTA to `energydeck-7.local`. The serial boot
log confirmed the expected build timestamp, `2026-10-12 20:05:15 +0200`, including
the shared UI-first transport, radio-start fixes, memory settings and local logo
set. The 5-inch was not updated in this rollout. No playback/grouping/volume or
charging commands were issued for verification.

A 140-second serial capture spanning the update confirmed boot success and
twelve known selected-room cycles, with no unknown cycles, HTTP/Sonos transport
errors, crashes or watchdog events. No local-logo publication was captured;
physical 7-inch logo appearance and interaction responsiveness remain unverified.
Existing startup/component/script warnings and UI publication samples up to
110 ms remain. This observation does not measure long-term reliability.

## 7-inch playback-stop navigation rollout (2026-10-13)

The 7-inch target containing `0b56d14` compiled successfully and was uploaded
over OTA to `energydeck-7.local`. The serial boot log confirmed hostname
`energydeck-7`, build timestamp `2026-10-13 07:23:16 +0200` and the boot-success
check. OTA remained reachable after the boot-success window. The 5-inch was not
updated.

A 120-second serial capture spanning the update recorded ten known selected-room
Sonos status cycles after boot, all stopped. One GetCurrentTransportActions read
timed out during headers; status recovered and no crash/watchdog/error markers
were captured. No playback/grouping/volume or charging commands were issued.
The navigation/model regressions, simulator build and LVGL room-widget/input
checks passed before this rollout. An actual playing-to-stopped UI transition
was not triggered on the physical display, so physical automatic return from
detail and the compact player remains user-verifiable.

## Read-only queue and Up next

Both clients browse the actual coordinator's `Q:0` ContentDirectory and read
`GetTransportSettings`; no Seek, Play, queue edit or other write is issued by the
queue view. Metadata is text-only: titles and artists are retained, resource URLs
and service account data are not exposed. Radio/TV and other non-queue sources
show an explicit no-queue state, without showing a previous queue's tracks.

Summary refreshes read the current and following track; opening Queue reads up
to 40 entries, in pages of at most eight. For a current track beyond the first
40, the list starts at that track. The exact total remains in the badge. Long
queues have an explicit truncation notice. Every page must report consistent
UpdateID and total values; a change, malformed entry or failed read invalidates
the snapshot. Queue refreshes use the existing ten-second cadence and selected
room/coordinator, and do not block input. The ESP yields the shared worker to
commands and room selection between reads. Late ESP snapshots are matched to
coordinator, source and current track before being displayed.

Normal order shows the following track. Repeat One shows the current track again;
Repeat All wraps to the first track, reading it separately when needed. Shuffle
shows an explanatory note and does not predict the next track from list order.
At the last track in normal mode, Up next says the queue ends after this track.
The queue count includes already played tracks and is not a remaining-song count.

Regression checks: `node scripts/test-music-controls.cjs` includes the bounded
queue model tests; `.venv/bin/python scripts/test-sonos-room-widgets.py` exercises
the actual queue-render lambda with the simulator's LVGL. Web queue tests are in
`web/test/features.test.mjs`. These use fixtures and issue no real controls.
