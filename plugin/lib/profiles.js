"use strict";

const { METERS_PER_NM } = require("./navigation");

const PROFILES = {
  anchor: {
    warning: { cpa: 0, tcpa: 3600, speed: 0 },
    danger: { cpa: 0, tcpa: 3600, speed: 0 },
  },
  harbor: {
    warning: {
      small: { cpa: 50, tcpa: 180, speed: 0.5 },
      medium: { cpa: 100, tcpa: 240, speed: 0.5 },
      large: { cpa: 200, tcpa: 360, speed: 0.5 },
    },
    danger: {
      small: { cpa: 25, tcpa: 60, speed: 3 },
      medium: { cpa: 50, tcpa: 120, speed: 3 },
      large: { cpa: 100, tcpa: 180, speed: 3 },
    },
  },
  coastal: {
    warning: {
      small: { cpa: 0.4 * METERS_PER_NM, tcpa: 600, speed: 0 },
      medium: { cpa: 0.8 * METERS_PER_NM, tcpa: 900, speed: 0 },
      large: { cpa: 1.5 * METERS_PER_NM, tcpa: 1200, speed: 0 },
    },
    danger: {
      small: { cpa: 0.15 * METERS_PER_NM, tcpa: 300, speed: 0.5 },
      medium: { cpa: 0.4 * METERS_PER_NM, tcpa: 480, speed: 0.5 },
      large: { cpa: 0.8 * METERS_PER_NM, tcpa: 720, speed: 0.5 },
    },
  },
  offshore: {
    warning: {
      small: { cpa: 0.5 * METERS_PER_NM, tcpa: 720, speed: 0 },
      medium: { cpa: 1.25 * METERS_PER_NM, tcpa: 1200, speed: 0 },
      large: { cpa: 3 * METERS_PER_NM, tcpa: 1800, speed: 0 },
    },
    danger: {
      small: { cpa: 0.2 * METERS_PER_NM, tcpa: 360, speed: 0 },
      medium: { cpa: 0.6 * METERS_PER_NM, tcpa: 600, speed: 0 },
      large: { cpa: 1.5 * METERS_PER_NM, tcpa: 900, speed: 0 },
    },
  },
};

const PROFILE_NAMES = ["anchor", "harbor", "coastal", "offshore"];
const VESSEL_SIZES = ["small", "medium", "large"];

function normalizeProfileSettings(value = {}, current = "harbor") {
  const settings = {
    current: PROFILE_NAMES.includes(value.current) ? value.current : current,
  };
  for (const profile of PROFILE_NAMES) {
    const defaults = defaultProfileSettings(profile);
    const supplied = value[profile] || {};
    settings[profile] = {
      cpaSensitivity: nonNegative(supplied.cpaSensitivity, 1),
      tcpaLookahead: nonNegative(supplied.tcpaLookahead, 1),
      repeatSensitivity: nonNegative(supplied.repeatSensitivity, 1),
      warning: normalizeCriteria(supplied.warning, defaults.warning),
      danger: normalizeCriteria(supplied.danger, defaults.danger),
    };
  }
  return settings;
}

function vesselSize(target) {
  const length = Number(target?.length);
  if (!Number.isFinite(length)) return "small";
  if (length <= 15) return "small";
  if (length <= 50) return "medium";
  return "large";
}

function stateFor(target, profileName = "harbor", profileSettings = {}) {
  if (/^(970|972|974)/.test(String(target?.mmsi || ""))) return "emergency";
  const profile =
    normalizeProfileSettings(profileSettings, profileName)[profileName] ||
    defaultProfileSettings(profileName);
  const sensitivity = normalizeProfileSettings(profileSettings, profileName)[
    profileName
  ];
  const size = vesselSize(target);
  const danger = scaledCriteria(
    profile.danger?.bySize?.[size] || profile.danger?.[size] || profile.danger,
    sensitivity,
  );
  const warning = scaledCriteria(
    profile.warning?.bySize?.[size] ||
      profile.warning?.[size] ||
      profile.warning,
    sensitivity,
  );
  const speedKnots =
    Math.max(Number(target?.sog) || 0, Number(target?.ownSog) || 0) *
    1.9438444924406046;
  if (matches(target, danger, speedKnots)) return "alarm";
  if (matches(target, warning, speedKnots)) return "warn";
  return "normal";
}

function scaledCriteria(criteria, sensitivity) {
  if (!criteria) return criteria;
  return {
    ...criteria,
    cpa: Number(criteria.cpa) * sensitivity.cpaSensitivity,
    tcpa: Number(criteria.tcpa) * sensitivity.tcpaLookahead,
  };
}

function defaultProfileSettings(profileName) {
  return normalizeProfileCriteria(PROFILES[profileName] || PROFILES.harbor);
}

function normalizeProfileCriteria(profile = {}) {
  return {
    warning: normalizeCriteria(profile.warning, {}),
    danger: normalizeCriteria(profile.danger, {}),
  };
}

function normalizeCriteria(value = {}, fallback = {}) {
  const base = {
    cpa: normalizeCpa(value.cpa, nonNegative(fallback.cpa, 0)),
    tcpa: nonNegative(value.tcpa, nonNegative(fallback.tcpa, 0)),
    speed: nonNegative(value.speed, nonNegative(fallback.speed, 0)),
  };
  const bySize = {};
  for (const size of VESSEL_SIZES) {
    const supplied =
      value.bySize?.[size] || value[size] || fallback.bySize?.[size] || fallback[size] || {};
    const suppliedFallback = fallback.bySize?.[size] || fallback[size] || {};
    bySize[size] = {
      cpa: normalizeCpa(supplied.cpa, nonNegative(suppliedFallback.cpa, base.cpa)),
      tcpa: nonNegative(supplied.tcpa, base.tcpa),
      speed: nonNegative(supplied.speed, base.speed),
    };
  }
  return { ...base, bySize };
}

function normalizeCpa(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  if (number === 0) return 0;

  // AJRM Marine Display and older AJRM Marine profile editors expose CPA in NM,
  // while Traffic Core evaluates CPA in metres. Accept those NM-shaped values
  // at the command/config boundary so a saved "1.5 NM" threshold does not
  // become an unusable "1.5 m" threshold.
  if (fallback >= METERS_PER_NM && number <= 20) {
    return number * METERS_PER_NM;
  }
  if (fallback > 0 && fallback < METERS_PER_NM && number < 1) {
    return number * METERS_PER_NM;
  }
  return number;
}

function nonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function matches(target, criteria, speedKnots) {
  return (
    criteria &&
    Number(target?.cpa) < Number(criteria.cpa) &&
    Number(target?.tcpa) > 0 &&
    Number(target?.tcpa) < Number(criteria.tcpa) &&
    (Number(criteria.speed) === 0 || speedKnots > Number(criteria.speed))
  );
}

module.exports = {
  PROFILE_NAMES,
  PROFILES,
  VESSEL_SIZES,
  defaultProfileSettings,
  normalizeProfileSettings,
  stateFor,
  vesselSize,
};
