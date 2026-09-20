# Sonos: direct local playback state

The **Sonos** tab opens the player. The green **Radio** button still starts the
existing Homey Advanced Flow **Sonos - Beneden RadioNL**. Homey remains responsible
for station choice, power-switch checks, starting volume and grouping. Opening a
tab or changing the displayed room never starts music.

## Why not read playback metadata from Homey?

A simultaneous read on 2026-09-20 found that Homey's cloud Sonos devices still
reported John Mayer — Slow Dancing in a Burning Room, last updated 27 minutes
earlier, while the local group coordinator reported Eric Clapton — Wonderful
Tonight. More frequent Homey reads cannot repair that stale source.

EnergyDeck now polls Sonos locally every **10 seconds** (formerly Homey every
30 seconds). It reads ZoneGroupTopology first, then transport state, media source
and track metadata from each distinct coordinator, and volume from each room.
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
- A playback start opens Sonos automatically. Confirmed stopped playback in both
  rooms returns an active Sonos card to Gas. Manual Gas/Climate choices are
  respected during continuous playback. Missing data does not count as stopped.

Pause/Play goes directly to the selected room's coordinator. Minus/plus adjust
the displayed room by two percentage points, clamped to 0–100. For the combined
Woonkamer/Keuken group, both configured rooms are adjusted, preserving their
volume offset except at the bounds. Other household rooms are not volume targets.
Playback controls inherently affect the coordinator's actual group, so avoid
adding unrelated rooms if they should remain unaffected by Pause/Play.

Commands are only created after a user click. The displayed target is captured,
fresh topology/volume is read, and a changed group scope cancels the command.
Controls are disabled during requests and unavailable data; read-back verifies
the result. There is no automatic command retry and mute state is unchanged.

Radio shows Waiting immediately and times out after 90 seconds. Fresh grouped
music playback in both rooms confirms the start, including a late success after a
timeout. TV playback alone cannot confirm Radio. This does not verify the station
name; the Flow remains the source of station selection. The Flow is not retried
automatically.

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
coordinator or an absolute URL with that same origin; external artwork URLs are
not fetched. Redirects remain disabled.

JPEG covers remain 62×62 pixels, alongside one-line ellipsized title and artist.
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
speakers, command scope changes, volume bounds and command confirmation.

Run `node scripts/test-chunked-cover.cjs` for the JPEG download regression tests.

The C++ test's `--probe` mode emits only Get* requests for a read-only live
comparison. Automated/live diagnostic checks must not start the Radio Flow,
change groups, pause music or change volume. Compile the simulator and physical
firmware separately; upload to the deck only when explicitly requested.

2026-09-20 validation: native simulator and ESP32 builds passed. A read-only
live probe decoded the actual kitchen coordinator's current track for both
rooms; simulator logs confirmed recurring direct reads and successful JPEG
cover download/decode. The automation tool could not access the SDL window, so
visual layout verification remains manual. Live controls, TV playback and
regrouping were not exercised against the household; those paths were tested
with synthetic replies. No firmware upload was performed.
