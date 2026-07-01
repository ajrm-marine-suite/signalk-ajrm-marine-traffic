"use strict";

const UNDERWAY_NAVIGATION_STATES = new Set([
  "sailing",
  "motoring",
  "underway",
  "under way",
  "under-way",
  "underwayusingengine",
  "underwayusingengines",
  "under way using engine",
  "under-way-using-engine",
  "under way using engines",
  "under-way-using-engines",
]);

const STATIONARY_NAVIGATION_STATES = new Set([
  "anchored",
  "moored",
  "not-under-way",
  "not under way",
  "not underway",
  "stopped",
  "aground",
]);

function voyageStateProjection({
  sessionId,
  sequence,
  profile,
  own = {},
  thresholdMps,
  generatedAt = new Date().toISOString(),
} = {}) {
  const sogMps = finiteOrNull(own.sog);
  const stwMps = finiteOrNull(own.stw);
  const effective = effectiveSpeed({ sogMps, stwMps });
  const navigationState = normalizeNavigationState(own.navigationState);
  const stateUnderway = UNDERWAY_NAVIGATION_STATES.has(navigationState);
  const stateStationary = STATIONARY_NAVIGATION_STATES.has(navigationState);
  const movingBySpeed =
    effective.speedMps !== null && effective.speedMps >= Number(thresholdMps || 0);
  const stationaryBySpeed =
    effective.speedMps !== null && effective.speedMps < Number(thresholdMps || 0);
  const onPassage = movingBySpeed || (effective.speedMps === null && stateUnderway);
  const motion = onPassage
    ? "moving"
    : stationaryBySpeed || stateStationary
      ? "stationary"
      : "unknown";
  return {
    contract: "ajrm-marine-traffic-voyage-state",
    contractVersion: 1,
    sessionId,
    sequence,
    generatedAt,
    mode: "traffic",
    authoritative: true,
    profile,
    onPassage,
    motion,
    source: movingBySpeed || stationaryBySpeed ? effective.source : stateUnderway || stateStationary ? "navigation.state" : "unknown",
    thresholdMps: Number(thresholdMps || 0),
    sogMps,
    stwMps,
    effectiveSpeedMps: effective.speedMps,
    navigationState: navigationState || null,
  };
}

function effectiveSpeed({ sogMps, stwMps } = {}) {
  if (sogMps === null && stwMps === null) {
    return { speedMps: null, source: "unknown" };
  }
  if (sogMps !== null && stwMps !== null) {
    return sogMps >= stwMps
      ? { speedMps: sogMps, source: "sog" }
      : { speedMps: stwMps, source: "stw" };
  }
  return sogMps !== null
    ? { speedMps: sogMps, source: "sog" }
    : { speedMps: stwMps, source: "stw" };
}

function normalizeNavigationState(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/\s*-\s*/g, "-");
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = {
  effectiveSpeed,
  normalizeNavigationState,
  voyageStateProjection,
};
