"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const createPlugin = require("../plugin");
const {
  autoProfilePublicationSignature,
} = require("../plugin")._private;

test("installable AJRM Marine Traffic is disabled by default and authoritative when enabled", () => {
  const packageInfo = require("../package.json");
  assert.equal(packageInfo.private, undefined);
  assert.equal(packageInfo["signalk-plugin-enabled-by-default"], false);
  const plugin = createPlugin(fakeApp().app);
  assert.equal(plugin.schema.properties.mode, undefined);
});

test("AJRM Marine Traffic publishes authoritative notifications and clears them on stop", async () => {
  const timestamp = new Date().toISOString();
  const fixture = fakeApp();
  const plugin = createPlugin(fixture.app);
  plugin.start({ calculationDelayMs: 0, profile: "coastal" });
  fixture.deltaHandler({
    context: fixture.app.selfId,
    updates: [
      {
        timestamp,
        values: [
          { path: "navigation.position", value: { latitude: 50, longitude: -1 } },
          { path: "navigation.speedOverGround", value: 8 },
          { path: "navigation.courseOverGroundTrue", value: 0 },
        ],
      },
    ],
  });
  fixture.deltaHandler({
    context: "vessels.urn:mrn:imo:mmsi:235900004",
    updates: [
      {
        timestamp,
        values: [
          { path: "mmsi", value: "235900004" },
          { path: "name", value: "Ferry Alpha" },
          { path: "navigation.position", value: { latitude: 50.01, longitude: -1 } },
          { path: "navigation.speedOverGround", value: 8 },
          { path: "navigation.courseOverGroundTrue", value: Math.PI },
          { path: "design.length", value: { overall: 120 } },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const notificationValues = fixture.messages
    .flatMap((message) => message.updates.flatMap((update) => update.values))
    .filter((value) => value.path === "notifications.collision.235900004");
  assert.equal(notificationValues.length, 1);
  assert.equal(notificationValues[0].value.state, "alarm");
  assert.equal(
    notificationValues[0].value.data.ajrmMarineNotifications.provider,
    "ajrm-marine-traffic",
  );
  plugin.stop();
  const afterStop = fixture.messages
    .flatMap((message) => message.updates.flatMap((update) => update.values))
    .filter((value) => value.path === "notifications.collision.235900004");
  const clear = afterStop.at(-1).value;
  assert.equal(clear.state, "normal");
  assert.deepEqual(clear.method, []);
  assert.equal(clear.message, "");
  assert.equal(clear.data.ajrmMarineNotifications.lifecycle, "resolved");
  assert.equal(clear.data.ajrmMarineNotifications.provider, "ajrm-marine-traffic");
  assert.equal(clear.data.ajrmMarineNotifications.delivery.visual, false);
  assert.equal(clear.data.ajrmMarineNotifications.delivery.audio, false);
});

test("AJRM Marine Traffic suppresses notifications during Logger replay warm-up", async () => {
  const timestamp = new Date().toISOString();
  const fixture = fakeApp();
  const plugin = createPlugin(fixture.app);
  plugin.start({ calculationDelayMs: 0, profile: "coastal" });

  fixture.deltaHandler({
    context: fixture.app.selfId,
    updates: [
      {
        timestamp,
        values: [
          {
            path: "plugins.ajrmMarineLogger.playback",
            value: { active: true, warmupActive: true },
          },
          { path: "navigation.position", value: { latitude: 50, longitude: -1 } },
          { path: "navigation.speedOverGround", value: 8 },
          { path: "navigation.courseOverGroundTrue", value: 0 },
        ],
      },
    ],
  });
  fixture.deltaHandler({
    context: "vessels.urn:mrn:imo:mmsi:235900004",
    updates: [
      {
        timestamp,
        values: [
          { path: "mmsi", value: "235900004" },
          { path: "name", value: "Ferry Alpha" },
          { path: "navigation.position", value: { latitude: 50.01, longitude: -1 } },
          { path: "navigation.speedOverGround", value: 8 },
          { path: "navigation.courseOverGroundTrue", value: Math.PI },
          { path: "design.length", value: { overall: 120 } },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  let notificationValues = fixture.messages
    .flatMap((message) => message.updates.flatMap((update) => update.values))
    .filter((value) => value.path === "notifications.collision.235900004");
  assert.equal(notificationValues.length, 0);

  fixture.deltaHandler({
    context: fixture.app.selfId,
    updates: [
      {
        timestamp,
        values: [
          {
            path: "plugins.ajrmMarineLogger.playback",
            value: { active: true, warmupActive: false },
          },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  notificationValues = fixture.messages
    .flatMap((message) => message.updates.flatMap((update) => update.values))
    .filter((value) => value.path === "notifications.collision.235900004");
  assert.equal(notificationValues.length, 1);
  assert.equal(notificationValues[0].value.state, "alarm");
  plugin.stop();
});

test("AJRM Marine Traffic uses Signal K distance display units for encounter wording", async () => {
  const timestamp = new Date().toISOString();
  const fixture = fakeApp({
    metadata: {
      "navigation.closestApproach.distance": {
        displayUnits: { targetUnit: "km" },
      },
    },
  });
  const plugin = createPlugin(fixture.app);
  plugin.start({ calculationDelayMs: 0, profile: "coastal" });
  fixture.deltaHandler({
    context: fixture.app.selfId,
    updates: [
      {
        timestamp,
        values: [
          { path: "navigation.position", value: { latitude: 50, longitude: -1 } },
          { path: "navigation.speedOverGround", value: 8 },
          { path: "navigation.courseOverGroundTrue", value: 0 },
        ],
      },
    ],
  });
  fixture.deltaHandler({
    context: "vessels.urn:mrn:imo:mmsi:235900004",
    updates: [
      {
        timestamp,
        values: [
          { path: "mmsi", value: "235900004" },
          { path: "name", value: "Ferry Alpha" },
          { path: "navigation.position", value: { latitude: 50.015, longitude: -1 } },
          { path: "navigation.speedOverGround", value: 8 },
          { path: "navigation.courseOverGroundTrue", value: Math.PI },
          { path: "design.length", value: { overall: 120 } },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const notification = fixture.messages
    .flatMap((message) => message.updates.flatMap((update) => update.values))
    .filter((value) => value.path === "notifications.collision.235900004")
    .at(-1);
  assert.match(notification.value.message, /CPA [0-9.]+ kilometers in/);
  plugin.stop();
});

test("AJRM Marine Traffic publishes authoritative target projections", async () => {
  const timestamp = new Date().toISOString();
  const fixture = fakeApp();
  const plugin = createPlugin(fixture.app);
  plugin.start({ calculationDelayMs: 0, profile: "coastal" });
  fixture.deltaHandler({
    context: fixture.app.selfId,
    updates: [
      {
        timestamp,
        values: [
          { path: "navigation.position", value: { latitude: 50, longitude: -1 } },
          { path: "navigation.speedOverGround", value: 2 },
          { path: "navigation.courseOverGroundTrue", value: 0 },
        ],
      },
    ],
  });
  fixture.deltaHandler({
    context: "vessels.urn:mrn:imo:mmsi:235900004",
    updates: [
      {
        timestamp,
        values: [
          { path: "name", value: "Ferry Alpha" },
          { path: "navigation.position", value: { latitude: 50.01, longitude: -1 } },
          { path: "navigation.speedOverGround", value: 2 },
          { path: "navigation.courseOverGroundTrue", value: Math.PI },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const paths = fixture.messages.flatMap((message) =>
    message.updates.flatMap((update) => update.values.map((value) => value.path)),
  );
  assert.ok(paths.includes("plugins.ajrmMarineTraffic.capabilities"));
  assert.ok(paths.includes("plugins.ajrmMarineTraffic.targets"));
  const targetProjection = fixture.messages
    .flatMap((message) => message.updates.flatMap((update) => update.values))
    .filter((value) => value.path === "plugins.ajrmMarineTraffic.targets")
    .at(-1).value;
  assert.equal(targetProjection.mode, "traffic");
  assert.equal(targetProjection.authoritative, true);
  assert.equal(targetProjection.targets.length, 1);
  plugin.stop();
});

test("live full self vessel context is normalized to own-vessel input", async () => {
  const timestamp = new Date().toISOString();
  const fixture = fakeApp();
  const plugin = createPlugin(fixture.app);
  plugin.start({ calculationDelayMs: 0 });
  fixture.deltaHandler({
    context: `vessels.${fixture.app.selfId}`,
    updates: [
      {
        timestamp,
        values: [
          {
            path: "navigation.position",
            value: { latitude: 56.2157, longitude: -5.5622 },
          },
          { path: "navigation.speedOverGround", value: 7.7 },
          { path: "navigation.courseOverGroundTrue", value: 1.2 },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const targetProjection = fixture.messages
    .flatMap((message) => message.updates.flatMap((update) => update.values))
    .filter((value) => value.path === "plugins.ajrmMarineTraffic.targets")
    .at(-1).value;
  assert.equal(targetProjection.source.ownVesselPositionFresh, true);
  plugin.stop();
});

test("Traffic command routes own profile and target silence state", async () => {
  const timestamp = new Date().toISOString();
  const fixture = fakeApp();
  const plugin = createPlugin(fixture.app);
  const router = fakeRouter();
  plugin.registerWithRouter(router);
  plugin.start({ calculationDelayMs: 0, profile: "coastal" });
  fixture.deltaHandler({
    context: fixture.app.selfId,
    updates: [
      {
        timestamp,
        values: [
          { path: "navigation.position", value: { latitude: 50, longitude: -1 } },
          { path: "navigation.speedOverGround", value: 8 },
          { path: "navigation.courseOverGroundTrue", value: 0 },
        ],
      },
    ],
  });
  fixture.deltaHandler({
    context: "vessels.urn:mrn:imo:mmsi:235900004",
    updates: [
      {
        timestamp,
        values: [
          { path: "mmsi", value: "235900004" },
          { path: "name", value: "Ferry Alpha" },
          { path: "navigation.position", value: { latitude: 50.01, longitude: -1 } },
          { path: "navigation.speedOverGround", value: 8 },
          { path: "navigation.courseOverGroundTrue", value: Math.PI },
          { path: "design.length", value: { overall: 120 } },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const silence = invokeRoute(
    router,
    "post",
    "/commands/targets/:identity/silence",
    { params: { identity: "235900004" }, body: { silenced: true } },
  );
  assert.equal(silence.statusCode, 200);
  assert.equal(silence.body.target.silenced, true);
  assert.equal(silence.body.commands.silencedTargets[0], "235900004");

  const profile = invokeRoute(router, "put", "/commands/profile", {
    body: { profile: "offshore" },
  });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.body.profile, "offshore");

  const sensitivities = invokeRoute(router, "put", "/commands/profiles", {
    body: {
      current: "coastal",
      coastal: {
        automuteStationary: true,
        cpaSensitivity: 1.4,
        tcpaLookahead: 0.8,
        repeatSensitivity: 1.2,
        warning: {
          bySize: {
            small: { cpa: 100, tcpa: 120, speed: 1 },
          },
        },
      },
    },
  });
  assert.equal(sensitivities.statusCode, 200);
  assert.equal(sensitivities.body.profiles.current, "coastal");
  assert.equal(sensitivities.body.profiles.coastal.cpaSensitivity, 1.4);
  assert.equal(sensitivities.body.profiles.coastal.automuteStationary, true);
  assert.equal(sensitivities.body.profiles.coastal.tcpaLookahead, 0.8);
  assert.equal(sensitivities.body.profiles.coastal.repeatSensitivity, 1.2);
  assert.equal(sensitivities.body.profiles.coastal.warning.bySize.small.cpa, 100);
  assert.equal(sensitivities.body.profiles.coastal.warning.bySize.small.tcpa, 120);
  assert.equal(sensitivities.body.profiles.coastal.warning.bySize.small.speed, 1);

  const status = invokeRoute(router, "get", "/commands");
  assert.equal(status.body.enabled, true);
  assert.equal(status.body.profile, "coastal");
  assert.equal(status.body.profiles.coastal.cpaSensitivity, 1.4);
  assert.equal(status.body.profiles.coastal.automuteStationary, true);

  const unsilence = invokeRoute(router, "post", "/commands/unsilence-all");
  assert.equal(unsilence.body.unsilenced, 1);
  assert.deepEqual(unsilence.body.commands.silencedTargets, []);
  plugin.stop();
});

test("Traffic publishes Auto Profile and Audio Policy contracts and accepts commands", async () => {
  const fixture = fakeApp({
    regions: {
      oban: {
        name: "Harbour: Oban",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-5.48, 56.4],
              [-5.46, 56.4],
              [-5.46, 56.42],
              [-5.48, 56.42],
              [-5.48, 56.4],
            ],
          ],
        },
      },
    },
  });
  const plugin = createPlugin(fixture.app);
  const router = fakeRouter();
  plugin.registerWithRouter(router);
  plugin.start({
    calculationDelayMs: 0,
    profile: "coastal",
    automuteStationary: true,
  });
  fixture.deltaHandler({
    context: fixture.app.selfId,
    updates: [
      {
        timestamp: new Date().toISOString(),
        values: [
          {
            path: "navigation.position",
            value: { latitude: 56.41, longitude: -5.47 },
          },
          { path: "navigation.speedOverGround", value: 0 },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const values = fixture.messages.flatMap((message) =>
    message.updates.flatMap((update) => update.values),
  );
  const autoProfile = values
    .filter((value) => value.path === "plugins.ajrmMarineTraffic.autoProfile")
    .at(-1).value;
  const audio = values
    .filter((value) => value.path === "plugins.ajrmMarineTraffic.audioPolicy")
    .at(-1).value;
  assert.equal(autoProfile.profile, "harbor");
  assert.equal(autoProfile.insideRegionName, "Harbour: Oban");
  assert.equal(audio.muted, true);
  assert.equal(audio.automaticMuteActive, true);
  assert.ok(autoProfile.sequence > 0);
  assert.ok(audio.sequence > 0);
  const systemNotifications = values.filter((value) =>
    value.path.startsWith("notifications.system.ajrmMarineTraffic."),
  );
  assert.deepEqual(
    systemNotifications.map((value) => value.path).sort(),
    [
      "notifications.system.ajrmMarineTraffic.auto-mute",
      "notifications.system.ajrmMarineTraffic.gps-received",
      "notifications.system.ajrmMarineTraffic.profile-harbor",
    ],
  );
  assert.deepEqual(
    systemNotifications.map(
      (value) => value.value.data.ajrmMarineNotifications.history.policy,
    ),
    ["always", "always", "always"],
  );
  assert.ok(
    systemNotifications.some((value) =>
      value.value.message.includes("Profile automatically set to Harbour"),
    ),
  );
  assert.ok(
    systemNotifications.some((value) =>
      value.value.message.includes("GPS received"),
    ),
  );
  assert.ok(
    systemNotifications.some((value) =>
      value.value.message.includes("Sound automatically muted"),
    ),
  );

  const mute = invokeRoute(router, "put", "/commands/audio", {
    body: { muted: false },
  });
  assert.equal(mute.body.audio.muted, false);
  assert.equal(mute.body.audio.manualOverride, true);

  const auto = invokeRoute(router, "put", "/commands/auto-profile", {
    body: { enabled: false },
  });
  assert.equal(auto.body.autoProfile.enabled, false);
  plugin.stop();
});

test("Traffic does not republish Auto Profile for nearest-distance drift", async () => {
  const fixture = fakeApp({
    regions: {
      oban: {
        name: "Harbour: Oban",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-5.48, 56.4],
              [-5.46, 56.4],
              [-5.46, 56.42],
              [-5.48, 56.42],
              [-5.48, 56.4],
            ],
          ],
        },
      },
    },
  });
  const plugin = createPlugin(fixture.app);
  plugin.start({
    autoProfile: {
      enabled: true,
      enterDistanceMeters: 100,
      exitDistanceMeters: 500,
    },
    calculationDelayMs: 0,
    profile: "coastal",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  fixture.messages.length = 0;

  for (const latitude of [56.43, 56.431, 56.432]) {
    fixture.deltaHandler({
      context: fixture.app.selfId,
      updates: [
        {
          timestamp: new Date().toISOString(),
          values: [
            {
              path: "navigation.position",
              value: { latitude, longitude: -5.47 },
            },
            { path: "navigation.speedOverGround", value: 2 },
          ],
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const autoProfileValues = fixture.messages
    .flatMap((message) => message.updates.flatMap((update) => update.values))
    .filter((value) => value.path === "plugins.ajrmMarineTraffic.autoProfile");

  assert.equal(autoProfileValues.length, 1);
  assert.equal(autoProfileValues[0].value.profile, "coastal");
  assert.equal(autoProfileValues[0].value.nearestRegionName, "Harbour: Oban");
  plugin.stop();
});

test("Auto Profile publication signature ignores refresh-only harbour metadata", () => {
  const baseProjection = {
    enabled: true,
    profile: "coastal",
    settings: {
      enabled: true,
      harbourProfile: "harbor",
      outsideProfile: "coastal",
    },
    regionCount: 1,
    regionsLoadedAt: "2026-06-22T20:00:00.000Z",
    insideRegionId: null,
    insideRegionName: null,
    nearestRegionId: "craobh",
    nearestRegionName: "Harbour: Craobh Marina",
    distanceMeters: 500,
    anchorHeld: false,
    lastProfileSet: "coastal",
    lastProfileChangeTs: "2026-06-22T19:58:19.950Z",
    lastError: null,
  };

  assert.equal(
    autoProfilePublicationSignature(baseProjection),
    autoProfilePublicationSignature({
      ...baseProjection,
      regionsLoadedAt: "2026-06-22T20:01:00.000Z",
      distanceMeters: 650,
    }),
  );
});

test("Traffic does not announce outside profile while harbour regions are loading", async () => {
  const fixture = fakeApp({
    resourceDelayMs: 25,
    regions: {
      oban: {
        name: "Harbour: Oban",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-5.48, 56.4],
              [-5.46, 56.4],
              [-5.46, 56.42],
              [-5.48, 56.42],
              [-5.48, 56.4],
            ],
          ],
        },
      },
    },
  });
  const plugin = createPlugin(fixture.app);
  plugin.start({
    calculationDelayMs: 0,
    profile: "harbor",
  });
  fixture.deltaHandler({
    context: fixture.app.selfId,
    updates: [
      {
        timestamp: new Date().toISOString(),
        values: [
          {
            path: "navigation.position",
            value: { latitude: 56.41, longitude: -5.47 },
          },
          { path: "navigation.speedOverGround", value: 2 },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  let values = fixture.messages.flatMap((message) =>
    message.updates.flatMap((update) => update.values),
  );
  assert.equal(
    values.some(
      (value) =>
        value.path === "notifications.system.ajrmMarineTraffic.profile-coastal",
    ),
    false,
  );

  await new Promise((resolve) => setTimeout(resolve, 35));
  values = fixture.messages.flatMap((message) =>
    message.updates.flatMap((update) => update.values),
  );
  const autoProfile = values
    .filter((value) => value.path === "plugins.ajrmMarineTraffic.autoProfile")
    .at(-1).value;
  assert.equal(autoProfile.profile, "harbor");
  assert.equal(autoProfile.insideRegionName, "Harbour: Oban");
  assert.equal(
    values.some(
      (value) =>
        value.path === "notifications.system.ajrmMarineTraffic.profile-coastal",
    ),
    false,
  );
  plugin.stop();
});

test("Traffic queues deltas until harbour startup readiness completes", async () => {
  const fixture = fakeApp({
    resourceDelayMs: 25,
    regions: {
      oban: {
        name: "Harbour: Oban",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-5.48, 56.4],
              [-5.46, 56.4],
              [-5.46, 56.42],
              [-5.48, 56.42],
              [-5.48, 56.4],
            ],
          ],
        },
      },
    },
  });
  const plugin = createPlugin(fixture.app);
  plugin.start({
    calculationDelayMs: 0,
    profile: "harbor",
  });
  fixture.deltaHandler({
    context: fixture.app.selfId,
    updates: [
      {
        timestamp: new Date().toISOString(),
        values: [
          {
            path: "navigation.position",
            value: { latitude: 56.41, longitude: -5.47 },
          },
          { path: "navigation.speedOverGround", value: 2 },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  let values = fixture.messages.flatMap((message) =>
    message.updates.flatMap((update) => update.values),
  );
  assert.equal(
    values.some(
      (value) => value.path === "notifications.system.ajrmMarineTraffic.gps-received",
    ),
    false,
  );

  await new Promise((resolve) => setTimeout(resolve, 35));
  values = fixture.messages.flatMap((message) =>
    message.updates.flatMap((update) => update.values),
  );
  assert.equal(
    values.some(
      (value) => value.path === "notifications.system.ajrmMarineTraffic.gps-received",
    ),
    true,
  );
  assert.match(fixture.pluginStatus, /AJRM Marine Traffic/);
  plugin.stop();
});

test("Traffic flags harbour startup timeout without selecting outside profile", async () => {
  const fixture = fakeApp({
    resourceDelayMs: 50,
    regions: {
      oban: {
        name: "Harbour: Oban",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-5.48, 56.4],
              [-5.46, 56.4],
              [-5.46, 56.42],
              [-5.48, 56.42],
              [-5.48, 56.4],
            ],
          ],
        },
      },
    },
  });
  const plugin = createPlugin(fixture.app);
  plugin.start({
    calculationDelayMs: 0,
    profile: "harbor",
    startupHarbourTimeoutMs: 10,
  });
  fixture.deltaHandler({
    context: fixture.app.selfId,
    updates: [
      {
        timestamp: new Date().toISOString(),
        values: [
          {
            path: "navigation.position",
            value: { latitude: 56.43, longitude: -5.47 },
          },
          { path: "navigation.speedOverGround", value: 2 },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 25));

  const values = fixture.messages.flatMap((message) =>
    message.updates.flatMap((update) => update.values),
  );
  const autoProfile = values
    .filter((value) => value.path === "plugins.ajrmMarineTraffic.autoProfile")
    .at(-1).value;
  assert.equal(autoProfile.profile, "harbor");
  assert.match(autoProfile.status, /unavailable/i);
  assert.match(fixture.pluginError, /timed out/i);
  assert.equal(
    values.some(
      (value) =>
        value.path === "notifications.system.ajrmMarineTraffic.profile-coastal",
    ),
    false,
  );
  plugin.stop();
});

test("Traffic persists auto-selected profile to avoid restart repeats", async () => {
  const fixture = fakeApp({
    regions: {
      oban: {
        name: "Harbour: Oban",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-5.48, 56.4],
              [-5.46, 56.4],
              [-5.46, 56.42],
              [-5.48, 56.42],
              [-5.48, 56.4],
            ],
          ],
        },
      },
    },
  });
  const firstPlugin = createPlugin(fixture.app);
  firstPlugin.start({
    calculationDelayMs: 0,
    profile: "harbor",
  });
  fixture.deltaHandler({
    context: fixture.app.selfId,
    updates: [
      {
        timestamp: new Date().toISOString(),
        values: [
          {
            path: "navigation.position",
            value: { latitude: 56.43, longitude: -5.47 },
          },
          { path: "navigation.speedOverGround", value: 2 },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  let values = fixture.messages.flatMap((message) =>
    message.updates.flatMap((update) => update.values),
  );
  assert.equal(fixture.savedOptions.profile, "coastal");
  assert.equal(
    values.filter(
      (value) =>
        value.path === "notifications.system.ajrmMarineTraffic.profile-coastal",
    ).length,
    1,
  );
  firstPlugin.stop();

  const beforeRestartMessages = fixture.messages.length;
  const secondPlugin = createPlugin(fixture.app);
  secondPlugin.start({
    ...fixture.savedOptions,
    calculationDelayMs: 0,
  });
  fixture.deltaHandler({
    context: fixture.app.selfId,
    updates: [
      {
        timestamp: new Date().toISOString(),
        values: [
          {
            path: "navigation.position",
            value: { latitude: 56.43, longitude: -5.47 },
          },
          { path: "navigation.speedOverGround", value: 2 },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  values = fixture.messages
    .slice(beforeRestartMessages)
    .flatMap((message) => message.updates.flatMap((update) => update.values));
  assert.equal(
    values.some(
      (value) =>
        value.path === "notifications.system.ajrmMarineTraffic.profile-coastal",
    ),
    false,
  );
  secondPlugin.stop();
});

test("Traffic does not announce auto-unmute on first moving sample", async () => {
  const fixture = fakeApp();
  const plugin = createPlugin(fixture.app);
  plugin.start({
    automuteStationary: true,
    calculationDelayMs: 0,
    profile: "harbor",
  });
  fixture.deltaHandler({
    context: fixture.app.selfId,
    updates: [
      {
        timestamp: new Date().toISOString(),
        values: [
          {
            path: "navigation.position",
            value: { latitude: 56.41, longitude: -5.47 },
          },
          { path: "navigation.speedOverGround", value: 2 },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const values = fixture.messages.flatMap((message) =>
    message.updates.flatMap((update) => update.values),
  );
  assert.equal(
    values.some(
      (value) =>
        value.path === "notifications.system.ajrmMarineTraffic.auto-unmute",
    ),
    false,
  );
  plugin.stop();
});

test("Traffic does not auto-unmute a manual mute on restart while moving", async () => {
  const fixture = fakeApp();
  const plugin = createPlugin(fixture.app);
  plugin.start({
    automuteStationary: true,
    calculationDelayMs: 0,
    muted: true,
    profile: "harbor",
  });
  fixture.deltaHandler({
    context: fixture.app.selfId,
    updates: [
      {
        timestamp: new Date().toISOString(),
        values: [
          {
            path: "navigation.position",
            value: { latitude: 56.41, longitude: -5.47 },
          },
          { path: "navigation.speedOverGround", value: 2 },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const values = fixture.messages.flatMap((message) =>
    message.updates.flatMap((update) => update.values),
  );
  const audio = values
    .filter((value) => value.path === "plugins.ajrmMarineTraffic.audioPolicy")
    .at(-1).value;
  assert.equal(audio.muted, true);
  assert.equal(
    values.some(
      (value) =>
        value.path === "notifications.system.ajrmMarineTraffic.auto-unmute",
    ),
    false,
  );
  plugin.stop();
});

test("Traffic does not persist runtime stationary automute as manual mute", async () => {
  const fixture = fakeApp();
  const plugin = createPlugin(fixture.app);
  plugin.start({
    automuteStationary: true,
    autoProfile: { enabled: false },
    calculationDelayMs: 0,
    muted: false,
    profile: "harbor",
  });

  for (let index = 0; index < 3; index += 1) {
    fixture.deltaHandler({
      context: fixture.app.selfId,
      updates: [
        {
          timestamp: new Date(Date.now() + index).toISOString(),
          values: [
            {
              path: "navigation.position",
              value: { latitude: 56.41, longitude: -5.47 },
            },
            { path: "navigation.speedOverGround", value: 0 },
          ],
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const values = fixture.messages.flatMap((message) =>
    message.updates.flatMap((update) => update.values),
  );
  assert.equal(
    values.some(
      (value) => value.path === "notifications.system.ajrmMarineTraffic.auto-mute",
    ),
    true,
  );
  assert.equal(fixture.savedOptions, null);
  plugin.stop();
});

test("AJRM Marine Traffic emits All's well after quiet period when enabled", async () => {
  const fixture = fakeApp();
  const plugin = createPlugin(fixture.app);
  const originalNow = Date.now;
  const firstTime = new Date("2026-06-22T12:00:00.000Z").getTime();
  const laterTime = new Date("2026-06-22T12:02:00.000Z").getTime();
  Date.now = () => firstTime;
  try {
    plugin.start({
      calculationDelayMs: 0,
      profile: "coastal",
      allWellEnabled: true,
      allWellMessage: "All is well on test.",
      allWellIntervalMinutes: 1,
    });
    fixture.deltaHandler({
      context: fixture.app.selfId,
      updates: [
        {
          timestamp: new Date(firstTime).toISOString(),
          values: [
            {
              path: "navigation.position",
              value: { latitude: 56.41, longitude: -5.47 },
            },
            { path: "navigation.speedOverGround", value: 2 },
          ],
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    Date.now = () => laterTime;
    fixture.deltaHandler({
      context: fixture.app.selfId,
      updates: [
        {
          timestamp: new Date(laterTime).toISOString(),
          values: [
            {
              path: "navigation.position",
              value: { latitude: 56.4101, longitude: -5.4701 },
            },
            { path: "navigation.speedOverGround", value: 2.1 },
          ],
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    Date.now = originalNow;
    plugin.stop();
  }

  const values = fixture.messages.flatMap((message) =>
    message.updates.flatMap((update) => update.values),
  );
  const allWell = values.find(
    (value) => value.path === "notifications.system.ajrmMarineTraffic.all-well",
  );
  assert.ok(allWell);
  assert.equal(allWell.value.message, "All is well on test.");
  assert.deepEqual(allWell.value.method, ["visual", "sound"]);
  assert.equal(
    allWell.value.data.ajrmMarineNotifications.presentation.label,
    "All's well",
  );
});

test("AJRM Marine Traffic accepts safety-affecting commands when enabled", () => {
  const fixture = fakeApp();
  const plugin = createPlugin(fixture.app);
  const router = fakeRouter();
  plugin.registerWithRouter(router);
  plugin.start({});
  const response = invokeRoute(router, "post", "/commands/profile", {
    body: { profile: "coastal" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.profile, "coastal");
  plugin.stop();
});

function fakeApp({ regions = {}, resourceDelayMs = 0, metadata = {} } = {}) {
  const messages = [];
  let deltaHandler = null;
  let savedOptions = null;
  let pluginStatus = "";
  let pluginError = "";
  const app = {
    selfId: "urn:mrn:imo:mmsi:235008635",
    getSelfPath(path) {
      return path === "mmsi" ? "235008635" : null;
    },
    getMetadata(path) {
      return metadata[path];
    },
    subscriptionmanager: {
      subscribe(_subscription, unsubscribes, _onError, handler) {
        deltaHandler = handler;
        unsubscribes.push(() => {});
      },
    },
    resourcesApi: {
      async listResources(type) {
        assert.equal(type, "regions");
        if (resourceDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, resourceDelayMs));
        }
        return regions;
      },
    },
    handleMessage(_pluginId, message) {
      messages.push(message);
    },
    savePluginOptions(value, callback) {
      savedOptions = value;
      callback?.();
    },
    setPluginStatus(value) {
      pluginStatus = String(value || "");
    },
    setPluginError(value) {
      pluginError = String(value || "");
    },
    debug() {},
    error() {},
  };
  return {
    app,
    messages,
    get savedOptions() {
      return savedOptions;
    },
    get pluginStatus() {
      return pluginStatus;
    },
    get pluginError() {
      return pluginError;
    },
    get deltaHandler() {
      return deltaHandler;
    },
  };
}

function fakeRouter() {
  const routes = new Map();
  return {
    routes,
    get(path, handler) {
      routes.set(`get ${path}`, handler);
    },
    post(path, handler) {
      routes.set(`post ${path}`, handler);
    },
    put(path, handler) {
      routes.set(`put ${path}`, handler);
    },
  };
}

function invokeRoute(router, method, path, request = {}) {
  const handler = router.routes.get(`${method} ${path}`);
  assert.ok(handler, `missing route ${method} ${path}`);
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  handler({ body: {}, params: {}, ...request }, response);
  return response;
}
