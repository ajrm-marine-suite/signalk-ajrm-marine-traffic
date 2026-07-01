"use strict";

const {
  clearedStationaryAutomuteState,
  manualStationaryAutomuteOverrideState,
  stationaryAutomuteProfileAllowed,
  stationaryAutomuteStationaryState,
  stationaryAutomuteStatusText,
  stationaryAutomuteTransition,
} = require("./stationary-automute");

const DEFAULT_AUTOMUTE_STATIONARY_SPEED = 0.35;
const DEFAULT_ALL_WELL_MESSAGE = "All's well.";
const DEFAULT_ALL_WELL_INTERVAL_MINUTES = 30;

function createAudioPolicy(options = {}) {
  return {
    muted: options.muted === true,
    automuteStationary: options.automuteStationary !== false,
    automuteStationarySpeed: normalizeSpeed(options.automuteStationarySpeed),
    allWellEnabled: options.allWellEnabled !== false,
    allWellMessage: normalizeAllWellMessage(options.allWellMessage),
    allWellIntervalMinutes: normalizeAllWellIntervalMinutes(
      options.allWellIntervalMinutes,
    ),
    automuteState: clearedStationaryAutomuteState(),
    correlationId: null,
    updatedAt: null,
  };
}

function evaluateAudioPolicy(
  policy,
  profile,
  ownSog,
  { force = false, ownStw, profileSettings } = {},
) {
  const transition = stationaryAutomuteTransition({
    currentProfile: profile,
    force,
    profileSettings,
    selfTarget: { sog: ownSog, stw: ownStw },
    settings: policy,
    state: policy.automuteState,
    threshold: policy.automuteStationarySpeed,
  });
  policy.automuteState = transition.state;
  if (transition.action) policy.muted = transition.action.muted;
  return transition.action;
}

function applyAudioPolicyCommand(policy, command = {}) {
  if (typeof command.automuteStationary === "boolean") {
    policy.automuteStationary = command.automuteStationary;
  }
  if (command.automuteStationarySpeed !== undefined) {
    policy.automuteStationarySpeed = normalizeSpeed(
      command.automuteStationarySpeed,
    );
  }
  if (typeof command.muted === "boolean") {
    policy.muted = command.muted;
    const stationary = stationaryAutomuteStationaryState({
      selfTarget: { sog: command.ownSog, stw: command.ownStw },
      threshold: policy.automuteStationarySpeed,
    });
    policy.automuteState = manualStationaryAutomuteOverrideState({
      state: policy.automuteState,
      stationary,
    });
  }
  if (typeof command.allWellEnabled === "boolean") {
    policy.allWellEnabled = command.allWellEnabled;
  }
  if (command.allWellMessage !== undefined) {
    policy.allWellMessage = normalizeAllWellMessage(command.allWellMessage);
  }
  if (command.allWellIntervalMinutes !== undefined) {
    policy.allWellIntervalMinutes = normalizeAllWellIntervalMinutes(
      command.allWellIntervalMinutes,
    );
  }
  return policy;
}

function audioPolicyProjection({
  sessionId,
  sequence,
  correlationId,
  mode,
  authoritative,
  profile,
  ownSog,
  ownStw,
  policy,
  profileSettings,
  generatedAt = new Date().toISOString(),
}) {
  const stationary = stationaryAutomuteStationaryState({
    selfTarget: { sog: ownSog, stw: ownStw },
    threshold: policy.automuteStationarySpeed,
  });
  const automuteAllowed = stationaryAutomuteProfileAllowed(
    profile,
    profileSettings,
  );
  return {
    contract: "ajrm-marine-traffic-audio-policy",
    contractVersion: 1,
    sessionId,
    sequence,
    correlationId,
    generatedAt,
    mode,
    authoritative: authoritative === true,
    muted: policy.muted,
    automuteStationary: policy.automuteStationary,
    automuteStationarySpeed: policy.automuteStationarySpeed,
    allWellEnabled: policy.allWellEnabled,
    allWellMessage: policy.allWellMessage,
    allWellIntervalMinutes: policy.allWellIntervalMinutes,
    automuteAllowed,
    automaticMuteActive: policy.automuteState.automaticMuteActive === true,
    manualOverride: policy.automuteState.manualOverride === true,
    stationary,
    profile,
    status: stationaryAutomuteStatusText({
      automuteAllowed,
      settings: policy,
      state: policy.automuteState,
      stationary,
    }),
  };
}

function normalizeSpeed(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? number
    : DEFAULT_AUTOMUTE_STATIONARY_SPEED;
}

function normalizeAllWellMessage(value) {
  const message = String(value ?? "").trim();
  return message ? message.slice(0, 160) : DEFAULT_ALL_WELL_MESSAGE;
}

function normalizeAllWellIntervalMinutes(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1
    ? Math.min(240, Math.round(number))
    : DEFAULT_ALL_WELL_INTERVAL_MINUTES;
}

module.exports = {
  DEFAULT_ALL_WELL_INTERVAL_MINUTES,
  DEFAULT_ALL_WELL_MESSAGE,
  DEFAULT_AUTOMUTE_STATIONARY_SPEED,
  applyAudioPolicyCommand,
  audioPolicyProjection,
  createAudioPolicy,
  evaluateAudioPolicy,
};
