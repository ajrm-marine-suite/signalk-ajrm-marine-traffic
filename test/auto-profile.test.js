"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createAutoProfileState,
  evaluateAutoProfile,
  normalizeAutoProfileOptions,
} = require("../plugin/lib/auto-profile");

const harbour = {
  id: "oban",
  name: "Harbour: Oban",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-5.48, 56.4],
        [-5.46, 56.4],
        [-5.46, 56.42],
        [-5.48, 56.42],
        [-5.48, 56.4],
      ],
    ],
  },
};

test("Auto Profile enters harbour and uses exit hysteresis", () => {
  const options = normalizeAutoProfileOptions({
    enterDistanceMeters: 50,
    exitDistanceMeters: 100,
  });
  let state = createAutoProfileState();
  let result = evaluateAutoProfile({
    currentProfile: "coastal",
    options,
    ownPosition: { latitude: 56.41, longitude: -5.47 },
    ownSog: 1,
    regions: [harbour],
    state,
  });
  assert.equal(result.profile, "harbor");
  assert.equal(result.changed, true);
  assert.equal(result.state.insideRegionName, "Harbour: Oban");
  state = result.state;

  result = evaluateAutoProfile({
    currentProfile: "harbor",
    options,
    ownPosition: { latitude: 56.4205, longitude: -5.47 },
    ownSog: 1,
    regions: [harbour],
    state,
  });
  assert.equal(result.profile, "harbor");

  result = evaluateAutoProfile({
    currentProfile: "harbor",
    options,
    ownPosition: { latitude: 56.423, longitude: -5.47 },
    ownSog: 1,
    regions: [harbour],
    state: result.state,
  });
  assert.equal(result.profile, "coastal");
});

test("Auto Profile holds Anchor until own vessel exceeds release speed", () => {
  const options = normalizeAutoProfileOptions({
    outsideProfile: "offshore",
    anchorReleaseSpeed: 0.5,
  });
  const state = createAutoProfileState();
  const held = evaluateAutoProfile({
    currentProfile: "anchor",
    options,
    ownPosition: null,
    ownSog: 0.2,
    state,
  });
  assert.equal(held.profile, "anchor");
  assert.equal(held.state.anchorHeld, true);

  const released = evaluateAutoProfile({
    currentProfile: "anchor",
    options,
    ownPosition: null,
    ownSog: 0.8,
    state: held.state,
  });
  assert.equal(released.profile, "offshore");
  assert.equal(released.state.anchorHeld, false);
});

test("Auto Profile falls back to outside profile when harbour regions are unavailable", () => {
  const options = normalizeAutoProfileOptions({
    outsideProfile: "coastal",
  });
  const state = createAutoProfileState();
  state.regionsLoadedAt = "2026-06-22T09:29:00.000Z";
  const result = evaluateAutoProfile({
    currentProfile: "offshore",
    options,
    ownPosition: { latitude: 56.41, longitude: -5.47 },
    ownSog: 5,
    regions: [],
    state,
    now: "2026-06-22T09:30:00.000Z",
  });

  assert.equal(result.profile, "coastal");
  assert.equal(result.changed, true);
  assert.equal(
    result.state.lastMessage,
    "Auto selected outside profile because no harbour regions are available.",
  );
});

test("Auto Profile waits for harbour regions before selecting outside profile", () => {
  const options = normalizeAutoProfileOptions({
    outsideProfile: "coastal",
  });
  const result = evaluateAutoProfile({
    currentProfile: "harbor",
    options,
    ownPosition: { latitude: 56.41, longitude: -5.47 },
    ownSog: 5,
    regions: [],
    state: createAutoProfileState(),
    now: "2026-06-22T09:30:00.000Z",
  });

  assert.equal(result.profile, "harbor");
  assert.equal(result.changed, false);
  assert.equal(
    result.state.lastMessage,
    "Auto Profile Switch waiting for harbour regions.",
  );
});

test("Auto Profile clears waiting status after harbour regions load", () => {
  const options = normalizeAutoProfileOptions({
    outsideProfile: "coastal",
  });
  const waiting = evaluateAutoProfile({
    currentProfile: "harbor",
    options,
    ownPosition: { latitude: 56.41, longitude: -5.47 },
    ownSog: 5,
    regions: [],
    state: createAutoProfileState(),
    now: "2026-06-22T09:30:00.000Z",
  });
  const state = {
    ...waiting.state,
    regionsLoadedAt: "2026-06-22T09:30:05.000Z",
  };
  const loaded = evaluateAutoProfile({
    currentProfile: "harbor",
    options,
    ownPosition: { latitude: 56.41, longitude: -5.47 },
    ownSog: 5,
    regions: [
      {
        id: "oban",
        name: "Harbour: Oban",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-5.48, 56.4],
              [-5.46, 56.4],
              [-5.46, 56.42],
              [-5.48, 56.42],
              [-5.48, 56.4],
            ],
          ],
        },
      },
    ],
    state,
    now: "2026-06-22T09:30:06.000Z",
  });

  assert.equal(loaded.profile, "harbor");
  assert.equal(loaded.changed, false);
  assert.equal(loaded.state.lastMessage, null);
  assert.equal(loaded.state.nearestRegionName, "Harbour: Oban");
});

test("Auto Profile validates exit distance above enter distance", () => {
  const options = normalizeAutoProfileOptions({
    enterDistanceMeters: 120,
    exitDistanceMeters: 20,
  });
  assert.ok(options.exitDistanceMeters > options.enterDistanceMeters);
});
