# AJRM Marine Traffic

Server-side collision and navigation-safety core for the AJRM Marine suite.

Status: installable simulator-test Traffic Core. It is disabled by default; when
enabled it is the authoritative AIS traffic provider for target projections,
standard Signal K collision notifications, profile commands, Auto Profile,
audio-policy commands, and target silence controls.

The package includes its own **AJRM Marine Traffic** administration webapp for
health, session/sequence diagnostics, Auto Profile selection, mute/automute
policy, and silence controls. Other displays such as Freeboard-SK, KIP, or
third-party Signal K clients can use the Traffic Core without installing
AJRM Marine Display.

## Purpose

The Traffic Core owns:

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

Version `0.8.8` clarifies the Traffic Core Audio Policy webapp layout: the
current mute/automute status appears directly under the Audio Policy heading,
the policy button is labelled Enable audio / Mute audio, and All's well
reassurance settings sit on their own line.

Version `0.8.7` exposes All's well reassurance controls in the Traffic Core
Audio Policy webapp section, publishes those settings in the Audio Policy
projection, and emits the reassurance as a Traffic Core system event after the
configured quiet period when sound is enabled, GPS is fresh, and no traffic
alert is active.

Version `0.8.4` accepts Display/legacy profile CPA thresholds saved in nautical
miles and normalizes them to metres for Engine evaluation. It also falls back to
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
- clears Traffic Core notifications on de-escalation, target loss, stale
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
  carrying Traffic Core session and monotonic sequence metadata;
- publishes GPS received, Auto Profile selection, and stationary auto-mute /
  auto-unmute as one-shot Notifications Plus system events so Companion Recent
  Activity and Audio receive the operational timeline;
- exposes policy controls and the full profile limit editor in the Traffic Core
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

Collision notifications publish below `notifications.collision.*` only when
encounter state enters or changes among `warn`, `alarm`, and `emergency`;
unchanged calculations do not create duplicate audio requests.

See [AJRM Marine Logger replay](docs/REPLAY.md) for the offline replay workflow.

## Install for simulator testing

```bash
cd ~/.signalk
npm install git+ssh://git@ssh.github.com:443/ajrm-marine-suite/signalk-ajrm-marine-traffic.git#v0.5.0 --omit=dev --no-package-lock
sudo systemctl restart signalk
```

Enable **AJRM Marine Traffic** explicitly in Signal K so it publishes AIS
collision notifications and target projections.

The component contracts are documented in this repository under `docs/`.

## Version

`v0.5.0` preserves focused Audio Policy text/number field edits during the
status refresh loop and applies them when the field changes or Enter is pressed.

`v0.5.0` makes the Audio Policy controls clearer and separates All's well
reassurance controls from mute/automute controls.

`v0.5.0` adds visible All's well reassurance settings to AJRM Marine Traffic:
enabled/disabled, phrase, and quiet-period minutes. Traffic Core emits the
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
events. AJRM Marine Companion Recent Activity now shows those Traffic Core state
changes instead of only collision alerts.

`v0.5.0` publishes explicit resolved/normal notification envelopes when Traffic
Core clears an alert, preventing stale active Notifications Plus data from
leaking through Signal K API consumers after CPA/TCPA danger has passed.

`v0.5.0` added the authoritative Traffic Core profile editor for CPA/TCPA/speed
limits and sensitivity multipliers, while keeping Traffic Core authoritative for
Auto Profile, audio mute/automute policy, and collision notifications.


## Public Beta

AIS and traffic decision engine for the AJRM Marine Suite.

Development assistance: OpenAI Codex helped with code generation, refactoring, and automated testing during the beta development cycle.
