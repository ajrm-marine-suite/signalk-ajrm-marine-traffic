"use strict";

const { nearestHarbourRegion } = require("./harbour-region-loader");

const PROFILES = ["anchor", "harbor", "coastal", "offshore"];
const DEFAULT_AUTO_PROFILE_OPTIONS = {
  enabled: true,
  harbourRegionNamePrefix: "Harbour:",
  harbourProfile: "harbor",
  outsideProfile: "coastal",
  anchorReleaseSpeed: 3 * 0.514444,
  enterDistanceMeters: 50,
  exitDistanceMeters: 100,
  refreshRegionsSeconds: 60,
};

function normalizeAutoProfileOptions(raw = {}) {
  const enterDistanceMeters = nonNegative(
    raw.enterDistanceMeters,
    DEFAULT_AUTO_PROFILE_OPTIONS.enterDistanceMeters,
  );
  let exitDistanceMeters = nonNegative(
    raw.exitDistanceMeters,
    DEFAULT_AUTO_PROFILE_OPTIONS.exitDistanceMeters,
  );
  if (exitDistanceMeters <= enterDistanceMeters) {
    exitDistanceMeters = Math.max(
      DEFAULT_AUTO_PROFILE_OPTIONS.exitDistanceMeters,
      enterDistanceMeters + 1,
    );
  }
  return {
    enabled: raw.enabled !== false,
    harbourRegionNamePrefix:
      String(raw.harbourRegionNamePrefix || "").trim() ||
      DEFAULT_AUTO_PROFILE_OPTIONS.harbourRegionNamePrefix,
    harbourProfile: profileOrDefault(
      raw.harbourProfile,
      DEFAULT_AUTO_PROFILE_OPTIONS.harbourProfile,
    ),
    outsideProfile: profileOrDefault(
      raw.outsideProfile,
      DEFAULT_AUTO_PROFILE_OPTIONS.outsideProfile,
    ),
    anchorReleaseSpeed: nonNegative(
      raw.anchorReleaseSpeed,
      DEFAULT_AUTO_PROFILE_OPTIONS.anchorReleaseSpeed,
    ),
    enterDistanceMeters,
    exitDistanceMeters,
    refreshRegionsSeconds: Math.max(
      10,
      nonNegative(
        raw.refreshRegionsSeconds,
        DEFAULT_AUTO_PROFILE_OPTIONS.refreshRegionsSeconds,
      ),
    ),
  };
}

function createAutoProfileState() {
  return {
    regions: [],
    regionsLoadedAt: null,
    insideRegionId: null,
    insideRegionName: null,
    nearestRegionId: null,
    nearestRegionName: null,
    distanceMeters: null,
    anchorHeld: false,
    lastProfileSet: null,
    lastProfileChangeTs: null,
    lastMessage: null,
    lastWarning: null,
    lastError: null,
  };
}

function evaluateAutoProfile({
  currentProfile,
  options,
  ownPosition,
  ownSog,
  regions = [],
  state,
  now = new Date().toISOString(),
}) {
  const next = { ...state };
  let selectedProfile = currentProfile;
  let changed = false;

  if (!options.enabled) {
    next.anchorHeld = false;
    return result(selectedProfile, changed, next);
  }

  if (currentProfile === "anchor") {
    const speed = Number(ownSog);
    next.anchorHeld =
      !Number.isFinite(speed) || speed <= options.anchorReleaseSpeed;
    if (next.anchorHeld) return result(selectedProfile, changed, next);
    selectedProfile = options.outsideProfile;
    changed = selectedProfile !== currentProfile;
    applySelection(next, selectedProfile, options, now);
  } else {
    next.anchorHeld = false;
  }

  if (!validPosition(ownPosition)) {
    Object.assign(next, {
      insideRegionId: null,
      insideRegionName: null,
      nearestRegionId: null,
      nearestRegionName: null,
      distanceMeters: null,
      lastMessage: null,
    });
    return result(selectedProfile, changed, next);
  }
  if (!Array.isArray(regions) || regions.length === 0) {
    if (!state.regionsLoadedAt) {
      Object.assign(next, {
        insideRegionId: null,
        insideRegionName: null,
        nearestRegionId: null,
        nearestRegionName: null,
        distanceMeters: null,
        lastMessage: state.lastError
          ? null
          : "Auto Profile Switch waiting for harbour regions.",
      });
      return result(selectedProfile, changed, next);
    }
    Object.assign(next, {
      insideRegionId: null,
      insideRegionName: null,
      nearestRegionId: null,
      nearestRegionName: null,
      distanceMeters: null,
    });
    if (selectedProfile !== options.outsideProfile) {
      selectedProfile = options.outsideProfile;
      changed = true;
      applySelection(next, selectedProfile, options, now);
      next.lastMessage =
        "Auto selected outside profile because no harbour regions are available.";
    }
    return result(selectedProfile, changed, next);
  }
  const nearest = nearestHarbourRegion({
    lat: ownPosition.latitude,
    lon: ownPosition.longitude,
    harbourRegions: regions,
  });
  if (!nearest) {
    Object.assign(next, {
      insideRegionId: null,
      insideRegionName: null,
      nearestRegionId: null,
      nearestRegionName: null,
      distanceMeters: null,
      lastMessage: null,
    });
    return result(selectedProfile, changed, next);
  }

  const inside = Number(nearest.distanceMeters) <= 0;
  Object.assign(next, {
    insideRegionId: inside ? nearest.id : null,
    insideRegionName: inside ? nearest.name : null,
    nearestRegionId: nearest.id,
    nearestRegionName: nearest.name,
    distanceMeters: Math.round(nearest.distanceMeters),
    lastMessage: null,
  });

  if (nearest.distanceMeters <= options.enterDistanceMeters) {
    if (selectedProfile !== options.harbourProfile) {
      selectedProfile = options.harbourProfile;
      changed = true;
      applySelection(next, selectedProfile, options, now);
    }
  } else if (
    selectedProfile === options.harbourProfile &&
    nearest.distanceMeters > options.exitDistanceMeters
  ) {
    selectedProfile = options.outsideProfile;
    changed = true;
    applySelection(next, selectedProfile, options, now);
  }
  return result(selectedProfile, changed, next);
}

function autoProfileProjection({
  sessionId,
  sequence,
  profile,
  options,
  state,
  generatedAt = new Date().toISOString(),
}) {
  return {
    contract: "ajrm-marine-traffic-auto-profile",
    contractVersion: 1,
    sessionId,
    sequence,
    generatedAt,
    enabled: options.enabled,
    profile,
    settings: { ...options },
    status: autoProfileStatus(profile, options, state),
    regionCount: state.regions.length,
    regionsLoadedAt: state.regionsLoadedAt,
    insideRegionId: state.insideRegionId,
    insideRegionName: state.insideRegionName,
    nearestRegionId: state.nearestRegionId,
    nearestRegionName: state.nearestRegionName,
    distanceMeters: state.distanceMeters,
    anchorHeld: state.anchorHeld,
    lastProfileSet: state.lastProfileSet,
    lastProfileChangeTs: state.lastProfileChangeTs,
    lastError: state.lastError,
  };
}

function autoProfileStatus(profile, options, state) {
  if (!options.enabled) return state.lastWarning || "Auto selection OFF.";
  if (state.lastError) return `Auto Profile Switch unavailable: ${state.lastError}`;
  if (profile === "anchor" && state.anchorHeld) {
    return `Anchored selected. AJRM Marine will switch to ${profileLabel(options.outsideProfile)} when SOG exceeds ${(options.anchorReleaseSpeed / 0.514444).toFixed(1)} knots.`;
  }
  if (state.lastMessage) return state.lastMessage;
  if (profile === options.harbourProfile) {
    return "Harbour profile active. Auto Profile Switch will select the outside profile when leaving the harbour area.";
  }
  if (state.nearestRegionName && Number.isFinite(state.distanceMeters)) {
    return `Auto Profile Switch ON. Nearest harbour: ${stripHarbourPrefix(state.nearestRegionName)}, ${state.distanceMeters} m away.`;
  }
  return "Auto Profile Switch ON.";
}

function applySelection(state, profile, options, now) {
  state.lastProfileSet = profile;
  state.lastProfileChangeTs = now;
  state.lastMessage =
    profile === options.harbourProfile && state.nearestRegionName
      ? `Auto selected Harbour: ${stripHarbourPrefix(state.nearestRegionName)}.`
      : `Auto selected ${profileLabel(profile)}.`;
}

function result(profile, changed, state) {
  return { profile, changed, state };
}

function profileLabel(profile) {
  return (
    { anchor: "Anchored", harbor: "Harbour", coastal: "Coastal", offshore: "Offshore" }[
      profile
    ] || profile
  );
}

function stripHarbourPrefix(name) {
  return String(name || "").replace(/^Harbour:\s*/i, "");
}

function profileOrDefault(value, fallback) {
  return PROFILES.includes(value) ? value : fallback;
}

function nonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function validPosition(position) {
  return (
    Number.isFinite(Number(position?.latitude)) &&
    Number.isFinite(Number(position?.longitude))
  );
}

module.exports = {
  DEFAULT_AUTO_PROFILE_OPTIONS,
  PROFILES,
  autoProfileProjection,
  createAutoProfileState,
  evaluateAutoProfile,
  normalizeAutoProfileOptions,
  profileLabel,
};
