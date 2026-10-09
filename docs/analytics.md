# Game analytics

The game uses GA4 directly inside its iframe. itch.io's own integration measures the project page; it cannot observe the game's JavaScript actions. The game sends `game_open` instead of an additional automatic `page_view`.

Production builds select a stream at runtime:

| Hosting address | Measurement ID |
| --- | --- |
| `https://mihailpreis.github.io/Wheelie/` | `G-6SWYV1V5K3` |
| `https://mprice.itch.io/wheelie` | `G-5XMH4C66VL` |

An itch iframe is recognized by its parent referrer (including origin-only referrers) or the itch HTML CDN host. The project's current iframe uses `html-classic.itch.zone`. A direct visit to Pages from an itch link still uses the Pages stream; an itch parent takes priority only when embedded. Exactly one stream is configured, and every event is addressed explicitly to that stream. The loaded Google script and all events use the same selected ID.

`VITE_GA_MEASUREMENT_ID` is an optional fallback for other hosting addresses, not an override of these two destinations. With `auto` or no value, unknown hosts are not tracked. `disabled` or an explicitly empty build environment value disables tracking everywhere. The Pages/itch workflow uses the repository variable `GA_MEASUREMENT_ID`, defaulting to `auto`; use `disabled` to switch it off in deployments. Development builds and localhost never load Google scripts or send events. The same archive works on both hosting sites without rebuilding.

Commands use a separate `wheelieDataLayer` queue and an explicit `send_to`. No runtime dependency is added. The Google integration module is loaded only in production through an optional dynamic import. Development does not request `/src/analytics/` modules, and the shared event dispatcher lives in `src/services/events.ts`. A blocked integration module, blocked tag or offline connection does not block play.

| Event | Trigger | Parameters |
| --- | --- | --- |
| `game_open` | One game startup | `entry` (menu/replay/track), `embedded` |
| `run_start` | Successful regular/daily launch or restart | `mode`, `league`, `input_device`, `pack_type` (original/catalogue/custom) |
| `run_end` | A run is closed by restart, exit or switching tracks | `outcome` (finished/crashed/abandoned), `duration_ms`, `race_time_ms`, `mode` |
| `game_pause` | Enter the pause menu | — |
| `game_resume` | Continue from pause | — |
| `replay_open` | Successfully open the player | `embedded`, `duration_ms` |
| `editor_test` | Start testing an editor track | `league` |
| `mod_install` | Successfully store a downloaded/imported pack | `source` (catalogue/file) |
| `export_ready` | Prepare PNG/GIF or download a GDR | `format` |
| `share` | Existing run-sharing success callback | `content_type` (run) |
| `unlock_achievement` | Award a new achievement | `achievement_id` |

`run_end` is emitted when the run closes, including its finish animation; closing the browser abruptly or exiting before the first simulation tick may leave no end event. It is not a reliable session completion counter. `duration_ms` measures recorded simulation ticks, excluding pause. `race_time_ms` is zero for unfinished runs. An export being ready does not mean the user shared it. The existing share callback includes media downloads and copied links; it does not identify a destination or recipient.

All explicit events include `telemetry_source=game`, `app_version`, and a page address/referrer stripped of query strings and fragments. Player names, file names, custom track names, replay contents and shared URLs are not event parameters. Advertising personalization and Google signals are disabled. GA itself still collects its normal browser/session metadata.

In GA4, register the event-scoped custom dimensions you need: `telemetry_source`, `entry`, `mode`, `input_device`, `pack_type`, `outcome`, `format`, `source`, `embedded`, and `achievement_id`. Register `duration_ms` and `race_time_ms` as custom metrics in milliseconds. Compare starts/outcomes by mode and device, player usage, exports and mod adoption. Avoid treating all starts as unique players.

For this stream, disable **Enhanced measurement → Page views → Advanced settings → Page changes based on browser history events**. The game uses history for Back navigation, and automatic history pageviews would count that navigation separately. If the stream is dedicated to game events, disable Enhanced measurement entirely. These are stream settings, not controlled by the build; the itch.io page's ordinary load pageview can remain enabled.

After deployment, open the game on itch.io and verify `game_open`, `run_start`, `game_pause`, `game_resume` and `run_end` in Realtime/Tag Assistant. Automated tests mock the queue/transport and never send to the live property. Receipt in the real GA property is a deployment check.

References: [itch.io analytics integration](https://itch.io/updates/you-can-now-use-google-analytics-with-itchio), [Google event setup](https://developers.google.com/analytics/devguides/collection/ga4/events), [pageviews](https://developers.google.com/analytics/devguides/collection/ga4/views), [data layer naming](https://developers.google.com/tag-platform/tag-manager/datalayer), [configuration](https://developers.google.com/analytics/devguides/collection/ga4/reference/config).
