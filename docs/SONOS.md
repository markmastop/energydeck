# Sonos preview

The music card currently replaces the gas card permanently for layout review.
Gas widgets and their normal data refresh remain intact, but hidden. Automatic
switching between gas and music, artwork and playback/volume controls are not
part of this first preview.

The first quick action is **Radio**, linked to the existing Advanced Flow
**Sonos - Beneden RadioNL**. The display never selects a station or groups
speakers itself: change the favourite, startup volume, power-switch checks and
grouping in that same Homey Flow without rebuilding the firmware. Recreating
the Flow gives it a new ID and requires updating homey_radio_flow_id in
esphome/packages/music.yaml.

Radio immediately displays a disabled waiting state. A successful HTTP response
means the Flow was accepted, not that music has started. Fresh observations of
both speakers playing clear the waiting state; after 90 seconds, or a request
error, a retry message is shown. This does not verify station selection or
group membership. The display does not retry the Flow automatically.

Woonkamer and Keuken are read sequentially every 30 seconds, with a 500 ms gap,
and after a successful user request. The card shows title/artist from a playing
speaker (Woonkamer takes priority), and each room's actual volume. Unavailable
rooms show missing data rather than stale playback metadata.

Validation: simulator compilation and whitespace checks. The real Flow is
intentionally not triggered by automated checks. Review the layout and test
Radio manually in the simulator. No physical-device upload is included.
