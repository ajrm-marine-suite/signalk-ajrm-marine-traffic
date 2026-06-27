"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateProjection,
  createTrafficCore,
  ingestDelta,
  setProfile,
  setTargetSilenced,
  unsilenceAllTargets,
} = require("../plugin/lib/traffic-core");

function delta(context, values, timestamp = "2026-06-19T15:30:00.000Z") {
  return { context, updates: [{ timestamp, values }] };
}

test("AJRM Marine Traffic creates a versioned authoritative target projection", () => {
  const state = createTrafficCore({
    sessionId: "traffic-session",
    profile: "coastal",
  });
  ingestDelta(
    state,
    delta("vessels.self", [
      { path: "navigation.position", value: { latitude: 50, longitude: -1 } },
      { path: "navigation.speedOverGround", value: 2 },
      { path: "navigation.courseOverGroundTrue", value: 0 },
    ]),
  );
  ingestDelta(
    state,
    delta("vessels.urn:mrn:imo:mmsi:235900004", [
      { path: "mmsi", value: "235900004" },
      { path: "", value: { name: "Ferry Alpha" } },
      {
        path: "navigation.position",
        value: { latitude: 50.01, longitude: -0.995 },
      },
      { path: "navigation.speedOverGround", value: 2 },
      { path: "navigation.courseOverGroundTrue", value: Math.PI },
      { path: "design.length", value: { overall: 120 } },
      { path: "design.beam", value: 22 },
    ]),
  );
  const projection = calculateProjection(
    state,
    "2026-06-19T15:30:01.000Z",
  );
  assert.equal(projection.contract, "ajrm-marine-traffic-targets");
  assert.equal(projection.sessionId, "traffic-session");
  assert.equal(projection.sequence, 1);
  assert.equal(projection.mode, "traffic");
  assert.equal(projection.authoritative, true);
  assert.equal(projection.targets.length, 1);
  assert.equal(projection.targets[0].name, "Ferry Alpha");
  assert.ok(projection.targets[0].encounter.correlationId);
});

test("AJRM Marine Traffic uses heading before COG for clock-relative bearings", () => {
  const state = createTrafficCore({
    sessionId: "heading-session",
    profile: "coastal",
  });
  ingestDelta(
    state,
    delta("vessels.self", [
      { path: "navigation.position", value: { latitude: 50, longitude: -1 } },
      { path: "navigation.speedOverGround", value: 3 },
      { path: "navigation.courseOverGroundTrue", value: 0 },
      { path: "navigation.headingTrue", value: Math.PI / 2 },
    ]),
  );
  ingestDelta(
    state,
    delta("vessels.urn:mrn:imo:mmsi:235900004", [
      { path: "mmsi", value: "235900004" },
      { path: "name", value: "Ferry Alpha" },
      {
        path: "navigation.position",
        value: { latitude: 50.01, longitude: -1 },
      },
      { path: "navigation.speedOverGround", value: 3 },
      { path: "navigation.courseOverGroundTrue", value: Math.PI },
    ]),
  );

  const target = calculateProjection(
    state,
    "2026-06-19T15:30:01.000Z",
  ).targets[0];

  assert.equal(Math.round((target.encounter.bearingTrue * 180) / Math.PI), 0);
  assert.equal(Math.round((target.encounter.bearingRelative * 180) / Math.PI), 270);
  assert.equal(target.encounter.ownHeadingTrue, Math.PI / 2);
});

test("Logger replay is explicit in the projection", () => {
  const state = createTrafficCore({ sessionId: "replay-session" });
  ingestDelta(
    state,
    delta("vessels.self", [
      {
        path: "plugins.ajrmMarineLogger.playback",
        value: { active: true, warmupActive: true },
      },
    ]),
  );
  const source = calculateProjection(state).source;
  assert.equal(source.ajrmMarineLoggerPlayback, true);
  assert.equal(source.ajrmMarineLoggerPlaybackWarmup, true);
});

test("stale own-vessel positions are not treated as fresh calculation input", () => {
  const state = createTrafficCore({
    sessionId: "stale-session",
    ownPositionMaxAgeSeconds: 30,
  });
  ingestDelta(
    state,
    delta(
      "vessels.self",
      [
        { path: "navigation.position", value: { latitude: 50, longitude: -1 } },
        { path: "navigation.speedOverGround", value: 2 },
        { path: "navigation.courseOverGroundTrue", value: 0 },
      ],
      "2026-06-20T06:00:00.000Z",
    ),
  );
  ingestDelta(
    state,
    delta(
      "vessels.urn:mrn:imo:mmsi:235900004",
      [
        {
          path: "navigation.position",
          value: { latitude: 50.01, longitude: -1 },
        },
      ],
      "2026-06-20T06:00:00.000Z",
    ),
  );
  const projection = calculateProjection(
    state,
    "2026-06-20T06:01:00.000Z",
  );
  assert.equal(projection.source.ownVesselPositionFresh, false);
  assert.equal(projection.source.ownVesselPositionAgeMs, 60000);
  assert.equal(projection.targets.length, 0);
});

test("fresh speed updates do not refresh an old own-vessel position", () => {
  const state = createTrafficCore({
    sessionId: "position-age-session",
    ownPositionMaxAgeSeconds: 30,
  });
  ingestDelta(
    state,
    delta(
      "vessels.self",
      [{ path: "navigation.position", value: { latitude: 50, longitude: -1 } }],
      "2026-06-20T06:00:00.000Z",
    ),
  );
  ingestDelta(
    state,
    delta(
      "vessels.self",
      [{ path: "navigation.speedOverGround", value: 2 }],
      "2026-06-20T06:01:00.000Z",
    ),
  );
  const projection = calculateProjection(
    state,
    "2026-06-20T06:01:00.000Z",
  );
  assert.equal(projection.source.ownVesselPositionFresh, false);
  assert.equal(projection.source.ownVesselPositionAgeMs, 60000);
});

test("AIS base stations and aids to navigation remain visible but non-collision", () => {
  const timestamp = "2026-06-20T06:00:00.000Z";
  const state = createTrafficCore({ sessionId: "classification-session" });
  ingestDelta(
    state,
    delta("vessels.self", [
      { path: "navigation.position", value: { latitude: 50, longitude: -1 } },
      { path: "navigation.speedOverGround", value: 2 },
      { path: "navigation.courseOverGroundTrue", value: 0 },
    ], timestamp),
  );
  ingestDelta(
    state,
    delta("vessels.urn:mrn:imo:mmsi:992359001", [
      { path: "mmsi", value: "992359001" },
      { path: "atonType", value: 1 },
      { path: "navigation.position", value: { latitude: 50.001, longitude: -1 } },
    ], timestamp),
  );
  const target = calculateProjection(
    state,
    "2026-06-20T06:00:01.000Z",
  ).targets[0];
  assert.equal(target.encounter.collisionCandidate, false);
  assert.equal(target.encounter.state, "normal");
  assert.equal(target.encounter.cpa, null);
});

test("closest approach input from other apps is ignored as AJRM Marine Traffic authority", () => {
  const timestamp = "2026-06-20T06:00:00.000Z";
  const state = createTrafficCore({ sessionId: "authority-session" });
  const context = "vessels.urn:mrn:imo:mmsi:235900004";
  ingestDelta(
    state,
    delta("vessels.self", [
      { path: "navigation.position", value: { latitude: 0, longitude: 0 } },
      { path: "navigation.speedOverGround", value: 1 },
      { path: "navigation.courseOverGroundTrue", value: 0 },
    ], timestamp),
  );
  ingestDelta(
    state,
    delta(context, [
      { path: "navigation.position", value: { latitude: 0.01, longitude: 0.01 } },
      { path: "navigation.speedOverGround", value: 1 },
      { path: "navigation.courseOverGroundTrue", value: Math.PI },
      {
        path: "navigation.closestApproach",
        value: { distance: 999999, timeTo: 999999, state: "normal" },
      },
    ], timestamp),
  );
  const target = calculateProjection(
    state,
    "2026-06-20T06:00:01.000Z",
  ).targets[0];
  assert.notEqual(target.encounter.cpa, 999999);
  assert.equal(target.comparison, undefined);
});

test("profile and target silence commands update Traffic projection state", () => {
  const timestamp = "2026-06-20T08:00:00.000Z";
  const state = createTrafficCore({
    sessionId: "command-session",
  });
  ingestDelta(
    state,
    delta("vessels.self", [
      { path: "navigation.position", value: { latitude: 50, longitude: -1 } },
    ], timestamp),
  );
  ingestDelta(
    state,
    delta("vessels.urn:mrn:imo:mmsi:235900004", [
      { path: "mmsi", value: "235900004" },
      { path: "name", value: "Ferry Alpha" },
      { path: "navigation.position", value: { latitude: 50.01, longitude: -1 } },
    ], timestamp),
  );
  assert.equal(setProfile(state, "coastal"), "coastal");
  assert.deepEqual(setTargetSilenced(state, "235900004", true), {
    id: "vessels.urn:mrn:imo:mmsi:235900004",
    mmsi: "235900004",
    name: "Ferry Alpha",
    silenced: true,
  });
  let projection = calculateProjection(state, "2026-06-20T08:00:01.000Z");
  assert.equal(projection.profile, "coastal");
  assert.equal(projection.targets[0].encounter.silenced, true);
  assert.equal(unsilenceAllTargets(state), 1);
  projection = calculateProjection(state, "2026-06-20T08:00:02.000Z");
  assert.equal(projection.targets[0].encounter.silenced, false);
});

test("unsupported profiles and missing silence targets are rejected", () => {
  const state = createTrafficCore();
  assert.throws(() => setProfile(state, "river"), /Unsupported profile/);
  assert.equal(setTargetSilenced(state, "missing", true), null);
});

test("profile sensitivity multipliers change Traffic CPA and TCPA evaluation", () => {
  const state = createTrafficCore({
    sessionId: "sensitivity-session",
    profile: "coastal",
    profileSettings: {
      coastal: { cpaSensitivity: 0, tcpaLookahead: 0 },
    },
  });
  const timestamp = "2026-06-20T10:00:00.000Z";
  ingestDelta(
    state,
    delta("vessels.self", [
      { path: "navigation.position", value: { latitude: 50, longitude: -1 } },
      { path: "navigation.speedOverGround", value: 4 },
      { path: "navigation.courseOverGroundTrue", value: 0 },
    ], timestamp),
  );
  ingestDelta(
    state,
    delta("vessels.urn:mrn:imo:mmsi:235900004", [
      { path: "mmsi", value: "235900004" },
      { path: "navigation.position", value: { latitude: 50.01, longitude: -1 } },
      { path: "navigation.speedOverGround", value: 4 },
      { path: "navigation.courseOverGroundTrue", value: Math.PI },
    ], timestamp),
  );
  const target = calculateProjection(
    state,
    "2026-06-20T10:00:01.000Z",
  ).targets[0];
  assert.equal(target.encounter.state, "normal");
});

test("Display-style NM CPA thresholds are normalized before Traffic evaluation", () => {
  const state = createTrafficCore({
    sessionId: "nm-profile-session",
    profile: "offshore",
    profileSettings: {
      offshore: {
        cpaSensitivity: 1,
        tcpaLookahead: 1,
        danger: {
          bySize: {
            large: { cpa: 1.5, tcpa: 900, speed: 0 },
          },
        },
        warning: {
          bySize: {
            large: { cpa: 3, tcpa: 1800, speed: 0 },
          },
        },
      },
    },
  });
  assert.equal(
    state.profileSettings.offshore.danger.bySize.large.cpa,
    1.5 * 1852,
  );
  const timestamp = "2026-06-22T09:30:00.000Z";
  ingestDelta(
    state,
    delta("vessels.self", [
      { path: "navigation.position", value: { latitude: 50, longitude: -1 } },
      { path: "navigation.speedOverGround", value: 4 },
      { path: "navigation.courseOverGroundTrue", value: 0 },
    ], timestamp),
  );
  ingestDelta(
    state,
    delta("vessels.urn:mrn:imo:mmsi:235900004", [
      { path: "mmsi", value: "235900004" },
      { path: "name", value: "Ferry Alpha" },
      { path: "navigation.position", value: { latitude: 50.01, longitude: -1 } },
      { path: "navigation.speedOverGround", value: 4 },
      { path: "navigation.courseOverGroundTrue", value: Math.PI },
      { path: "design.length", value: { overall: 96 } },
    ], timestamp),
  );
  const target = calculateProjection(
    state,
    "2026-06-22T09:30:01.000Z",
  ).targets[0];
  assert.equal(target.encounter.state, "alarm");
});

test("anchor top-level CPA thresholds are used when stale by-size CPA is zero", () => {
  const state = createTrafficCore({
    sessionId: "anchor-threshold-session",
    profile: "anchor",
    profileSettings: {
      anchor: {
        warning: {
          cpa: 1200,
          tcpa: 3600,
          speed: 0,
          bySize: {
            small: { cpa: 0, tcpa: 3600, speed: 0 },
            medium: { cpa: 0, tcpa: 3600, speed: 0 },
            large: { cpa: 0, tcpa: 3600, speed: 0 },
          },
        },
        danger: {
          cpa: 250,
          tcpa: 900,
          speed: 0,
          bySize: {
            small: { cpa: 0, tcpa: 3600, speed: 0 },
            medium: { cpa: 0, tcpa: 3600, speed: 0 },
            large: { cpa: 0, tcpa: 3600, speed: 0 },
          },
        },
      },
    },
  });
  const timestamp = "2026-06-26T18:52:00.000Z";
  ingestDelta(
    state,
    delta("vessels.self", [
      { path: "navigation.position", value: { latitude: 50, longitude: -1 } },
      { path: "navigation.speedOverGround", value: 0 },
      { path: "navigation.courseOverGroundTrue", value: 0 },
    ], timestamp),
  );
  ingestDelta(
    state,
    delta("vessels.urn:mrn:imo:mmsi:235900004", [
      { path: "mmsi", value: "235900004" },
      { path: "name", value: "Ferry Alpha" },
      { path: "navigation.position", value: { latitude: 50.003, longitude: -1 } },
      { path: "navigation.speedOverGround", value: 4 },
      { path: "navigation.courseOverGroundTrue", value: Math.PI },
      { path: "design.length", value: { overall: 96 } },
    ], timestamp),
  );
  const target = calculateProjection(
    state,
    "2026-06-26T18:52:01.000Z",
  ).targets[0];
  assert.equal(target.encounter.state, "alarm");
});

test("profile per-size thresholds change Traffic CPA and TCPA evaluation", () => {
  const state = createTrafficCore({
    sessionId: "threshold-session",
    profile: "coastal",
    profileSettings: {
      coastal: {
        warning: {
          bySize: {
            small: { cpa: 10, tcpa: 60, speed: 0 },
            medium: { cpa: 10, tcpa: 60, speed: 0 },
            large: { cpa: 10, tcpa: 60, speed: 0 },
          },
        },
        danger: {
          bySize: {
            small: { cpa: 5, tcpa: 30, speed: 0 },
            medium: { cpa: 5, tcpa: 30, speed: 0 },
            large: { cpa: 5, tcpa: 30, speed: 0 },
          },
        },
      },
    },
  });
  const timestamp = "2026-06-20T10:00:00.000Z";
  ingestDelta(
    state,
    delta("vessels.self", [
      { path: "navigation.position", value: { latitude: 50, longitude: -1 } },
      { path: "navigation.speedOverGround", value: 4 },
      { path: "navigation.courseOverGroundTrue", value: 0 },
    ], timestamp),
  );
  ingestDelta(
    state,
    delta("vessels.urn:mrn:imo:mmsi:235900004", [
      { path: "mmsi", value: "235900004" },
      { path: "navigation.position", value: { latitude: 50.01, longitude: -1 } },
      { path: "navigation.speedOverGround", value: 4 },
      { path: "navigation.courseOverGroundTrue", value: Math.PI },
    ], timestamp),
  );
  const target = calculateProjection(
    state,
    "2026-06-20T10:00:01.000Z",
  ).targets[0];
  assert.equal(target.encounter.state, "normal");
});
