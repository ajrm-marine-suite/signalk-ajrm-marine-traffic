"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  bearingDegrees,
  closestApproach,
  distanceMeters,
  hullDimensions,
} = require("../plugin/lib/navigation");

test("calculates range and bearing from standard Signal K positions", () => {
  const own = { latitude: 53, longitude: -4 };
  const north = { latitude: 53.1, longitude: -4 };
  assert.ok(distanceMeters(own, north) > 11000);
  assert.equal(Math.round(bearingDegrees(own, north)), 0);
});

test("calculates point and conservative hull-aware CPA", () => {
  const own = {
    position: { latitude: 0, longitude: 0 },
    sog: 1,
    cogTrue: 0,
  };
  const target = {
    position: { latitude: 1000 / 111120, longitude: 1000 / 111120 },
    sog: 1,
    cogTrue: Math.PI,
    headingTrue: (3 * Math.PI) / 2,
    length: 200,
    beam: 40,
  };
  const result = closestApproach(own, target);
  assert.ok(Math.abs(result.tcpa - 500) <= 1);
  assert.ok(Math.abs(result.gpsCpa - 1000) <= 1);
  assert.equal(result.cpaReference, "hull");
  assert.ok(result.cpa < result.gpsCpa);
});

test("reported AIS offsets are distinguished from conservative estimates", () => {
  assert.equal(
    hullDimensions({
      length: 100,
      beam: 20,
      headingTrue: 0,
      fromBow: 70,
      fromCenter: 2,
    }).reference,
    "reported",
  );
  assert.equal(
    hullDimensions({ length: 100, beam: 20, headingTrue: 0 }).reference,
    "estimated",
  );
});
