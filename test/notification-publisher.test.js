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
          correlationId: "traffic-correlation",
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

test("Traffic notifications are standard Signal K values with a compatible envelope", () => {
  const runtime = createNotificationPublisher({ sessionId: "traffic-session" });
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
  assert.equal(envelope.provider, "ajrm-marine-traffic");
  assert.equal(envelope.providerSessionId, "traffic-session");
  assert.equal(envelope.sourceSequence, 1);
  assert.equal(envelope.correlationId, "traffic-correlation");
  assert.equal(envelope.subjectKey, "ajrm-marine:traffic:vessel:235900004");
  assert.equal(envelope.lifecycle, "active");
  assert.equal(envelope.priority.score, 800);
  assert.equal(envelope.delivery.audio, true);
});

test("Traffic encounter messages use bow-relative clock bearing and include overtaking wording", () => {
  const runtime = createNotificationPublisher({ sessionId: "traffic-session" });
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

test("Traffic encounter messages cover passing and overtaking geometry", () => {
  const cases = [
    {
      name: "CPA to starboard",
      cpaBearingRelative: Math.PI / 2,
      bearingRelative: Math.PI / 4,
      ownSog: 5,
      targetSog: 5,
      ownCogTrue: 0,
      targetCogTrue: Math.PI,
      expected: /CPA will be on your starboard side/,
    },
    {
      name: "CPA to port",
      cpaBearingRelative: (3 * Math.PI) / 2,
      bearingRelative: (7 * Math.PI) / 4,
      ownSog: 5,
      targetSog: 5,
      ownCogTrue: 0,
      targetCogTrue: Math.PI,
      expected: /CPA will be on your port side/,
    },
    {
      name: "CPA ahead",
      cpaBearingRelative: 0,
      bearingRelative: 0,
      ownSog: 5,
      targetSog: 5,
      ownCogTrue: 0,
      targetCogTrue: Math.PI,
      expected: /CPA will be ahead/,
    },
    {
      name: "CPA astern",
      cpaBearingRelative: Math.PI,
      bearingRelative: Math.PI,
      ownSog: 5,
      targetSog: 5,
      ownCogTrue: 0,
      targetCogTrue: Math.PI,
      expected: /CPA will be astern/,
    },
    {
      name: "own vessel overtaking",
      cpaBearingRelative: 0,
      bearingRelative: 0,
      ownSog: 6,
      targetSog: 3,
      ownCogTrue: 0,
      targetCogTrue: 0.05,
      expected: /You are overtaking it\. CPA will be ahead/,
    },
    {
      name: "target overtaking own vessel",
      cpaBearingRelative: Math.PI,
      bearingRelative: Math.PI,
      ownSog: 3,
      targetSog: 6,
      ownCogTrue: 0,
      targetCogTrue: 0.05,
      expected: /It is overtaking you\. CPA will be astern/,
    },
    {
      name: "parallel same-speed passing",
      cpaBearingRelative: Math.PI / 2,
      bearingRelative: Math.PI / 2,
      ownSog: 5,
      targetSog: 5,
      ownCogTrue: 0,
      targetCogTrue: 0.05,
      expected: /Same general course\. CPA will be on your starboard side/,
    },
    {
      name: "close quarters",
      cpaBearingRelative: Math.PI / 2,
      bearingRelative: Math.PI / 2,
      ownSog: 5,
      targetSog: 5,
      ownCogTrue: 0,
      targetCogTrue: Math.PI,
      cpa: 44,
      expected: /Close quarters\. CPA 44 meters/,
    },
    {
      name: "head-on collision risk",
      cpaBearingRelative: 0,
      bearingRelative: 0,
      ownSog: 5,
      targetSog: 5,
      ownCogTrue: 0,
      targetCogTrue: Math.PI,
      cpa: 0,
      state: "alarm",
      expected: /Risk of collision\. Head-on: alter starboard, pass port-to-port\. CPA 0 meters/,
    },
  ];

  for (const item of cases) {
    const runtime = createNotificationPublisher({ sessionId: `traffic-session-${item.name}` });
    const value = projection(item.state || "warn");
    Object.assign(value.targets[0].encounter, {
      cpaBearingRelative: item.cpaBearingRelative,
      bearingRelative: item.bearingRelative,
      ownSog: item.ownSog,
      targetSog: item.targetSog,
      ownCogTrue: item.ownCogTrue,
      targetCogTrue: item.targetCogTrue,
      cpa: item.cpa ?? 125,
      tcpa: 240,
    });

    const output = reconcileNotifications(
      runtime,
      value,
      "2026-06-20T08:00:00.000Z",
    )[0];
    const presentation = output.value.data.ajrmMarineNotifications.presentation;

    assert.match(output.value.message, item.expected, item.name);
    assert.match(presentation.audioMessage, item.expected, item.name);
  }
});

test("Traffic does not speak stationary or normal non-collision targets", () => {
  const runtime = createNotificationPublisher({ sessionId: "traffic-session" });
  const stationary = projection("normal");
  Object.assign(stationary.targets[0].encounter, {
    collisionCandidate: false,
    ownSog: 0,
    targetSog: 0,
    cpa: null,
    tcpa: null,
  });
  assert.deepEqual(reconcileNotifications(runtime, stationary), []);

  const normalMoving = projection("normal");
  Object.assign(normalMoving.targets[0].encounter, {
    collisionCandidate: true,
    ownSog: 5,
    targetSog: 5,
    cpa: 5000,
    tcpa: 1800,
  });
  assert.deepEqual(reconcileNotifications(runtime, normalMoving), []);
});

test("Traffic system events are one-shot broker history notifications", () => {
  const runtime = createNotificationPublisher({ sessionId: "traffic-session" });
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
  assert.equal(envelope.provider, "ajrm-marine-traffic");
  assert.equal(envelope.providerSessionId, "traffic-session");
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
  const runtime = createNotificationPublisher({ sessionId: "traffic-session" });
  assert.equal(reconcileNotifications(runtime, projection()).length, 1);
  assert.deepEqual(reconcileNotifications(runtime, projection()), []);
});

test("same-state metadata refresh is visual-only and keeps correlation", () => {
  const runtime = createNotificationPublisher({
    sessionId: "traffic-session",
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
    sessionId: "traffic-session",
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
  assert.match(revision[0].value.message, /90 meters/);
});

test("same-state alarm repeats audio when the profile repeat interval is due", () => {
  const runtime = createNotificationPublisher({
    sessionId: "traffic-session",
    visualRefreshMs: 15000,
  });
  const value = projection();
  value.profile = "coastal";
  value.profileSettings = {
    current: "coastal",
    coastal: { repeatSensitivity: 1 },
  };
  reconcileNotifications(runtime, value, "2026-06-20T08:00:00.000Z");

  const quietRefresh = projection();
  quietRefresh.profile = "coastal";
  quietRefresh.profileSettings = value.profileSettings;
  quietRefresh.targets[0].encounter.cpa = 90;
  const visualOnly = reconcileNotifications(
    runtime,
    quietRefresh,
    "2026-06-20T08:00:15.000Z",
  );
  assert.equal(visualOnly.length, 1);
  assert.deepEqual(visualOnly[0].value.method, ["visual"]);
  assert.equal(visualOnly[0].value.data.ajrmMarineNotifications.delivery.audio, false);

  const repeat = reconcileNotifications(
    runtime,
    quietRefresh,
    "2026-06-20T08:01:00.000Z",
  );
  assert.equal(repeat.length, 1);
  assert.deepEqual(repeat[0].value.method, ["visual", "sound"]);
  const envelope = repeat[0].value.data.ajrmMarineNotifications;
  assert.equal(envelope.delivery.audio, true);
  assert.equal(envelope.delivery.repeatSeconds, 60);
});

test("profile repeat sensitivity scales alarm repeat audio", () => {
  const runtime = createNotificationPublisher({ sessionId: "traffic-session" });
  const value = projection();
  value.profile = "coastal";
  value.profileSettings = {
    current: "coastal",
    coastal: { repeatSensitivity: 2 },
  };
  reconcileNotifications(runtime, value, "2026-06-20T08:00:00.000Z");

  assert.deepEqual(
    reconcileNotifications(runtime, value, "2026-06-20T08:00:29.000Z"),
    [],
  );
  const repeat = reconcileNotifications(
    runtime,
    value,
    "2026-06-20T08:00:30.000Z",
  );
  assert.equal(repeat.length, 1);
  assert.deepEqual(repeat[0].value.method, ["visual", "sound"]);
  assert.equal(
    repeat[0].value.data.ajrmMarineNotifications.delivery.repeatSeconds,
    30,
  );
});

test("zero repeat sensitivity disables same-state repeat audio", () => {
  const runtime = createNotificationPublisher({ sessionId: "traffic-session" });
  const value = projection();
  value.profile = "coastal";
  value.profileSettings = {
    current: "coastal",
    coastal: { repeatSensitivity: 0 },
  };
  reconcileNotifications(runtime, value, "2026-06-20T08:00:00.000Z");

  assert.deepEqual(
    reconcileNotifications(runtime, value, "2026-06-20T08:10:00.000Z"),
    [],
  );
});

test("Traffic encounter messages use miles without saying nautical", () => {
  const runtime = createNotificationPublisher({ sessionId: "traffic-session" });
  const value = projection("warn");
  value.targets[0].encounter.cpa = 1667;
  value.targets[0].encounter.tcpa = 960;

  const output = reconcileNotifications(
    runtime,
    value,
    "2026-06-20T08:00:00.000Z",
  )[0];

  assert.match(output.value.message, /CPA will be on your starboard side\. 0\.9 miles in 16 minutes/);
  assert.doesNotMatch(output.value.message, /CPA will be on your starboard side\. CPA /);
  assert.doesNotMatch(output.value.message, /nautical/i);
});

test("Traffic encounter messages keep CPA label when there is no passing phrase", () => {
  const runtime = createNotificationPublisher({ sessionId: "traffic-session" });
  const value = projection("warn");
  value.targets[0].encounter.cpa = 1667;
  value.targets[0].encounter.tcpa = 960;
  delete value.targets[0].encounter.cpaBearingRelative;
  delete value.targets[0].encounter.bearingRelative;

  const output = reconcileNotifications(
    runtime,
    value,
    "2026-06-20T08:00:00.000Z",
  )[0];

  assert.match(output.value.message, /CPA 0\.9 miles in 16 minutes/);
});

test("Traffic encounter audio omits MMSI when the vessel has no name", () => {
  const runtime = createNotificationPublisher({ sessionId: "traffic-session" });
  const value = projection("warn");
  value.targets[0].mmsi = "235900007";
  value.targets[0].name = "";
  value.targets[0].encounter.vesselSize = "small";
  value.targets[0].encounter.bearingRelative = 0;
  value.targets[0].encounter.cpa = 3334;
  value.targets[0].encounter.tcpa = 3600;

  const output = reconcileNotifications(
    runtime,
    value,
    "2026-06-20T08:00:00.000Z",
  )[0];
  const presentation = output.value.data.ajrmMarineNotifications.presentation;

  assert.match(output.value.message, /Small craft 235900007 at 12 o'clock/);
  assert.match(presentation.message, /Small craft 235900007 at 12 o'clock/);
  assert.match(presentation.audioMessage, /Small craft at 12 o'clock/);
  assert.doesNotMatch(presentation.audioMessage, /235900007/);
});

test("Traffic encounter audio omits MMSI when the projection name is the MMSI fallback", () => {
  const runtime = createNotificationPublisher({ sessionId: "traffic-session" });
  const value = projection("alarm");
  value.targets[0].mmsi = "235900007";
  value.targets[0].name = "235900007";
  value.targets[0].encounter.vesselSize = "small";
  value.targets[0].encounter.bearingRelative = 0;
  value.targets[0].encounter.cpa = 288;
  value.targets[0].encounter.tcpa = 1107;

  const output = reconcileNotifications(
    runtime,
    value,
    "2026-06-20T08:00:00.000Z",
  )[0];
  const presentation = output.value.data.ajrmMarineNotifications.presentation;

  assert.match(output.value.message, /Small craft 235900007 at 12 o'clock/);
  assert.match(presentation.audioMessage, /Small craft at 12 o'clock/);
  assert.doesNotMatch(presentation.audioMessage, /235900007/);
});

test("Traffic encounter distance wording follows preferred distance units", () => {
  const cases = [
    ["km", /1\.7 kilometers in 16 minutes/],
    ["m", /1667 meters in 16 minutes/],
    ["ft", /1\.0 miles in 16 minutes/],
    ["mi", /1\.0 miles in 16 minutes/],
  ];

  for (const [distanceUnit, expected] of cases) {
    const runtime = createNotificationPublisher({
      sessionId: `traffic-session-${distanceUnit}`,
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

test("Traffic encounter distance wording uses feet below 1000 feet", () => {
  const runtime = createNotificationPublisher({
    sessionId: "traffic-session-feet",
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

  assert.match(output.value.message, /820 feet in 60 seconds/);
});

test("Traffic encounter time wording uses singular seconds", () => {
  const runtime = createNotificationPublisher({
    sessionId: "traffic-session-singular-time",
  });
  const oneSecond = projection("alarm");
  oneSecond.targets[0].encounter.cpa = 232;
  oneSecond.targets[0].encounter.tcpa = 1;

  const oneSecondOutput = reconcileNotifications(
    runtime,
    oneSecond,
    "2026-06-20T08:00:00.000Z",
  )[0];

  assert.match(oneSecondOutput.value.message, /232 meters in 1 second/);
  assert.doesNotMatch(oneSecondOutput.value.message, /1 seconds/);
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
  assert.equal(envelope.provider, "ajrm-marine-traffic");
  assert.equal(envelope.providerSessionId, "traffic-session");
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
  const runtime = createNotificationPublisher({ sessionId: "traffic-session" });
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
    correlationId: "traffic-correlation",
    subjectKey: "ajrm-marine:traffic:vessel:235900004",
    timestamp: "2026-06-20T08:01:00.000Z",
  });
});

test("stopping Traffic clears every active notification", () => {
  const runtime = createNotificationPublisher({ sessionId: "traffic-session" });
  reconcileNotifications(runtime, projection());
  const clears = clearAllNotifications(runtime, "2026-06-20T08:02:00.000Z");
  assert.equal(clears.length, 1);
  assertResolvedClear(clears[0], {
    correlationId: "traffic-correlation",
    subjectKey: "ajrm-marine:traffic:vessel:235900004",
    timestamp: "2026-06-20T08:02:00.000Z",
  });
  assert.deepEqual(clearAllNotifications(runtime), []);
});

test("non-collision targets never publish alerts", () => {
  const runtime = createNotificationPublisher({ sessionId: "traffic-session" });
  const value = projection();
  value.targets[0].encounter.collisionCandidate = false;
  assert.deepEqual(reconcileNotifications(runtime, value), []);
});

test("silencing an active target clears its notification", () => {
  const runtime = createNotificationPublisher({ sessionId: "traffic-session" });
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
    correlationId: "traffic-correlation",
    subjectKey: "ajrm-marine:traffic:vessel:235900004",
    timestamp: "2026-06-20T08:03:00.000Z",
  });
});
