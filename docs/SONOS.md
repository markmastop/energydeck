# Sonos: dedicated local player and favorites

An explicitly opened Sonos detail page stays open when playback pauses/stops,
transitions or becomes unavailable. The back arrow returns to the compact Sonos
card, so favorites and extra controls remain accessible after pausing.

The dashboard's right-hand **Sonos** button opens the full player directly,
including while idle, offline or waiting for a command. Tapping the compact
player's cover or track text also opens detail through one shared touch target.
The compact player uses a larger 92px cover on the left, with the room selector,
a two-line track title, artist/status and volume aligned in one column beside it.
Long room/group names and titles are ellipsized within fixed two-line boxes;
waiting, pause and error text replace the artist row. The room selector opens
Rooms. Empty artist rows and unused title lines collapse; combined default-room
volumes use compact percentages in the heading's living/kitchen order. The selector
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
skip, volume and mute controls. Below the player, **Favorites / Rooms** tabs
switch between the three-column favorites grid and a scrollable system list.
The selected tab is retained when leaving and reopening detail. Rooms shows up
to 32 visible Sonos zones from the existing topology response, with their actual
zone names and group membership. Hidden bonded/stereo partners are omitted to
avoid duplicate rooms. Playback status is shown when the zone belongs to a
polled coordinator; other zones show Detected without claiming playback state.
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
heading opens the Rooms tab in either player. Favorites show a small type
icon and up to two title lines, with six tiles visible before scrolling. Missing
font glyphs are omitted from display only; playback metadata remains untouched.
Favorites come directly from Sonos; no Homey Flow is involved. When the dashboard
Sonos card is selected and neither room is playing, it shows the same favorites
in a scrollable five-column icon grid (ten visible tiles). The room label uses the
full card width while favorites are shown.
Compact tiles keep a 44×44 px touch target around the 32×32 artwork or fallback
icon, with 10 px horizontal and 4 px vertical gaps. Names remain visible in Detail.
After an explicit room choice or group edit, favorites play on the selected
room's current coordinator and group, preserving volume, mute and membership.
Fresh topology must still match the displayed scope before playback.
Before any explicit choice, starting a favorite checks both configured speakers
using fresh individual volume/mute replies, groups reachable Woonkamer and Keuken
if needed, sets each
to absolute volume **7/100**, and unmutes them before playback. If only one is
reachable, it is used alone; a reachable follower detaches from an unavailable
coordinator first. An existing healthy Woonkamer/Keuken coordinator is retained.
The setup is read back before any favorite URI or queue command is sent. A failed
setup stops the sequence and reports an error; it never retries queue insertion.
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
zone adds just that room and its coordinator, rather than polling the entire
household. The selected zone also acts as a fallback discovery seed when the
two defaults are unavailable.
Requests are sequential with an 80 ms yield for the UI. A slow cycle is not
overlapped. Each failed read gets at most one retry for a network error, HTTP
408/429/500/502/503/504 or a malformed/truncated HTTP 200 reply, before publishing
the new snapshot. SOAP faults and permanent HTTP errors are not retried. A retry
uses the same UI yield and existing eight-second request timeout; persistently
unreachable speakers can therefore extend a cycle. Exhausted retries still show
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
  choice persists across pause, regrouping and offline recovery. Editing group
  membership also pins the displayed anchor, even without first tapping its row.
- TV is detected from the coordinator's `x-sonos-htastream:` source. Show **TV**
  and clear old song/artist/artwork. TV volume remains available; Pause/Play is
  disabled because the TV controls its source.
- Starting or stopping playback does not change the current page. Dashboard Gas
  and Climate remain manually available.

Pause/Play goes directly to the selected room's coordinator. Minus/plus adjust
the displayed room by two percentage points, clamped to 0–100. For the combined
Woonkamer/Keuken group before an explicit room choice, both configured rooms are
adjusted, preserving their volume offset except at the bounds. After selecting
any room or editing a group, volume and mute target only that room. Transport
and favorites follow its actual coordinator, so they affect its current group.
Previous/Next are enabled only when Sonos reports the action available.
Playback controls and favorite selection inherently affect the coordinator's
actual group, so avoid adding unrelated rooms if they should remain unaffected.

Commands are only created after a user click. For ordinary playback controls, the displayed target is captured,
fresh topology/volume is read, and a changed group scope cancels the command.
Controls are disabled during requests and unavailable data; read-back verifies
the result. There is no automatic command retry.

## Sonos favorites

ContentDirectory `Browse` reads `FV:2` in pages of eight when the page opens,
when the compact Sonos card first needs the list, and every five minutes while
either Sonos view is selected. There is no section heading or manual refresh
button; the favorite tiles follow the player directly. A complete, consistent
UpdateID is required; unavailable or malformed data disables favorites rather
than silently using an outdated list. Collection and payload sizes are bounded.
Entries without playable URI/metadata (such as pinned discovery shortcuts) are
omitted. Tiles show title and a radio/music icon, not remote thumbnail downloads.

- First verify grouping, volume 7 and unmuted state as described above.
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
image proxies `sali.sonos.superhi.fi` and `sali.sonos.radio`, or the explicitly
listed Spotify artwork hosts below. Other external hosts
are rejected. Automatic redirects remain disabled on the shared client. Artwork
alone may follow exactly one HTTPS redirect from either Sonos proxy to
`cdn-profiles.tunein.com`, without forwarding any request headers. Other hosts,
HTTP downgrades and further redirects are rejected; Homey credentials are never
sent with the redirected request.

RADIONL TuneIn station `s106736` artwork is deliberately skipped in both player
views and favorites because it is unreliable on the physical display. The music
icon remains visible; station playback is unaffected. Other covers are unchanged.

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
visible. RADIONL artwork is skipped before downloading.

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
command scope changes, volume bounds and command confirmation. Transitioning
transport does not confirm a pause. Favorites
tests cover pagination, invalid/stale pages, filtering, radio, queue append/seek,
failure aborts, mute, skip and read-back confirmation. Setup tests cover both
speakers, either speaker offline, both offline, stale groups with an offline
coordinator, grouping failures, and volume/group read-back before playback.
System-list tests cover hidden/duplicate members, XML-decoded names, additional
zones, unsafe origins, missing names, the 32-zone limit and offline recovery,
while ensuring inventory discovery alone adds no requests to other speakers.
Selection tests cover extra-room polling, coordinator routing, paused/offline
selection persistence, default-seed failure, individual volume/mute, preserving
favorite setup and scope cancellation. Group tests cover local drafts, anchor
protection, stale/incomplete topology, promotion without clearing the source,
unchecked followers of a moving coordinator, follower-before-leader ordering,
topology confirmation and stopping after an unacknowledged write.

Run `node scripts/test-chunked-cover.cjs` for the JPEG download regression tests.
Run `node scripts/test-cover-formats.cjs` for PNG/JPEG selection, PNG completion,
decoder initialization failures and shared-widget lifecycle safeguards.

The C++ test's `--probe` mode emits only Get* requests for a read-only live
comparison; `--favorites-probe` emits only Browse requests. Automated/live diagnostic
checks must not start favorites, modify queues, change groups, pause music or
change volume. Compile the simulator and physical
firmware separately; upload to the deck only when explicitly requested.

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
