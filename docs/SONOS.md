# Sonos preview

The music tab is labelled **Sonos**. The **Radio** button inside that card
starts the existing Homey Flow; selecting the Sonos tab only opens the card.

When either speaker starts playing, the Sonos tab is selected automatically,
including playback already active at startup. Subsequent polling respects manual
tab selection. Only confirmed stopped playback in both rooms resets detection;
temporary connection failures cannot cause repeated automatic switching.
When both speakers are confirmed stopped or paused, an active Sonos card returns
to Gas. A manually selected Extra or Gas tab remains unchanged. Missing data
does not count as stopped playback.

The detail area has three mutually exclusive cards selected by the right-hand
tabs: Gas (pink), Radio (green), and Extra (blue placeholder). Gas is selected
at startup. Only the active tab has a coloured background and a thicker accent
border; inactive tabs remain dark. Polling does not change the selected tab.
The player displays small JPEG album artwork supplied by Homey, with a
code-drawn music-note fallback. Title and artist sit beside it; room volumes
stay on one line above the control row.

The **Radio** button inside the Radio card links to the existing Advanced Flow
**Sonos - Beneden RadioNL**. The display never selects a station or groups
speakers itself: change the favourite, startup volume, power-switch checks and
grouping in that same Homey Flow without rebuilding the firmware. Recreating
the Flow gives it a new ID and requires updating homey_radio_flow_id in
esphome/packages/music.yaml.

Selecting a tab only changes the visible card and never starts music.
Radio immediately displays a disabled waiting state. A successful HTTP response
means the Flow was accepted, not that music has started. Fresh observations of
both speakers playing clear the waiting state; after 90 seconds, or a request
error, a retry message is shown. This does not verify station selection or
group membership. A late successful playback update also clears an earlier
timeout warning. The display does not retry the Flow automatically.

Woonkamer and Keuken are read sequentially every 30 seconds, with a 500 ms gap,
and after a successful user request. The card shows title/artist from a playing
speaker (Woonkamer takes priority), and each room's actual volume. Unavailable
rooms show missing data rather than stale playback metadata.

Validation: simulator compilation and whitespace checks. The real Flow is
intentionally not triggered by automated checks. Review the layout and test
Radio manually in the simulator. No physical-device upload is included.

## Playback and volume

The separate Pause/Play button writes speaker_playing for both configured rooms.
The minus/plus buttons adjust each room's volume by two percentage points,
bounded to 0–100%, preserving the existing offset except at those boundaries.
Controls refresh both rooms before calculating their targets, serialize writes,
disable during processing, and read the status back afterwards. Missing data or
failed/unconfirmed requests show a compact warning rather than claiming success.
Volume buttons do not change mute state. No grouping is performed by these
controls; the Radio Flow remains responsible for establishing the intended group.

Commands use the Homey capability endpoint and require homey.device.control:
https://athombv.github.io/node-homey-api/HomeyAPIV3Local.ManagerDevices.html#setCapabilityValue

Artwork is fetched only from Homey's /api/image/ path and refreshed when its
URL or update timestamp changes. Failed downloads retry on the next status
refresh. Redirect following is disabled for the shared HTTP client to avoid
forwarding the Homey token; weather/rain URLs must therefore be final URLs.
Unsupported image formats fall back to the music note.

Run node scripts/test-music-controls.cjs to test the actual firmware calculation
and late-start-recovery fragments without issuing any live commands.
