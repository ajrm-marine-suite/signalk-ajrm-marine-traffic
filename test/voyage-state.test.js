"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { voyageStateProjection } = require("../plugin/lib/voyage-state");

test("voyage state treats speed through water as on passage when SOG is unavailable", () => {
  const projection = voyageStateProjection({
    sessionId: "traffic-session",
    sequence: 2,
    profile: "coastal",
    thresholdMps: 0.35,
    own: {
      sog: null,
      stw: 0.6,
      navigationState: "",
    },
    generatedAt: "2026-07-01T12:00:00.000Z",
  });

  assert.equal(projection.contract, "ajrm-marine-traffic-voyage-state");
  assert.equal(projection.onPassage, true);
  assert.equal(projection.motion, "moving");
  assert.equal(projection.source, "stw");
  assert.equal(projection.effectiveSpeedMps, 0.6);
});

test("voyage state references standard navigation state when speed is unavailable", () => {
  const projection = voyageStateProjection({
    profile: "coastal",
    thresholdMps: 0.35,
    own: {
      sog: null,
      stw: null,
      navigationState: "motoring",
    },
  });

  assert.equal(projection.onPassage, true);
  assert.equal(projection.motion, "moving");
  assert.equal(projection.source, "navigation.state");
  assert.equal(projection.navigationState, "motoring");
});

test("voyage state distinguishes known stationary from unknown", () => {
  const moored = voyageStateProjection({
    profile: "harbor",
    thresholdMps: 0.35,
    own: { navigationState: "moored" },
  });
  const unknown = voyageStateProjection({
    profile: "coastal",
    thresholdMps: 0.35,
    own: {},
  });

  assert.equal(moored.onPassage, false);
  assert.equal(moored.motion, "stationary");
  assert.equal(moored.source, "navigation.state");
  assert.equal(unknown.onPassage, false);
  assert.equal(unknown.motion, "unknown");
});
