# AJRM Marine Traffic contract baseline

This document is the public AJRM Marine Traffic contract baseline.

The AJRM Marine Traffic publishes:

- capability and health at
  `vessels.self.plugins.ajrmMarineTraffic.capabilities`;
- normalized targets at `vessels.self.plugins.ajrmMarineTraffic.targets`;
- Auto Profile state at `vessels.self.plugins.ajrmMarineTraffic.autoProfile`;
- Audio Policy state at `vessels.self.plugins.ajrmMarineTraffic.audioPolicy`;
- profile sensitivity state at `vessels.self.plugins.ajrmMarineTraffic.profiles`;
- standard Signal K notifications under
  `vessels.self.notifications.collision.*`.

Every AJRM Marine Traffic projection carries:

- `contract` and integer `contractVersion`;
- AJRM Marine Traffic `sessionId`;
- monotonic `sequence`;
- `generatedAt`;
- operational `mode`, currently `traffic` for compatibility with existing
  consumers.

The AJRM Marine Traffic creates provider `correlationId`, `eventId`, `subjectKey`,
`providerSessionId`, and `sourceSequence` fields for its notification envelope.

## Authoritative invariant

When the AJRM Marine Traffic plugin is enabled:

- capability and target projections declare `authoritative: true`;
- notifications publish only below `notifications.collision.*`;
- unchanged encounter state is not republished;
- normal state, target loss, stale own-vessel position, stop, and restart clear
  any active AJRM Marine Traffic notification;
- notification envelopes identify provider `ajrm-marine-traffic` and retain Traffic
  Core `providerSessionId`, `sourceSequence`, and target `correlationId`;
- `commandsEnabled` is true;
- commands expose profile selection, profile sensitivity settings, Auto Profile,
  Audio Policy, All's well reassurance policy, per-target silence, and
  unsilence-all;
- silence state is session-scoped and resets on restart.
