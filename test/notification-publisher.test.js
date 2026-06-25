"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  clearAllNotifications,
  createNotificationPublisher,
  reconcileNotifications,
  systemEventNotification,
} = require("../plugin/lib/notification-publisher");

function projection(state = "alarm") {
  return {
    targets: [
      {
        id: "vessels.urn:mrn:imo:mmsi:235900004",
        mmsi: "235900004",
        name: "Ferry Alpha",
        encounter: {
          state,
          bearingTrue: 0,
          bearingRelative: 0,
          cpaBearingRelative: Math.PI / 2,
          cpa: 125,
          tcpa: 180,
          correlationId: "engine-correlation",
          vesselSize: "large",
          ownSog: 5,
          ownCogTrue: 0,
          targetSog: 5,
          targetCogTrue: Math.PI,
          collisionCandidate: true,
        },
      },
    ],
  };
}

test("Engine notifications are standard Signal K values with a compatible envelope", () => {
  const runtime = createNotificationPublisher({ sessionId: "engine-session" });
  const outputs = reconcileNotifications(
    runtime,
    projection(),
    "2026-06-20T08:00:00.000Z",
  );
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].path, "notifications.collision.235900004");
  assert.equal(outputs[0].value.state, "alarm");
  assert.deepEqual(outputs[0].value.method, ["visual", "sound"]);
  assert.match(outputs[0].value.message, /Collision alarm/);
  assert.match(outputs[0].value.message, /CPA will be on your starboard side/);
  const envelope = outputs[0].value.data.ajrmMarineNotifications;
  assert.equal(envelope.provider, "ais-plus-engine");
  assert.equal(envelope.providerSessionId, "engine-session");
  assert.equal(envelope.sourceSequence, 1);
  assert.equal(envelope.correlationId, "engine-correlation");
  assert.equal(envelope.subjectKey, "ais-plus:vessel:235900004");
  assert.equal(envelope.lifecycle, "active");
  assert.equal(envelope.priority.score, 800);
  assert.equal(envelope.delivery.audio, true);
});

test("Engine encounter messages use bow-relative clock bearing and include overtaking wording", () => {
  const runtime = createNotificationPublisher({ sessionId: "engine-session" });
  const value = projection("warn");
  value.targets[0].encounter.bearingTrue = 0;
  value.targets[0].encounter.bearingRelative = Math.PI / 2;
  value.targets[0].encounter.cpaBearingRelative = (3 * Math.PI) / 2;
  value.targets[0].encounter.ownSog = 6;
  value.targets[0].encounter.targetSog = 4;
  value.targets[0].encounter.ownCogTrue = 0;
  value.targets[0].encounter.targetCogTrue = 0.1;

  const output = reconcileNotifications(
    runtime,
    value,
    "2026-06-20T08:00:00.000Z",
  )[0];

  assert.match(output.value.message, /at 3 o'clock/);
  assert.match(output.value.message, /You are overtaking it/);
  assert.match(output.value.message, /CPA will be on your port side/);
  assert.equal(
    output.value.data.ajrmMarineNotifications.presentation.facts.includes("3 o'clock"),
    true,
  );
});

test("Engine system events are one-shot broker history notifications", () => {
  const runtime = createNotificationPublisher({ sessionId: "engine-session" });
  runtime.muteState = false;
  const output = systemEventNotification(
    runtime,
    {
      key: "gps-received",
      title: "GPS",
      label: "GPS received",
      message: "GPS received.",
      category: "gps",
      supersedes: ["navigation.gnss.integrity"],
    },
    "2026-06-20T08:00:00.000Z",
  );

  assert.equal(output.path, "notifications.system.ajrmMarineTraffic.gps-received");
  assert.equal(output.value.state, "alert");
  assert.deepEqual(output.value.method, ["visual", "sound"]);
  assert.equal(output.value.message, "GPS received.");
  const envelope = output.value.data.ajrmMarineNotifications;
  assert.equal(envelope.provider, "ais-plus-engine");
  assert.equal(envelope.providerSessionId, "engine-session");
  assert.equal(envelope.lifecycle, "event");
  assert.equal(envelope.history.policy, "always");
  assert.equal(envelope.delivery.audio, true);
  assert.equal(envelope.delivery.preempt, false);
  assert.equal(envelope.delivery.muteState, false);
  assert.deepEqual(envelope.supersedes, ["navigation.gnss.integrity"]);
  assert.equal(envelope.presentation.label, "GPS received");
  assert.equal(envelope.presentation.category, "gps");
});

test("unchanged state does not republish or duplicate audio", () => {
  const runtime = createNotificationPublisher({ sessionId: "engine-session" });
  assert.equal(reconcileNotifications(runtime, projection()).length, 1);
  assert.deepEqual(reconcileNotifications(runtime, projection()), []);
});

test("same-state metadata refresh is visual-only and keeps correlation", () => {
  const runtime = createNotificationPublisher({
    sessionId: "engine-session",
    visualRefreshMs: 15000,
  });
  const initial = projection();
  initial.targets[0].name = "235900004";
  const first = reconcileNotifications(
    runtime,
    initial,
    "2026-06-20T08:00:00.000Z",
  )[0];
  const updated = projection();
  const revision = reconcileNotifications(
    runtime,
    updated,
    "2026-06-20T08:00:01.000Z",
  )[0];
  assert.deepEqual(revision.value.method, ["visual"]);
  assert.equal(revision.value.data.ajrmMarineNotifications.delivery.audio, false);
  assert.equal(
    revision.value.data.ajrmMarineNotifications.correlationId,
    first.value.data.ajrmMarineNotifications.correlationId,
  );
  assert.match(revision.value.message, /Ferry Alpha at 12 o'clock/);
  assert.doesNotMatch(revision.value.message, /Alpha\. at/);
});

test("same-state encounter text refresh is throttled and visual-only", () => {
  const runtime = createNotificationPublisher({
    sessionId: "engine-session",
    visualRefreshMs: 15000,
  });
  reconcileNotifications(
    runtime,
    projection(),
    "2026-06-20T08:00:00.000Z",
  );
  const changed = projection();
  changed.targets[0].encounter.cpa = 90;
  assert.deepEqual(
    reconcileNotifications(
      runtime,
      changed,
      "2026-06-20T08:00:10.000Z",
    ),
    [],
  );
  const revision = reconcileNotifications(
    runtime,
    changed,
    "2026-06-20T08:00:15.000Z",
  );
  assert.equal(revision.length, 1);
  assert.deepEqual(revision[0].value.method, ["visual"]);
  assert.equal(revision[0].value.data.ajrmMarineNotifications.delivery.audio, false);
  assert.match(revision[0].value.message, /CPA 90 meters/);
});

test("Engine encounter messages use miles without saying nautical", () => {
  const runtime = createNotificationPublisher({ sessionId: "engine-session" });
  const value = projection("warn");
  value.targets[0].encounter.cpa = 1667;
  value.targets[0].encounter.tcpa = 960;

  const output = reconcileNotifications(
    runtime,
    value,
    "2026-06-20T08:00:00.000Z",
  )[0];

  assert.match(output.value.message, /CPA 0\.9 miles in 16 minutes/);
  assert.doesNotMatch(output.value.message, /nautical/i);
});

test("Engine encounter distance wording follows preferred distance units", () => {
  const cases = [
    ["km", /CPA 1\.7 kilometers in 16 minutes/],
    ["m", /CPA 1667 meters in 16 minutes/],
    ["ft", /CPA 1\.0 miles in 16 minutes/],
    ["mi", /CPA 1\.0 miles in 16 minutes/],
  ];

  for (const [distanceUnit, expected] of cases) {
    const runtime = createNotificationPublisher({
      sessionId: `engine-session-${distanceUnit}`,
      distanceUnit,
    });
    const value = projection("warn");
    value.targets[0].encounter.cpa = 1667;
    value.targets[0].encounter.tcpa = 960;

    const output = reconcileNotifications(
      runtime,
      value,
      "2026-06-20T08:00:00.000Z",
    )[0];

    assert.match(output.value.message, expected);
  }
});

test("Engine encounter distance wording uses feet below 1000 feet", () => {
  const runtime = createNotificationPublisher({
    sessionId: "engine-session-feet",
    distanceUnit: "ft",
  });
  const value = projection("warn");
  value.targets[0].encounter.cpa = 250;
  value.targets[0].encounter.tcpa = 60;

  const output = reconcileNotifications(
    runtime,
    value,
    "2026-06-20T08:00:00.000Z",
  )[0];

  assert.match(output.value.message, /CPA 820 feet in 60 seconds/);
});

function assertResolvedClear(output, expected = {}) {
  assert.equal(output.path, "notifications.collision.235900004");
  assert.equal(output.value.state, "normal");
  assert.deepEqual(output.value.method, []);
  assert.equal(output.value.message, "");
  assert.equal(output.value.data.category, "cpa");
  assert.equal(output.value.data.alarmState, "normal");
  assert.equal(output.value.data.vesselName, "Ferry Alpha");
  assert.equal(output.value.data.mmsi, "235900004");
  const envelope = output.value.data.ajrmMarineNotifications;
  assert.equal(envelope.provider, "ais-plus-engine");
  assert.equal(envelope.providerSessionId, "engine-session");
  assert.equal(envelope.lifecycle, "resolved");
  assert.equal(envelope.priority.level, "information");
  assert.equal(envelope.priority.score, 200);
  assert.equal(envelope.delivery.visual, false);
  assert.equal(envelope.delivery.audio, false);
  assert.equal(envelope.delivery.preempt, false);
  assert.equal(envelope.delivery.localPlayback, false);
  assert.equal(envelope.delivery.streamOutput, false);
  assert.equal(envelope.delivery.repeatSeconds, 0);
  assert.equal(envelope.delivery.expiresSeconds, 0);
  assert.equal(envelope.presentation.label, "Resolved");
  assert.equal(envelope.presentation.message, "");
  assert.deepEqual(envelope.actions, []);
  assert.equal(envelope.context.mmsi, "235900004");
  assert.equal(envelope.context.targetContext, "");
  if (expected.correlationId) {
    assert.equal(envelope.correlationId, expected.correlationId);
  }
  if (expected.subjectKey) {
    assert.equal(envelope.subjectKey, expected.subjectKey);
  }
  if (expected.timestamp) {
    assert.equal(envelope.timestamp, expected.timestamp);
  }
}

test("de-escalation to normal and target loss publish a resolved normal clear", () => {
  const runtime = createNotificationPublisher({ sessionId: "engine-session" });
  const active = reconcileNotifications(runtime, projection())[0];
  const normal = reconcileNotifications(
    runtime,
    projection("normal"),
    "2026-06-20T08:00:30.000Z",
  );
  assert.equal(normal.length, 1);
  assertResolvedClear(normal[0], {
    correlationId: active.value.data.ajrmMarineNotifications.correlationId,
    subjectKey: active.value.data.ajrmMarineNotifications.subjectKey,
    timestamp: "2026-06-20T08:00:30.000Z",
  });

  reconcileNotifications(runtime, projection());
  const missing = reconcileNotifications(
    runtime,
    { targets: [] },
    "2026-06-20T08:01:00.000Z",
  );
  assert.equal(missing.length, 1);
  assertResolvedClear(missing[0], {
    correlationId: "engine-correlation",
    subjectKey: "ais-plus:vessel:235900004",
    timestamp: "2026-06-20T08:01:00.000Z",
  });
});

test("stopping Engine clears every active notification", () => {
  const runtime = createNotificationPublisher({ sessionId: "engine-session" });
  reconcileNotifications(runtime, projection());
  const clears = clearAllNotifications(runtime, "2026-06-20T08:02:00.000Z");
  assert.equal(clears.length, 1);
  assertResolvedClear(clears[0], {
    correlationId: "engine-correlation",
    subjectKey: "ais-plus:vessel:235900004",
    timestamp: "2026-06-20T08:02:00.000Z",
  });
  assert.deepEqual(clearAllNotifications(runtime), []);
});

test("non-collision targets never publish alerts", () => {
  const runtime = createNotificationPublisher({ sessionId: "engine-session" });
  const value = projection();
  value.targets[0].encounter.collisionCandidate = false;
  assert.deepEqual(reconcileNotifications(runtime, value), []);
});

test("silencing an active target clears its notification", () => {
  const runtime = createNotificationPublisher({ sessionId: "engine-session" });
  reconcileNotifications(runtime, projection());
  const silenced = projection();
  silenced.targets[0].encounter.silenced = true;
  const clears = reconcileNotifications(
    runtime,
    silenced,
    "2026-06-20T08:03:00.000Z",
  );
  assert.equal(clears.length, 1);
  assertResolvedClear(clears[0], {
    correlationId: "engine-correlation",
    subjectKey: "ais-plus:vessel:235900004",
    timestamp: "2026-06-20T08:03:00.000Z",
  });
});
