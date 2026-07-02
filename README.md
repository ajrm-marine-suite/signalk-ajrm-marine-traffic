# AJRM Marine Traffic

Server-side collision and navigation-safety core for the AJRM Marine suite.

Version `0.5.15` adds configurable stationary automute debounce: by default
Traffic waits 10 seconds before muting after stationary detection and 3 seconds
before unmuting after motion detection. Unknown speed after GPS loss is kept
unknown rather than treated as stationary, so the GPS-lost alert is not
silenced immediately in harbour.

Version `0.5.14` publishes `plugins.ajrmMarineTraffic.voyageState` as the
suite's shared on-passage/motion projection. It uses Signal K
`navigation.state` where available and combines speed over ground with speed
through water so Capture and Audio do not have to infer movement separately
when GPS/SOG is unavailable.

Version `0.5.12` writes the normalized default Traffic settings on first enable
when Signal K has not yet created a plugin config file, so a fresh install does
not require opening settings and pressing save once.

Version `0.5.6` fixes Anchor profile CPA/TCPA evaluation when top-level
anchorage thresholds are edited and stale per-size entries still contain zero
CPA values.

Version `0.5.5` also suppresses MMSI-style fallback names in spoken encounter
messages when the Traffic projection has copied MMSI into the name field.

Version `0.5.4` keeps MMSI-only vessel identifiers in written encounter
notifications while publishing a shorter speech-friendly message for Audio.

Version `0.5.3` enables the stationary automute master switch and All's well
reassurance by default on fresh installs, while preserving explicit off
settings. Anchor and Harbour default to automute while stationary; Coastal and
Offshore default to keeping audio enabled.

Status: installable simulator-test AJRM Marine Traffic. It is disabled by default; when
enabled it is the authoritative AIS traffic provider for target projections,
standard Signal K collision notifications, profile commands, Auto Profile,
audio-policy commands, and target silence controls.

The package includes its own **AJRM Marine Traffic** administration webapp for
health, session/sequence diagnostics, Auto Profile selection, mute/automute
policy, and silence controls. Other displays such as Freeboard-SK, KIP, or
third-party Signal K clients can use the AJRM Marine Traffic without installing
AJRM Marine Display.

## Purpose

The AJRM Marine Traffic owns:

- AIS and own-vessel ingestion;
- normalized target state and data health;
- hull-aware CPA/TCPA;
- profile and auto-profile policy;
- encounter risk and lifecycle;
- target silencing;
- AIS-specific wording, facts, and actions;
- standard Signal K notification publication;
- stable target and capability projections.

It does not own:

- generic cross-provider notification mechanics;
- physical audio queues or synthesis;
- charts or browser rendering;
- instrument alert policy belonging to other providers.

## Integration rules

- Standard Signal K paths, base units, notifications, deltas, subscriptions,
  resources, security, and OpenAPI are the public integration layer.
- Notifications remain useful to generic Signal K clients without optional
  suite extensions.
- Plugin diagnostics use Signal K `app.debug()` and `app.error()`.
- Runtime alert state is not restored from a previous Signal K process.

## Current behaviour

Version `0.8.20` debounces GPS recovery announcements after short intermittent
dropouts, shortens their audio expiry, and marks GPS recovery as superseding
the GPS integrity alarm subject.

Version `0.8.19` uses Signal K path metadata `displayUnits` where available
for spoken CPA distances. Metric preferences use meters below 1000 m and
kilometers above; imperial feet preferences use feet below 1000 ft and miles
above; the default remains marine miles spoken simply as `miles`.

Version `0.8.18` shortens encounter announcement CPA wording from
`nautical miles` to `miles`, since the marine context makes the unit clear.

Version `0.8.9` stops the live refresh loop from overwriting focused Audio
Policy text/number fields, so the All's well quiet period can be typed
manually without snapping back to the previous value.

Version `0.8.8` clarifies the AJRM Marine Traffic Audio Policy webapp layout: the
current mute/automute status appears directly under the Audio Policy heading,
the policy button is labelled Enable audio / Mute audio, and All's well
reassurance settings sit on their own line.

Version `0.8.7` exposes All's well reassurance controls in the AJRM Marine Traffic
Audio Policy webapp section, publishes those settings in the Audio Policy
projection, and emits the reassurance as a AJRM Marine Traffic system event after the
configured quiet period when sound is enabled, GPS is fresh, and no traffic
alert is active.

Version `0.8.4` accepts Display/legacy profile CPA thresholds saved in nautical
miles and normalizes them to metres for Traffic evaluation. It also falls back to
the configured outside profile when Auto Profile is enabled but Signal K harbour
region resources are unavailable.

Version `0.8.3` keeps the existing package id and Signal K paths but updates the
user-facing name to **AJRM Marine Traffic**.

Version `0.8.2` independently ingests standard Signal K vessel data and:

- calculates range, bearing, point and hull-aware CPA/TCPA;
- applies the selected profile thresholds and sensitivity multipliers;
- publishes the versioned authoritative target projection;
- marks AJRM Marine Logger replay explicitly;
- publishes standard collision notifications with Notifications Plus session,
  sequence, and correlation metadata;
- clears AJRM Marine Traffic notifications on de-escalation, target loss, stale
  own-vessel position, plugin stop, or restart;
- refreshes late vessel names and changing encounter details as throttled
  visual-only revisions, retaining correlation without replaying audio;
- owns commands for profile selection, per-size CPA/TCPA/speed thresholds,
  sensitivity multipliers, per-target silence/unsilence, and unsilence-all;
- owns Auto Profile selection using Signal K harbour region resources,
  enter/exit hysteresis, and Anchor release speed;
- owns global mute and stationary automute policy, with manual override,
  debounced stationary entry, and immediate automatic unmute on movement;
- publishes versioned `autoProfile`, `audioPolicy`, and `profiles` projections
  carrying AJRM Marine Traffic session and monotonic sequence metadata;
- publishes GPS received, Auto Profile selection, and stationary auto-mute /
  auto-unmute as one-shot Notifications Plus system events so Companion Recent
  Activity and Audio receive the operational timeline;
- exposes policy controls and the full profile limit editor in the AJRM Marine Traffic
  administration webapp and persists them through Signal K plugin options.
  Target silence deliberately resets when Signal K or the plugin restarts.

It publishes:

```text
vessels.self.plugins.ajrmMarineTraffic.capabilities
vessels.self.plugins.ajrmMarineTraffic.targets
vessels.self.plugins.ajrmMarineTraffic.autoProfile
vessels.self.plugins.ajrmMarineTraffic.audioPolicy
vessels.self.plugins.ajrmMarineTraffic.profiles
vessels.self.notifications.collision.*
```

Collision notifications publish below `notifications.collision.*` when an
encounter state enters or changes among `warn`, `alarm`, and `emergency`, and
ongoing active alerts repeat audio according to the current profile's repeat
sensitivity.

See [AJRM Marine Logger replay](docs/REPLAY.md) for the offline replay workflow.

## Install for simulator testing

```bash
cd ~/.signalk
npm install git+https://github.com/ajrm-marine-suite/signalk-ajrm-marine-traffic.git#v0.5.16 --omit=dev --no-package-lock
sudo systemctl restart signalk
```

Enable **AJRM Marine Traffic** explicitly in Signal K so it publishes AIS
collision notifications and target projections.

The component contracts are documented in this repository under `docs/`.

## Version

`v0.5.1` removes the repeated `CPA` label from encounter announcements when
the message already includes a `CPA will be ...` passing phrase. Plain CPA
announcements still include the `CPA` label.

`v0.5.0` preserves focused Audio Policy text/number field edits during the
status refresh loop and applies them when the field changes or Enter is pressed.

`v0.5.0` makes the Audio Policy controls clearer and separates All's well
reassurance controls from mute/automute controls.

`v0.5.0` adds visible All's well reassurance settings to AJRM Marine Traffic:
enabled/disabled, phrase, and quiet-period minutes. AJRM Marine Traffic emits the
reassurance as a normal Notifications Plus system event only after the quiet
period while unmuted, GPS-fresh, and free of active traffic alerts.

`v0.5.0` fixes CPA profile threshold unit compatibility so values saved as
nautical miles by Display/legacy editors are evaluated correctly by Traffic
Core. Auto Profile now degrades to the configured outside profile if harbour
regions cannot be loaded.

`v0.5.0` updates the display name and documentation to AJRM Marine Traffic while
keeping the package id, plugin id, and `plugins.ajrmMarineTraffic.*` paths unchanged
for compatibility.

`v0.5.0` publishes GPS received, Auto Profile selection, and stationary
auto-mute / auto-unmute transitions as one-shot Notifications Plus history
events. AJRM Marine Companion Recent Activity now shows those AJRM Marine Traffic state
changes instead of only collision alerts.

`v0.5.0` publishes explicit resolved/normal notification envelopes when Traffic
Core clears an alert, preventing stale active Notifications Plus data from
leaking through Signal K API consumers after CPA/TCPA danger has passed.

`v0.5.0` added the authoritative AJRM Marine Traffic profile editor for CPA/TCPA/speed
limits and sensitivity multipliers, while keeping AJRM Marine Traffic authoritative for
Auto Profile, audio mute/automute policy, and collision notifications.


## Public Beta

AIS and traffic decision service for the AJRM Marine Suite.

Development assistance: OpenAI Codex helped with code generation, refactoring, and automated testing during the beta development cycle.
