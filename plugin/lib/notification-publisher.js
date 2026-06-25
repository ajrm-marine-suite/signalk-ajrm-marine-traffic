"use strict";

const { randomUUID } = require("node:crypto");

const ACTIVE_STATES = new Set(["alert", "warn", "alarm", "emergency"]);
const DEFAULT_VISUAL_REFRESH_MS = 15000;

function createNotificationPublisher(options = {}) {
  return {
    providerSessionId: options.providerSessionId || options.sessionId || randomUUID(),
    sourceSequence: 0,
    revision: 0,
    active: new Map(),
    distanceUnit: normalizeDistanceUnit(options.distanceUnit),
    visualRefreshMs: finiteOrDefault(
      options.visualRefreshMs,
      DEFAULT_VISUAL_REFRESH_MS,
    ),
  };
}

function reconcileNotifications(runtime, projection, now = new Date().toISOString()) {
  const outputs = [];
  const visible = new Set();

  for (const target of projection?.targets || []) {
    if (!target?.encounter?.collisionCandidate) continue;
    const identity = target.mmsi || target.id;
    if (!identity) continue;
    const path = notificationPath(identity);
    const state = standardState(target.encounter.state);
    visible.add(path);

    if (target.encounter.silenced || !ACTIVE_STATES.has(state)) {
      clearIfActive(runtime, path, outputs, now);
      continue;
    }

    const previous = runtime.active.get(path);
    const message = encounterMessage(target, state, runtime);
    const name = String(target.name || identity);
    const nowMs = Date.parse(now) || 0;
    const metadataChanged = previous && previous.name !== name;
    const visualRefreshDue =
      previous &&
      previous.message !== message &&
      nowMs - previous.publishedAtMs >= runtime.visualRefreshMs;
    if (previous?.state === state && !metadataChanged && !visualRefreshDue) {
      continue;
    }

    runtime.sourceSequence += 1;
    runtime.revision = Math.max(runtime.revision + 1, nowMs);
    const subjectKey = `ais-plus:vessel:${identity}`;
    const correlationId =
      target.encounter.correlationId || previous?.correlationId || randomUUID();
    const level = priorityLevel(state);
    const eventId = `engine-collision-${sanitizePathSegment(identity)}-${runtime.sourceSequence}`;
    const isVisualRevision = previous?.state === state;
    const methods =
      isVisualRevision || state === "alert" ? ["visual"] : ["visual", "sound"];

    outputs.push({
      path,
      value: {
        id: eventId,
        state,
        method: methods,
        message,
        data: {
          category: "cpa",
          alarmState: state,
          vesselName: target.name || identity,
          mmsi: target.mmsi || "",
          targetContext: target.id || "",
          ajrmMarineNotifications: {
            schemaVersion: 1,
            provider: "ais-plus-engine",
            providerSessionId: runtime.providerSessionId,
            sourceSequence: runtime.sourceSequence,
            correlationId,
            subjectKey,
            eventId,
            revision: runtime.revision,
            lifecycle: "active",
            timestamp: now,
            priority: {
              level,
              score: priorityScore(level),
            },
            supersedes: [],
            history: { policy: "on-resolve" },
            delivery: {
              visual: true,
              audio: methods.includes("sound"),
              preempt:
                !isVisualRevision &&
                (state === "alarm" || state === "emergency"),
              localPlayback: true,
              streamOutput: true,
              muteState:
                typeof runtime.muteState === "boolean" ? runtime.muteState : null,
              repeatSeconds: 0,
              expiresSeconds: 90,
            },
            presentation: {
              title: String(target.name || identity),
              label: stateLabel(state),
              message,
              category: "cpa",
              facts: [
                target.encounter.vesselSize || "",
                Number.isFinite(target.encounter.bearingRelative)
                  ? `${clockPosition(target.encounter.bearingRelative)} o'clock`
                  : "",
              ].filter(Boolean),
            },
            actions: [
              {
                id: "silence",
                label: "Silence",
                command: "ais-plus-engine.silence-target",
                parameters: { mmsi: String(target.mmsi || identity) },
              },
            ],
            context: {
              mmsi: String(target.mmsi || ""),
              targetContext: String(target.id || ""),
            },
          },
        },
      },
    });
    runtime.active.set(path, {
      state,
      correlationId,
      eventId,
      subjectKey,
      identity,
      message,
      name,
      publishedAtMs: nowMs,
    });
  }

  for (const path of runtime.active.keys()) {
    if (!visible.has(path)) clearIfActive(runtime, path, outputs, now);
  }
  return outputs;
}

function clearAllNotifications(runtime, now = new Date().toISOString()) {
  const outputs = [];
  for (const path of runtime.active.keys()) {
    clearIfActive(runtime, path, outputs, now);
  }
  return outputs;
}

function systemEventNotification(runtime, event = {}, now = new Date().toISOString()) {
  runtime.sourceSequence += 1;
  const nowMs = Date.parse(now) || Date.now();
  runtime.revision = Math.max(runtime.revision + 1, nowMs);
  const key = sanitizePathSegment(event.key || event.label || "system");
  const eventId = `engine-system-${key}-${runtime.sourceSequence}`;
  const subjectKey = `ais-plus:system:${key}`;
  const message = String(event.message || "");
  const title = String(event.title || "Traffic Core");
  const label = String(event.label || "System");
  const category = String(event.category || "system");
  const audio = event.audio !== false;

  return {
    path: `notifications.system.ajrmMarineTraffic.${key}`,
    value: {
      id: eventId,
      state: "alert",
      method: audio ? ["visual", "sound"] : ["visual"],
      message,
      data: {
        category,
        ajrmMarineNotifications: {
          schemaVersion: 1,
          provider: "ais-plus-engine",
          providerSessionId: runtime.providerSessionId,
          sourceSequence: runtime.sourceSequence,
          correlationId: event.correlationId || randomUUID(),
          subjectKey,
          eventId,
          revision: runtime.revision,
          lifecycle: "event",
          timestamp: now,
          priority: {
            level: "information",
            score: 200,
          },
          supersedes: Array.isArray(event.supersedes)
            ? event.supersedes.map((value) => String(value || "")).filter(Boolean)
            : [],
          history: { policy: "always" },
          delivery: {
            visual: true,
            audio,
            preempt: false,
            localPlayback: true,
            streamOutput: true,
            muteState:
              typeof runtime.muteState === "boolean" ? runtime.muteState : null,
            repeatSeconds: 0,
            expiresSeconds: Number.isFinite(event.expiresSeconds)
              ? event.expiresSeconds
              : 90,
          },
          presentation: {
            title,
            label,
            message,
            category,
            facts: Array.isArray(event.facts) ? event.facts : [],
          },
          actions: [],
          context: event.context || {},
        },
      },
    },
  };
}

function clearIfActive(runtime, path, outputs, now = new Date().toISOString()) {
  if (!runtime.active.has(path)) return;
  const previous = runtime.active.get(path);
  runtime.sourceSequence += 1;
  const nowMs = Date.parse(now) || Date.now();
  runtime.revision = Math.max(runtime.revision + 1, nowMs);
  outputs.push({
    path,
    value: {
      id: previous.eventId || `engine-clear-${sanitizePathSegment(previous.identity)}`,
      state: "normal",
      method: [],
      message: "",
      data: {
        category: "cpa",
        alarmState: "normal",
        vesselName: previous.name || "",
        mmsi: String(previous.identity || ""),
        ajrmMarineNotifications: {
          schemaVersion: 1,
          provider: "ais-plus-engine",
          providerSessionId: runtime.providerSessionId,
          sourceSequence: runtime.sourceSequence,
          correlationId: previous.correlationId || randomUUID(),
          subjectKey:
            previous.subjectKey || `ais-plus:vessel:${previous.identity || "unknown"}`,
          eventId:
            previous.eventId || `engine-clear-${sanitizePathSegment(previous.identity)}`,
          revision: runtime.revision,
          lifecycle: "resolved",
          timestamp: now,
          priority: { level: "information", score: 200 },
          supersedes: [],
          history: { policy: "on-resolve" },
          delivery: {
            visual: false,
            audio: false,
            preempt: false,
            localPlayback: false,
            streamOutput: false,
            muteState: null,
            repeatSeconds: 0,
            expiresSeconds: 0,
          },
          presentation: {
            title: previous.name || "",
            label: "Resolved",
            message: "",
            category: "cpa",
            facts: [],
          },
          actions: [],
          context: {
            mmsi: String(previous.identity || ""),
            targetContext: "",
          },
        },
      },
    },
  });
  runtime.active.delete(path);
}

function notificationPath(identity) {
  return `notifications.collision.${sanitizePathSegment(identity)}`;
}

function sanitizePathSegment(value) {
  return String(value || "unknown").replace(/[^A-Za-z0-9_-]+/g, "_");
}

function standardState(value) {
  const state = String(value || "").toLowerCase();
  return ACTIVE_STATES.has(state) ? state : "normal";
}

function priorityLevel(state) {
  if (state === "emergency") return "emergency";
  if (state === "alarm") return "danger";
  if (state === "warn") return "warning";
  return "information";
}

function priorityScore(level) {
  if (level === "emergency") return 1000;
  if (level === "danger") return 800;
  if (level === "warning") return 500;
  return 200;
}

function stateLabel(state) {
  if (state === "emergency") return "Emergency";
  if (state === "alarm") return "Collision alarm";
  if (state === "warn") return "Traffic advisory";
  return "Watch";
}

function encounterMessage(target, state, runtime = {}) {
  const size =
    target.encounter.vesselSize === "large"
      ? "Large vessel"
      : target.encounter.vesselSize === "medium"
        ? "Medium vessel"
        : "Small craft";
  const name = target.name || target.mmsi || "unknown vessel";
  const parts = [`${stateLabel(state)}. ${size} ${name}`];
  if (Number.isFinite(target.encounter.bearingRelative)) {
    parts[0] += ` at ${clockPosition(target.encounter.bearingRelative)} o'clock`;
  } else if (Number.isFinite(target.encounter.bearingTrue)) {
    parts[0] += ` at ${clockPosition(target.encounter.bearingTrue)} o'clock true`;
  }
  const geometry = encounterGeometryPhrase(target, state);
  if (geometry) {
    parts.push(geometry);
  }
  if (Number.isFinite(target.encounter.cpa) && Number.isFinite(target.encounter.tcpa)) {
    parts.push(
      `CPA ${distanceText(target.encounter.cpa, runtime.distanceUnit)} in ${timeText(target.encounter.tcpa)}`,
    );
  }
  return `${parts.join(". ")}.`;
}

function encounterGeometryPhrase(target, state) {
  const passType = passTypeLabel(target);
  if (!passType) return "";
  if (passType === "collision") return "Risk of collision";
  if (passType === "close-quarters") return "Close quarters";
  const phrase = {
    ahead: "CPA will be ahead",
    behind: "CPA will be astern",
    starboard: "CPA will be on your starboard side",
    port: "CPA will be on your port side",
  }[passType];
  if (!phrase) return "";
  const overtaking = overtakingPhrase(target, passType);
  const advisory =
    state === "alarm" || state === "emergency" ? collisionPrompt(target, passType) : "";
  return [overtaking, phrase, advisory].filter(Boolean).join(". ");
}

function passTypeLabel(target) {
  const cpa = Number(target?.encounter?.cpa);
  if (Number.isFinite(cpa)) {
    if (cpa <= 20) return "collision";
    if (cpa <= 50) return "close-quarters";
  }
  const relative = radiansToDegrees(target?.encounter?.cpaBearingRelative);
  if (relative !== null) {
    if (relative >= 45 && relative < 135) return "starboard";
    if (relative >= 135 && relative < 225) return "behind";
    if (relative >= 225 && relative < 315) return "port";
    return "ahead";
  }
  const bearing = radiansToDegrees(target?.encounter?.bearingRelative);
  if (bearing === null) return "";
  return bearing >= 270 || bearing < 90 ? "ahead" : "behind";
}

function overtakingPhrase(target, passType) {
  if (!["ahead", "behind", "port", "starboard"].includes(passType)) return "";
  const ownSog = Number(target?.encounter?.ownSog);
  const targetSog = Number(target?.encounter?.targetSog);
  const ownCourse = Number(target?.encounter?.ownCogTrue);
  const targetCourse = Number(target?.encounter?.targetCogTrue);
  if (
    !Number.isFinite(ownSog) ||
    !Number.isFinite(targetSog) ||
    !Number.isFinite(ownCourse) ||
    !Number.isFinite(targetCourse) ||
    courseDifferenceDegrees(ownCourse, targetCourse) > 45
  ) {
    return "";
  }
  const bearing = radiansToDegrees(target?.encounter?.bearingRelative);
  const targetAhead = bearing === null || bearing <= 90 || bearing >= 270;
  const targetAstern = bearing !== null && bearing >= 90 && bearing <= 270;
  if (ownSog > targetSog && targetAhead) return "You are overtaking it";
  if (targetSog > ownSog && targetAstern) return "It is overtaking you";
  return "Same general course";
}

function collisionPrompt(target, passType) {
  if (["port", "starboard", "ahead", "behind"].includes(passType)) return "";
  const bearing = radiansToDegrees(target?.encounter?.bearingRelative);
  if (bearing === null) return "";
  if (bearing >= 345 || bearing <= 15) return "Head-on: alter starboard, pass port-to-port";
  if (bearing <= 112.5) return "Give Way";
  return "Stand On";
}

function courseDifferenceDegrees(leftRadians, rightRadians) {
  const left = radiansToDegrees(leftRadians);
  const right = radiansToDegrees(rightRadians);
  if (left === null || right === null) return 360;
  const difference = Math.abs(left - right);
  return Math.min(difference, 360 - difference);
}

function clockPosition(bearingRadians) {
  const degrees = ((bearingRadians * 180) / Math.PI + 360) % 360;
  return Math.round(degrees / 30) % 12 || 12;
}

function radiansToDegrees(value) {
  if (!Number.isFinite(value)) return null;
  return ((value * 180) / Math.PI + 360) % 360;
}

function distanceText(meters, unit = "nmi") {
  const normalizedUnit = normalizeDistanceUnit(unit);
  if (normalizedUnit === "m") {
    return `${Math.max(0, Math.round(meters))} meters`;
  }
  if (normalizedUnit === "km") {
    return `${(meters / 1000).toFixed(1)} kilometers`;
  }
  if (normalizedUnit === "ft") {
    const feet = meters / 0.3048;
    if (feet < 1000) return `${Math.max(0, Math.round(feet))} feet`;
    return `${(meters / 1609.344).toFixed(1)} miles`;
  }
  if (meters < 1000) return `${Math.max(0, Math.round(meters))} meters`;
  const divisor = normalizedUnit === "mi" ? 1609.344 : 1852;
  return `${(meters / divisor).toFixed(1)} miles`;
}

function normalizeDistanceUnit(unit) {
  const text = String(unit || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (["m", "meter", "meters", "metre", "metres"].includes(text)) return "m";
  if (["km", "kilometer", "kilometers", "kilometre", "kilometres"].includes(text)) {
    return "km";
  }
  if (["ft", "foot", "feet"].includes(text)) return "ft";
  if (["mi", "mile", "miles", "statutemile", "statutemiles"].includes(text)) {
    return "mi";
  }
  return "nmi";
}

function timeText(seconds) {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  return `${Math.max(1, Math.round(seconds / 60))} minutes`;
}

function finiteOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

module.exports = {
  clearAllNotifications,
  createNotificationPublisher,
  notificationPath,
  reconcileNotifications,
  systemEventNotification,
};
