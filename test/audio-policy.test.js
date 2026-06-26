"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyAudioPolicyCommand,
  audioPolicyProjection,
  createAudioPolicy,
  evaluateAudioPolicy,
} = require("../plugin/lib/audio-policy");
const { normalizeProfileSettings } = require("../plugin/lib/profiles");

test("stationary automute is limited to Anchor and Harbour profiles", () => {
  const policy = createAudioPolicy({
    automuteStationary: true,
    automuteStationarySpeed: 0.35,
  });
  assert.deepEqual(evaluateAudioPolicy(policy, "harbor", 0), { muted: true });
  assert.equal(policy.muted, true);
  assert.deepEqual(evaluateAudioPolicy(policy, "coastal", 0), { muted: false });
  assert.equal(policy.muted, false);
});

test("profile settings default stationary automute by sailing profile", () => {
  const profiles = normalizeProfileSettings();

  assert.equal(profiles.anchor.automuteStationary, true);
  assert.equal(profiles.harbor.automuteStationary, true);
  assert.equal(profiles.coastal.automuteStationary, false);
  assert.equal(profiles.offshore.automuteStationary, false);
});

test("stationary automute follows per-profile settings", () => {
  const policy = createAudioPolicy({
    automuteStationary: true,
    automuteStationarySpeed: 0.35,
  });
  const profileSettings = {
    anchor: { automuteStationary: false },
    harbor: { automuteStationary: true },
    coastal: { automuteStationary: true },
    offshore: { automuteStationary: false },
  };

  assert.equal(
    evaluateAudioPolicy(policy, "anchor", 0, { profileSettings }),
    null,
  );
  assert.equal(policy.muted, false);
  assert.deepEqual(evaluateAudioPolicy(policy, "coastal", 0, { profileSettings }), {
    muted: true,
  });
  assert.equal(policy.muted, true);
});

test("stationary automute immediately releases on movement", () => {
  const policy = createAudioPolicy({
    automuteStationary: true,
    automuteStationarySpeed: 0.35,
  });
  evaluateAudioPolicy(policy, "harbor", 0);
  assert.equal(policy.muted, true);
  assert.deepEqual(evaluateAudioPolicy(policy, "harbor", 0.8), {
    muted: false,
  });
  assert.equal(policy.muted, false);
});

test("stationary automute adopts inherited stationary mute after restart", () => {
  const policy = createAudioPolicy({
    automuteStationary: true,
    automuteStationarySpeed: 0.35,
    muted: true,
  });

  assert.equal(evaluateAudioPolicy(policy, "harbor", 0), null);
  assert.equal(policy.muted, true);
  assert.equal(policy.automuteState.automaticMuteActive, true);
  assert.deepEqual(evaluateAudioPolicy(policy, "harbor", 0.8), {
    muted: false,
  });
  assert.equal(policy.muted, false);
});

test("stationary automute releases inherited mute when profile leaves harbour", () => {
  const policy = createAudioPolicy({
    automuteStationary: true,
    automuteStationarySpeed: 0.35,
    muted: true,
  });

  assert.equal(evaluateAudioPolicy(policy, "harbor", 0), null);
  assert.equal(policy.automuteState.automaticMuteActive, true);
  assert.deepEqual(evaluateAudioPolicy(policy, "coastal", 0.8), {
    muted: false,
  });
  assert.equal(policy.muted, false);
});

test("stationary automute does not announce unmute on first moving sample", () => {
  const policy = createAudioPolicy({
    automuteStationary: true,
    automuteStationarySpeed: 0.35,
  });

  assert.equal(evaluateAudioPolicy(policy, "harbor", 0.8), null);
  assert.equal(policy.muted, false);
  assert.equal(policy.automuteState.automaticMuteActive, false);
});

test("stationary automute does not release manual mute on first moving sample", () => {
  const policy = createAudioPolicy({
    automuteStationary: true,
    automuteStationarySpeed: 0.35,
    muted: true,
  });

  assert.equal(evaluateAudioPolicy(policy, "harbor", 0.8), null);
  assert.equal(policy.muted, true);
  assert.equal(policy.automuteState.automaticMuteActive, false);
});

test("manual mute override persists until stationary state changes", () => {
  const policy = createAudioPolicy({
    automuteStationary: true,
    automuteStationarySpeed: 0.35,
  });
  evaluateAudioPolicy(policy, "harbor", 0);
  applyAudioPolicyCommand(policy, { muted: false, ownSog: 0 });
  assert.equal(policy.muted, false);
  assert.equal(policy.automuteState.manualOverride, true);
  assert.equal(evaluateAudioPolicy(policy, "harbor", 0), null);
  assert.equal(policy.muted, false);
  assert.equal(evaluateAudioPolicy(policy, "harbor", 0.8), null);
  assert.equal(evaluateAudioPolicy(policy, "harbor", 0.8), null);
  assert.equal(evaluateAudioPolicy(policy, "harbor", 0.8), null);
  assert.equal(policy.automuteState.manualOverride, false);
});

test("Audio Policy projection carries session, sequence and correlation", () => {
  const policy = createAudioPolicy({
    muted: true,
    allWellEnabled: true,
    allWellMessage: "Still looking good.",
    allWellIntervalMinutes: 45,
  });
  const projection = audioPolicyProjection({
    sessionId: "engine-session",
    sequence: 4,
    correlationId: "mute-transition",
    mode: "engine",
    authoritative: true,
    profile: "harbor",
    ownSog: 0,
    policy,
    generatedAt: "2026-06-20T12:00:00.000Z",
  });
  assert.equal(projection.contract, "ais-plus-engine-audio-policy");
  assert.equal(projection.sessionId, "engine-session");
  assert.equal(projection.sequence, 4);
  assert.equal(projection.correlationId, "mute-transition");
  assert.equal(projection.authoritative, true);
  assert.equal(projection.muted, true);
  assert.equal(projection.allWellEnabled, true);
  assert.equal(projection.allWellMessage, "Still looking good.");
  assert.equal(projection.allWellIntervalMinutes, 45);
});

test("Audio Policy projection reports per-profile automute allowance", () => {
  const policy = createAudioPolicy({ automuteStationary: true });
  const projection = audioPolicyProjection({
    profile: "anchor",
    ownSog: 0,
    policy,
    profileSettings: {
      anchor: { automuteStationary: false },
    },
  });

  assert.equal(projection.automuteAllowed, false);
  assert.match(projection.status, /disabled for this profile/);
});

test("Audio Policy enables stationary automute and All's well by default", () => {
  const policy = createAudioPolicy();

  assert.equal(policy.automuteStationary, true);
  assert.equal(policy.allWellEnabled, true);
});

test("Audio Policy allows stationary automute and All's well to be disabled", () => {
  const policy = createAudioPolicy({
    automuteStationary: false,
    allWellEnabled: false,
  });

  assert.equal(policy.automuteStationary, false);
  assert.equal(policy.allWellEnabled, false);
});

test("Audio Policy normalizes All's well command settings", () => {
  const policy = createAudioPolicy();

  applyAudioPolicyCommand(policy, {
    allWellEnabled: true,
    allWellMessage: "  Crew reassurance.  ",
    allWellIntervalMinutes: 12.4,
  });

  assert.equal(policy.allWellEnabled, true);
  assert.equal(policy.allWellMessage, "Crew reassurance.");
  assert.equal(policy.allWellIntervalMinutes, 12);

  applyAudioPolicyCommand(policy, {
    allWellMessage: "",
    allWellIntervalMinutes: -1,
  });

  assert.equal(policy.allWellMessage, "All's well.");
  assert.equal(policy.allWellIntervalMinutes, 30);
});
