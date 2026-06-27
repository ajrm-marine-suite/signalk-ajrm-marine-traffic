"use strict";

const { randomUUID } = require("node:crypto");
const {
  bearingDegrees,
  closestApproach,
  distanceMeters,
  validPosition,
} = require("./navigation");
const {
  normalizeProfileSettings,
  stateFor,
  vesselSize,
} = require("./profiles");

function createTrafficCore(options = {}) {
  const sessionId = options.sessionId || randomUUID();
  const profile = ["anchor", "harbor", "coastal", "offshore"].includes(
    options.profile,
  )
    ? options.profile
    : "harbor";
  return {
    sessionId,
    profile,
    profileSettings: normalizeProfileSettings(options.profileSettings, profile),
    sequence: 0,
    own: createVessel("vessels.self"),
    targets: new Map(),
    correlations: new Map(),
    silencedTargets: new Set(),
    ajrmMarineLoggerPlayback: false,
    ajrmMarineLoggerPlaybackWarmup: false,
    ownPositionMaxAgeSeconds: finiteOrDefault(
      options.ownPositionMaxAgeSeconds,
      30,
    ),
  };
}

function ingestDelta(state, delta) {
  let changed = false;
  const context = String(delta?.context || "");
  for (const update of delta?.updates || []) {
    const timestamp = update.timestamp || new Date().toISOString();
    for (const item of update.values || []) {
      if (item.path === "plugins.ajrmMarineLogger.playback") {
        const next = item.value === true || item.value?.active === true;
        const nextWarmup = item.value?.warmupActive === true;
        changed = next !== state.ajrmMarineLoggerPlayback
          || nextWarmup !== state.ajrmMarineLoggerPlaybackWarmup
          || changed;
        state.ajrmMarineLoggerPlayback = next;
        state.ajrmMarineLoggerPlaybackWarmup = nextWarmup;
        continue;
      }
      const isSelf =
        context === "vessels.self" ||
        item.path?.startsWith("plugins.") ||
        context === state.own.context;
      if (!isVesselInputPath(item.path)) continue;
      const vessel = isSelf
        ? state.own
        : targetForContext(state, context || String(item.value?.mmsi || ""));
      changed = applyValue(vessel, item.path, item.value, timestamp) || changed;
    }
  }
  return changed;
}

function calculateProjection(state, now = new Date().toISOString()) {
  const targets = [];
  const ownVesselPositionFresh = isOwnPositionFresh(state, now);
  if (ownVesselPositionFresh) {
    for (const target of state.targets.values()) {
      if (!validPosition(target.position)) continue;
      const range = Math.round(distanceMeters(state.own.position, target.position));
      const bearing = Math.round(bearingDegrees(state.own.position, target.position)) % 360;
      const cpa = closestApproach(state.own, target, { hullAware: true });
      const ownHeading = finiteOrNull(state.own.headingTrue) ?? finiteOrNull(state.own.cogTrue);
      const collisionCandidate = isCollisionCandidate(target);
      const calculated = {
        ...target,
        range,
        bearing,
        bearingRelative:
          ownHeading === null ? null : normalizeRadians((bearing * Math.PI) / 180 - ownHeading),
        cpaBearingRelative:
          ownHeading === null || !Number.isFinite(cpa.cpaBearingTrue)
            ? null
            : normalizeRadians(cpa.cpaBearingTrue - ownHeading),
        cpa: collisionCandidate ? cpa.cpa : null,
        tcpa: collisionCandidate ? cpa.tcpa : null,
        gpsCpa: collisionCandidate ? cpa.gpsCpa : null,
        cpaReference: collisionCandidate ? cpa.cpaReference : null,
        dimensions: cpa.dimensions,
        ownSog: state.own.sog,
        ownCogTrue: state.own.cogTrue,
        ownHeadingTrue: state.own.headingTrue,
        collisionCandidate,
      };
      calculated.state = collisionCandidate
        ? stateFor(calculated, state.profile, state.profileSettings)
        : "normal";
      calculated.uiOrder = uiOrder(calculated);
      calculated.correlationId =
        state.correlations.get(target.context) || randomUUID();
      state.correlations.set(target.context, calculated.correlationId);
      targets.push(
        projectTarget(
          calculated,
          now,
          state.silencedTargets.has(target.mmsi || target.context),
        ),
      );
    }
  }
  targets.sort(
    (left, right) =>
      left.encounter.uiOrder - right.encounter.uiOrder ||
      left.name.localeCompare(right.name),
  );
  state.sequence += 1;
  return {
    contract: "ajrm-marine-traffic-targets",
    contractVersion: 1,
    sessionId: state.sessionId,
    sequence: state.sequence,
    generatedAt: now,
    mode: "engine",
    authoritative: true,
    profile: state.profile,
    profileSettings: {
      ...state.profileSettings,
      current: state.profile,
    },
    source: {
      ajrmMarineLoggerPlayback: state.ajrmMarineLoggerPlayback,
      ajrmMarineLoggerPlaybackWarmup: state.ajrmMarineLoggerPlaybackWarmup,
      ownVesselPositionFresh,
      ownVesselPositionAgeMs: ageMs(state.own.positionUpdatedAt, now),
      ownVesselPositionMaxAgeSeconds: state.ownPositionMaxAgeSeconds,
    },
    targets,
  };
}

function projectTarget(target, now, silenced = false) {
  const updatedAt = target.updatedAt || now;
  const ageMs = Math.max(0, Date.parse(now) - Date.parse(updatedAt));
  return {
    id: target.context || `urn:mrn:imo:mmsi:${target.mmsi}`,
    mmsi: target.mmsi || "",
    name: target.name || target.mmsi || target.context || "Unknown",
    position: { ...target.position },
    navigation: {
      sog: finiteOrNull(target.sog),
      cogTrue: finiteOrNull(target.cogTrue),
      headingTrue: finiteOrNull(target.headingTrue),
    },
    dimensions: target.dimensions
      ? {
          length: target.dimensions.length,
          beam: target.dimensions.beam,
          reference: target.dimensions.reference,
        }
      : null,
    encounter: {
      range: target.range,
      bearingTrue: (target.bearing * Math.PI) / 180,
      bearingRelative: finiteOrNull(target.bearingRelative),
      cpaBearingRelative: finiteOrNull(target.cpaBearingRelative),
      cpa: target.cpa,
      gpsCpa: target.gpsCpa,
      cpaReference: target.cpaReference,
      tcpa: target.tcpa,
      state: target.state,
      uiOrder: target.uiOrder,
      silenced,
      correlationId: target.correlationId,
      vesselSize: vesselSize(target),
      ownSog: finiteOrNull(target.ownSog),
      ownCogTrue: finiteOrNull(target.ownCogTrue),
      ownHeadingTrue: finiteOrNull(target.ownHeadingTrue),
      targetSog: finiteOrNull(target.sog),
      targetCogTrue: finiteOrNull(target.cogTrue),
      collisionCandidate: target.collisionCandidate,
    },
    freshness: {
      updatedAt,
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
      stale: Number.isFinite(ageMs) ? ageMs > 10 * 60 * 1000 : true,
    },
  };
}

function uiOrder(target) {
  const rank = {
    emergency: 0,
    alarm: 10000,
    warn: 20000,
    alert: 30000,
    normal: 40000,
  }[target.state] ?? 40000;
  return (
    rank +
    (Number.isFinite(target.tcpa) ? Math.min(9999, target.tcpa) : 9999) +
    (Number.isFinite(target.range) ? Math.round(target.range / 1852) : 9999)
  );
}

function targetForContext(state, context) {
  if (!state.targets.has(context)) {
    state.targets.set(context, createVessel(context));
  }
  return state.targets.get(context);
}

function createVessel(context) {
  return {
    context,
    mmsi: context.split(":").at(-1) || "",
    name: "",
    position: null,
    positionUpdatedAt: null,
    sog: null,
    cogTrue: null,
    headingTrue: null,
    length: null,
    beam: null,
    fromBow: null,
    fromCenter: null,
    aisClass: "",
    atonType: null,
    updatedAt: null,
  };
}

function isVesselInputPath(path) {
  return [
    "mmsi",
    "",
    "name",
    "navigation.position",
    "navigation.speedOverGround",
    "navigation.courseOverGroundTrue",
    "navigation.headingTrue",
    "design.length",
    "design.beam",
    "design.aisShipDimensions",
    "sensors.ais.class",
    "sensors.ais.fromBow",
    "sensors.ais.fromCenter",
    "atonType",
  ].includes(path);
}

function applyValue(vessel, path, rawValue, timestamp) {
  const value = rawValue?.value ?? rawValue;
  switch (path) {
    case "":
      if (value && typeof value === "object") {
        if (value.name != null) vessel.name = String(value.name);
        if (value.mmsi != null) vessel.mmsi = String(value.mmsi);
      }
      break;
    case "mmsi":
      vessel.mmsi = String(value || vessel.mmsi);
      break;
    case "name":
      vessel.name = String(value || "");
      break;
    case "navigation.position":
      vessel.position =
        value && Number.isFinite(Number(value.latitude)) && Number.isFinite(Number(value.longitude))
          ? { latitude: Number(value.latitude), longitude: Number(value.longitude) }
          : null;
      vessel.positionUpdatedAt = timestamp;
      break;
    case "navigation.speedOverGround":
      vessel.sog = finiteOrNull(value);
      break;
    case "navigation.courseOverGroundTrue":
      vessel.cogTrue = finiteOrNull(value);
      break;
    case "navigation.headingTrue":
      vessel.headingTrue = finiteOrNull(value);
      break;
    case "design.length":
      vessel.length = finiteOrNull(value?.overall ?? value);
      break;
    case "design.beam":
      vessel.beam = finiteOrNull(value);
      break;
    case "design.aisShipDimensions":
      vessel.length = finiteOrNull(value?.length) ?? vessel.length;
      vessel.beam = finiteOrNull(value?.beam) ?? vessel.beam;
      break;
    case "sensors.ais.class":
      vessel.aisClass = String(value || "");
      break;
    case "sensors.ais.fromBow":
      vessel.fromBow = finiteOrNull(value);
      break;
    case "sensors.ais.fromCenter":
      vessel.fromCenter = finiteOrNull(value);
      break;
    case "atonType":
      vessel.atonType = value;
      break;
    default:
      return false;
  }
  vessel.updatedAt = timestamp;
  return true;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRadians(value) {
  if (!Number.isFinite(value)) return null;
  return ((value % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

function isCollisionCandidate(target) {
  const mmsi = String(target?.mmsi || "");
  const aisClass = String(target?.aisClass || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (/^00\d{7}$/.test(mmsi) || aisClass === "base" || aisClass === "basestation") {
    return false;
  }
  if (
    /^99\d{7}$/.test(mmsi) ||
    target?.atonType != null ||
    ["aton", "aidtonavigation", "aidstonavigation"].includes(aisClass)
  ) {
    return false;
  }
  return true;
}

function finiteOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function ageMs(updatedAt, now) {
  const age = Date.parse(now) - Date.parse(updatedAt || 0);
  return Number.isFinite(age) ? Math.max(0, age) : null;
}

function isOwnPositionFresh(state, now) {
  const age = ageMs(state.own.positionUpdatedAt, now);
  return (
    validPosition(state.own.position) &&
    age !== null &&
    age <= state.ownPositionMaxAgeSeconds * 1000
  );
}

function setProfile(state, profile) {
  if (!["anchor", "harbor", "coastal", "offshore"].includes(profile)) {
    throw new Error(`Unsupported profile: ${profile}`);
  }
  state.profile = profile;
  state.profileSettings.current = profile;
  return state.profile;
}

function setProfileSettings(state, settings) {
  state.profileSettings = normalizeProfileSettings(
    settings,
    state.profile,
  );
  if (settings?.current !== undefined) {
    setProfile(state, state.profileSettings.current);
  }
  return state.profileSettings;
}

function setTargetSilenced(state, identity, silenced) {
  const key = String(identity || "");
  const target = Array.from(state.targets.values()).find(
    (candidate) =>
      candidate.mmsi === key ||
      candidate.context === key ||
      candidate.context.endsWith(`:mmsi:${key}`),
  );
  if (!target) return null;
  const targetKey = target.mmsi || target.context;
  if (silenced) state.silencedTargets.add(targetKey);
  else state.silencedTargets.delete(targetKey);
  return {
    id: target.context,
    mmsi: target.mmsi || "",
    name: target.name || target.mmsi || target.context,
    silenced: Boolean(silenced),
  };
}

function unsilenceAllTargets(state) {
  const count = state.silencedTargets.size;
  state.silencedTargets.clear();
  return count;
}

module.exports = {
  ageMs,
  calculateProjection,
  createTrafficCore,
  ingestDelta,
  isOwnPositionFresh,
  isCollisionCandidate,
  isVesselInputPath,
  setProfile,
  setProfileSettings,
  setTargetSilenced,
  unsilenceAllTargets,
};
