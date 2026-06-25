"use strict";

const METERS_PER_NM = 1852;
const EARTH_RADIUS_METERS = 6371000;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validPosition(position) {
  return (
    Number.isFinite(position?.latitude) &&
    Number.isFinite(position?.longitude) &&
    Math.abs(position.latitude) <= 90 &&
    Math.abs(position.longitude) <= 180
  );
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function distanceMeters(left, right) {
  if (!validPosition(left) || !validPosition(right)) return null;
  const dLat = toRadians(right.latitude - left.latitude);
  const dLon = toRadians(right.longitude - left.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(left.latitude)) *
      Math.cos(toRadians(right.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees(left, right) {
  if (!validPosition(left) || !validPosition(right)) return null;
  let dLon = toRadians(right.longitude - left.longitude);
  const dPhi = Math.log(
    Math.tan(toRadians(right.latitude) / 2 + Math.PI / 4) /
      Math.tan(toRadians(left.latitude) / 2 + Math.PI / 4),
  );
  if (Math.abs(dLon) > Math.PI) {
    dLon = dLon > 0 ? -(2 * Math.PI - dLon) : 2 * Math.PI + dLon;
  }
  return (toDegrees(Math.atan2(dLon, dPhi)) + 360) % 360;
}

function project(referenceLatitude, vessel) {
  if (!validPosition(vessel?.position)) return null;
  const sog = finite(vessel.sog);
  const cog = finite(vessel.cogTrue);
  return {
    x:
      vessel.position.longitude *
      111120 *
      Math.cos(toRadians(referenceLatitude)),
    y: vessel.position.latitude * 111120,
    vx: sog !== null && cog !== null ? sog * Math.sin(cog) : null,
    vy: sog !== null && cog !== null ? sog * Math.cos(cog) : null,
  };
}

function hullDimensions(target) {
  const length = positive(target.length) || assumedLength(target.aisClass);
  const beam = positive(target.beam) || (length ? length * 0.15 : null);
  const heading = finite(target.headingTrue) ?? finite(target.cogTrue);
  if (!length || !beam || heading === null) return null;
  const reported =
    positive(target.fromBow) &&
    positive(length - target.fromBow) &&
    Number.isFinite(target.fromCenter);
  return {
    length,
    beam,
    heading,
    toBow: reported ? target.fromBow : length,
    toStern: reported ? length - target.fromBow : length,
    toPort: reported ? beam / 2 + target.fromCenter : beam,
    toStarboard: reported ? beam / 2 - target.fromCenter : beam,
    reference: reported ? "reported" : "estimated",
  };
}

function assumedLength(aisClass) {
  if (String(aisClass || "").toUpperCase() === "A") return 70;
  if (String(aisClass || "").toUpperCase() === "B") return 10;
  return 15;
}

function positive(value) {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}

function pointToHullDistance(point, targetPoint, dimensions) {
  if (!dimensions) return null;
  const dx = point.x - targetPoint.x;
  const dy = point.y - targetPoint.y;
  const stbd = dx * Math.cos(dimensions.heading) - dy * Math.sin(dimensions.heading);
  const fwd = dx * Math.sin(dimensions.heading) + dy * Math.cos(dimensions.heading);
  const outsideX = Math.max(
    -dimensions.toPort - stbd,
    0,
    stbd - dimensions.toStarboard,
  );
  const outsideY = Math.max(
    -dimensions.toStern - fwd,
    0,
    fwd - dimensions.toBow,
  );
  return Math.sqrt(outsideX ** 2 + outsideY ** 2);
}

function closestApproach(own, target, { hullAware = true } = {}) {
  if (!validPosition(own?.position) || !validPosition(target?.position)) {
    return emptyClosestApproach();
  }
  const ownVector = project(own.position.latitude, own);
  const targetVector = project(own.position.latitude, target);
  if (
    ![ownVector.vx, ownVector.vy, targetVector.vx, targetVector.vy].every(
      Number.isFinite,
    )
  ) {
    return emptyClosestApproach();
  }
  const dv = {
    x: targetVector.vx - ownVector.vx,
    y: targetVector.vy - ownVector.vy,
  };
  const speedSquared = dv.x ** 2 + dv.y ** 2;
  if (speedSquared < 0.00000001) {
    return emptyClosestApproach();
  }
  const separation = {
    x: targetVector.x - ownVector.x,
    y: targetVector.y - ownVector.y,
  };
  const tcpa = -(separation.x * dv.x + separation.y * dv.y) / speedSquared;
  if (!tcpa || tcpa < 0 || tcpa > 3 * 3600) {
    return emptyClosestApproach();
  }
  const ownAtCpa = {
    x: ownVector.x + tcpa * ownVector.vx,
    y: ownVector.y + tcpa * ownVector.vy,
  };
  const targetAtCpa = {
    x: targetVector.x + tcpa * targetVector.vx,
    y: targetVector.y + tcpa * targetVector.vy,
  };
  const gpsCpa = Math.round(
    Math.hypot(ownAtCpa.x - targetAtCpa.x, ownAtCpa.y - targetAtCpa.y),
  );
  const cpaBearingTrue =
    (Math.atan2(targetAtCpa.x - ownAtCpa.x, targetAtCpa.y - ownAtCpa.y) +
      Math.PI * 2) %
    (Math.PI * 2);
  const dimensions = hullDimensions(target);
  const hullCpa = hullAware
    ? pointToHullDistance(ownAtCpa, targetAtCpa, dimensions)
    : null;
  return {
    cpa: Number.isFinite(hullCpa) ? Math.round(hullCpa) : gpsCpa,
    tcpa: Math.round(tcpa),
    gpsCpa,
    cpaReference: Number.isFinite(hullCpa) ? "hull" : "gps",
    cpaBearingTrue,
    dimensions,
  };
}

function emptyClosestApproach() {
  return {
    cpa: null,
    tcpa: null,
    gpsCpa: null,
    cpaReference: null,
    cpaBearingTrue: null,
  };
}

module.exports = {
  METERS_PER_NM,
  bearingDegrees,
  closestApproach,
  distanceMeters,
  hullDimensions,
  validPosition,
};
