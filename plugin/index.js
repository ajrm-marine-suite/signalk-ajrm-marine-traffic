"use strict";

const { randomUUID } = require("node:crypto");
const packageInfo = require("../package.json");
const openApi = require("./openApi.json");
const {
  calculateProjection,
  createTrafficCore,
  ingestDelta,
  setProfile,
  setProfileSettings,
  setTargetSilenced,
  unsilenceAllTargets,
} = require("./lib/traffic-core");
const {
  clearAllNotifications,
  createNotificationPublisher,
  reconcileNotifications,
  systemEventNotification,
} = require("./lib/notification-publisher");
const {
  DEFAULT_AUTO_PROFILE_OPTIONS,
  autoProfileProjection,
  createAutoProfileState,
  evaluateAutoProfile,
  normalizeAutoProfileOptions,
} = require("./lib/auto-profile");
const {
  DEFAULT_ALL_WELL_INTERVAL_MINUTES,
  DEFAULT_ALL_WELL_MESSAGE,
  DEFAULT_AUTOMUTE_STATIONARY_SPEED,
  applyAudioPolicyCommand,
  audioPolicyProjection,
  createAudioPolicy,
  evaluateAudioPolicy,
} = require("./lib/audio-policy");
const { loadHarbourRegionResources } = require("./lib/harbour-region-loader");
const { normalizeProfileSettings } = require("./lib/profiles");
const { voyageStateProjection } = require("./lib/voyage-state");

const PLUGIN_ID = "signalk-ajrm-marine-traffic";
const TARGETS_PATH = "plugins.ajrmMarineTraffic.targets";
const CAPABILITIES_PATH = "plugins.ajrmMarineTraffic.capabilities";
const AUTO_PROFILE_PATH = "plugins.ajrmMarineTraffic.autoProfile";
const AUDIO_POLICY_PATH = "plugins.ajrmMarineTraffic.audioPolicy";
const PROFILES_PATH = "plugins.ajrmMarineTraffic.profiles";
const VOYAGE_STATE_PATH = "plugins.ajrmMarineTraffic.voyageState";
const ALLOWED_OUTPUT_PREFIX = "plugins.ajrmMarineTraffic.";
const STARTUP_HARBOUR_TIMEOUT_MS = 10000;
const MAX_STARTUP_QUEUE = 1000;
const GPS_RECOVERY_ANNOUNCE_MIN_OUTAGE_MS = 20000;
const CPA_DISTANCE_METADATA_PATHS = [
  "navigation.closestApproach.distance",
  "navigation.courseGreatCircle.distance",
  "navigation.courseRhumbline.distance",
];

module.exports = function ajrmMarineTraffic(app) {
  const plugin = {};
  let options = normalizeOptions({});
  let state = createTrafficCore();
  let projection = null;
  let notificationPublisher = createNotificationPublisher();
  let unsubscribes = [];
  let calculationTimer = null;
  let harbourRefreshTimer = null;
  let autoProfileState = createAutoProfileState();
  let autoProfileSequence = 0;
  let lastAutoProfileProjection = null;
  let lastAutoProfilePublicationSignature = null;
  let audioPolicy = createAudioPolicy();
  let audioPolicySequence = 0;
  let lastAudioPolicyProjection = null;
  let voyageStateSequence = 0;
  let lastVoyageStateProjection = null;
  let lastAllWellAtMs = 0;
  let lastOwnPositionLostAtMs = null;
  let startupReady = true;
  let startupQueue = [];
  let startupGeneration = 0;

  plugin.id = PLUGIN_ID;
  plugin.name = "AJRM Marine Traffic";
  plugin.description =
    "Authoritative AJRM Marine AIS traffic-analysis core with notifications, commands, and a dedicated administration webapp.";
  plugin.schema = {
    type: "object",
    properties: {
      profile: {
        type: "string",
        title: "Traffic profile",
        enum: ["anchor", "harbor", "coastal", "offshore"],
        default: "harbor",
      },
      calculationDelayMs: {
        type: "integer",
        title: "Calculation coalescing delay (ms)",
        default: 100,
        minimum: 0,
        maximum: 5000,
      },
      ownPositionMaxAgeSeconds: {
        type: "integer",
        title: "Maximum own-vessel position age (seconds)",
        default: 30,
        minimum: 5,
        maximum: 300,
      },
      startupHarbourTimeoutMs: {
        type: "integer",
        title: "Startup harbour-region timeout (ms)",
        default: STARTUP_HARBOUR_TIMEOUT_MS,
        minimum: 10,
        maximum: 60000,
      },
      profiles: {
        type: "object",
        title: "Per-profile Traffic settings",
        description:
          "AJRM Marine Traffic CPA, TCPA, repeat sensitivity, and stationary automute settings for each sailing profile.",
      },
      autoProfile: {
        type: "object",
        title: "Auto Profile Switch",
        properties: {
          enabled: {
            type: "boolean",
            title: "Enable Auto Profile Switch",
            default: DEFAULT_AUTO_PROFILE_OPTIONS.enabled,
          },
          harbourRegionNamePrefix: {
            type: "string",
            title: "Harbour region name prefix",
            default: DEFAULT_AUTO_PROFILE_OPTIONS.harbourRegionNamePrefix,
          },
          harbourProfile: {
            type: "string",
            title: "Profile inside harbour regions",
            enum: ["anchor", "harbor", "coastal", "offshore"],
            default: DEFAULT_AUTO_PROFILE_OPTIONS.harbourProfile,
          },
          outsideProfile: {
            type: "string",
            title: "Profile outside harbour regions",
            enum: ["anchor", "harbor", "coastal", "offshore"],
            default: DEFAULT_AUTO_PROFILE_OPTIONS.outsideProfile,
          },
          anchorReleaseSpeed: {
            type: "number",
            title: "Anchor release speed (m/s)",
            minimum: 0,
            default: DEFAULT_AUTO_PROFILE_OPTIONS.anchorReleaseSpeed,
          },
          enterDistanceMeters: {
            type: "number",
            title: "Enter harbour distance (m)",
            minimum: 0,
            default: DEFAULT_AUTO_PROFILE_OPTIONS.enterDistanceMeters,
          },
          exitDistanceMeters: {
            type: "number",
            title: "Leave harbour distance (m)",
            minimum: 0,
            default: DEFAULT_AUTO_PROFILE_OPTIONS.exitDistanceMeters,
          },
          refreshRegionsSeconds: {
            type: "number",
            title: "Refresh harbour regions (seconds)",
            minimum: 10,
            default: DEFAULT_AUTO_PROFILE_OPTIONS.refreshRegionsSeconds,
          },
        },
      },
      muted: {
        type: "boolean",
        title: "Mute all AJRM Marine audio",
        default: false,
      },
      automuteStationary: {
        type: "boolean",
        title: "Enable stationary automute master switch",
        default: true,
      },
      automuteStationarySpeed: {
        type: "number",
        title: "Automute stationary speed (m/s)",
        minimum: 0,
        default: DEFAULT_AUTOMUTE_STATIONARY_SPEED,
      },
      allWellEnabled: {
        type: "boolean",
        title: "Enable All's well reassurance",
        default: true,
      },
      allWellMessage: {
        type: "string",
        title: "All's well message",
        default: DEFAULT_ALL_WELL_MESSAGE,
      },
      allWellIntervalMinutes: {
        type: "number",
        title: "All's well quiet period (minutes)",
        minimum: 1,
        default: DEFAULT_ALL_WELL_INTERVAL_MINUTES,
      },
    },
  };

  plugin.start = (pluginOptions = {}) => {
    options = normalizeOptions(pluginOptions);
    state = createTrafficCore({
      profile: options.profile,
      ownPositionMaxAgeSeconds: options.ownPositionMaxAgeSeconds,
      profileSettings: options.profiles,
    });
    notificationPublisher = createNotificationPublisher({
      sessionId: state.sessionId,
      distanceUnit: preferredDistanceUnit(),
    });
    autoProfileState = createAutoProfileState();
    autoProfileSequence = 0;
    audioPolicy = createAudioPolicy(options);
    audioPolicySequence = 0;
    lastAudioPolicyProjection = null;
    voyageStateSequence = 0;
    lastVoyageStateProjection = null;
    lastAllWellAtMs = Date.now();
    lastOwnPositionLostAtMs = null;
    startupReady = false;
    startupQueue = [];
    const generation = (startupGeneration += 1);
    projection = calculateProjection(state);
    if (shouldMaterializeDefaultOptions(pluginOptions)) persistOptions();
    subscribe();
    publish();
    app.setPluginStatus(`${statusText()}; starting Auto Profile`);
    startHarbourSubsystem(generation);
    debug("traffic.starting", {
      sessionId: state.sessionId,
      sequence: projection.sequence,
      profile: options.profile,
    });
  };

  plugin.stop = () => {
    if (calculationTimer) clearTimeout(calculationTimer);
    if (harbourRefreshTimer) clearInterval(harbourRefreshTimer);
    calculationTimer = null;
    harbourRefreshTimer = null;
    startupReady = true;
    startupQueue = [];
    startupGeneration += 1;
    for (const unsubscribe of unsubscribes) {
      try {
        unsubscribe();
      } catch (error) {
        app.debug(`[${PLUGIN_ID}] unsubscribe failed: ${error.message}`);
      }
    }
    unsubscribes = [];
    publishNotifications(clearAllNotifications(notificationPublisher));
  };

  plugin.registerWithRouter = (router) => {
    router.get("/status", (_req, res) => {
      res.json({
        ok: true,
        plugin: PLUGIN_ID,
        version: packageInfo.version,
        capabilities: capabilities(),
        targets: projection,
        autoProfile: currentAutoProfileProjection(),
        audioPolicy: currentAudioPolicyProjection(),
        voyageState: currentVoyageStateProjection(),
        profiles: currentProfiles(),
      });
    });
    router.get("/commands", (_req, res) => res.json(commandState()));
    router.get("/commands/profiles", (_req, res) => res.json(currentProfiles()));
    router.put("/commands/profiles", profilesCommand);
    router.post("/commands/profiles", profilesCommand);
    router.get("/commands/auto-profile", (_req, res) =>
      res.json(currentAutoProfileProjection()),
    );
    router.put("/commands/auto-profile", autoProfileCommand);
    router.post("/commands/auto-profile", autoProfileCommand);
    router.get("/commands/audio", (_req, res) =>
      res.json(currentAudioPolicyProjection()),
    );
    router.put("/commands/audio", audioCommand);
    router.post("/commands/audio", audioCommand);
    router.put("/commands/profile", profileCommand);
    router.post("/commands/profile", profileCommand);
    router.put("/commands/targets/:identity/silence", silenceCommand);
    router.post("/commands/targets/:identity/silence", silenceCommand);
    router.post("/commands/unsilence-all", (_req, res) => {
      const unsilenced = unsilenceAllTargets(state);
      recalculate();
      debug("traffic.command.unsilence-all", {
        sessionId: state.sessionId,
        sequence: projection.sequence,
        unsilenced,
      });
      res.json({ ok: true, unsilenced, commands: commandState() });
    });
  };
  plugin.getOpenApi = () => openApi;

  return plugin;

  function subscribe() {
    if (!app.subscriptionmanager?.subscribe) {
      app.error(`[${PLUGIN_ID}] Signal K subscription manager unavailable`);
      return;
    }
    app.subscriptionmanager.subscribe(
      {
        context: "*",
        subscribe: [
          { path: "", period: 1000 },
          { path: "mmsi", period: 1000 },
          { path: "name", period: 1000 },
          { path: "navigation.position", period: 1000 },
          { path: "navigation.speedOverGround", period: 1000 },
          { path: "navigation.speedThroughWater", period: 1000 },
          { path: "navigation.courseOverGroundTrue", period: 1000 },
          { path: "navigation.headingTrue", period: 1000 },
          { path: "navigation.state", period: 1000 },
          { path: "design.length", period: 1000 },
          { path: "design.beam", period: 1000 },
          { path: "design.aisShipDimensions", period: 1000 },
          { path: "sensors.ais.class", period: 1000 },
          { path: "sensors.ais.fromBow", period: 1000 },
          { path: "sensors.ais.fromCenter", period: 1000 },
          { path: "atonType", period: 1000 },
          { path: "plugins.ajrmMarineLogger.playback", policy: "instant", format: "delta" }
        ],
      },
      unsubscribes,
      (error) => app.error(`[${PLUGIN_ID}] subscription error: ${error}`),
      handleDelta,
    );
  }

  function handleDelta(delta) {
    if (!startupReady) {
      if (startupQueue.length >= MAX_STARTUP_QUEUE) startupQueue.shift();
      startupQueue.push(delta);
      return;
    }
    processDelta(delta);
  }

  function processDelta(delta) {
    const normalizedDelta = isSelfContext(delta?.context)
      ? { ...delta, context: "vessels.self" }
      : delta;
    if (!ingestDelta(state, normalizedDelta)) return;
    if (calculationTimer) clearTimeout(calculationTimer);
    calculationTimer = setTimeout(recalculate, options.calculationDelayMs);
  }

  function isSelfContext(context) {
    const value = String(context || "");
    const selfId = String(app.selfId || "");
    const selfMmsi = String(app.getSelfPath?.("mmsi") || "");
    return (
      value === "vessels.self" ||
      (selfId && (value === selfId || value === `vessels.${selfId}`)) ||
      (selfMmsi &&
        (value === selfMmsi ||
          value.endsWith(`:mmsi:${selfMmsi}`) ||
          value === `vessels.${selfMmsi}`))
    );
  }

  function recalculate() {
    calculationTimer = null;
    const now = new Date(Date.now()).toISOString();
    const previousOwnPositionFresh =
      projection?.source?.ownVesselPositionFresh === true;
    const suppressReplayWarmupNotifications = state.ajrmMarineLoggerPlaybackWarmup === true;
    const systemNotifications = suppressReplayWarmupNotifications ? [] : applyPolicies(now);
    projection = calculateProjection(state, now);
    const allWellNotification = suppressReplayWarmupNotifications
      ? null
      : maybeAllWellNotification(now);
    if (allWellNotification) systemNotifications.push(allWellNotification);
    publish();
    notificationPublisher.distanceUnit = preferredDistanceUnit();
    notificationPublisher.muteState = audioPolicy.muted;
    const ownPositionFresh = projection.source.ownVesselPositionFresh === true;
    const nowMs = Date.parse(now) || Date.now();
    if (!suppressReplayWarmupNotifications && previousOwnPositionFresh && !ownPositionFresh) {
      lastOwnPositionLostAtMs = nowMs;
    }
    if (!suppressReplayWarmupNotifications && !previousOwnPositionFresh && ownPositionFresh) {
      const outageMs =
        lastOwnPositionLostAtMs === null ? null : nowMs - lastOwnPositionLostAtMs;
      const announceRecovery =
        outageMs === null || outageMs >= GPS_RECOVERY_ANNOUNCE_MIN_OUTAGE_MS;
      lastOwnPositionLostAtMs = null;
      if (announceRecovery) {
        systemNotifications.push(
          systemEventNotification(
            notificationPublisher,
            {
              key: "gps-received",
              title: "GPS",
              label: "GPS received",
              message: "GPS received.",
              category: "gps",
              supersedes: ["navigation.gnss.integrity"],
              expiresSeconds: 15,
            },
            now,
          ),
        );
      }
    }
    publishNotifications(systemNotifications);
    if (!suppressReplayWarmupNotifications) {
      publishNotifications(
        reconcileNotifications(notificationPublisher, projection),
      );
    }
    for (const target of projection.targets) {
      debug("traffic.target", {
        sessionId: state.sessionId,
        sequence: projection.sequence,
        correlationId: target.encounter.correlationId,
        target: target.mmsi || target.id,
        state: target.encounter.state,
        cpaM: target.encounter.cpa,
        tcpaS: target.encounter.tcpa,
      });
    }
  }

  function publish() {
    publishValue(CAPABILITIES_PATH, capabilities());
    publishValue(TARGETS_PATH, projection);
    publishAutoProfile();
    publishValue(AUDIO_POLICY_PATH, currentAudioPolicyProjection(true));
    publishValue(VOYAGE_STATE_PATH, currentVoyageStateProjection(true));
    publishValue(PROFILES_PATH, currentProfiles());
  }

  function publishAutoProfile() {
    const nextProjection = buildAutoProfileProjection(autoProfileSequence);
    const nextSignature = autoProfilePublicationSignature(nextProjection);
    if (nextSignature === lastAutoProfilePublicationSignature) return;
    autoProfileSequence += 1;
    lastAutoProfileProjection = buildAutoProfileProjection(autoProfileSequence);
    lastAutoProfilePublicationSignature = nextSignature;
    publishValue(AUTO_PROFILE_PATH, lastAutoProfileProjection);
  }

  function publishValue(path, value) {
    if (!path.startsWith(ALLOWED_OUTPUT_PREFIX)) {
      throw new Error(`AJRM Marine Traffic blocked unsafe output path: ${path}`);
    }
    app.handleMessage(PLUGIN_ID, {
      context: "vessels.self",
      updates: [{ values: [{ path, value }] }],
    });
  }

  function publishNotifications(outputs) {
    for (const output of outputs) {
      if (!output.path.startsWith("notifications.")) {
        throw new Error(`AJRM Marine Traffic blocked unsafe notification path: ${output.path}`);
      }
      app.handleMessage(PLUGIN_ID, {
        context: "vessels.self",
        updates: [{ values: [output] }],
      });
      debug(output.value === null ? "traffic.notification.clear" : "traffic.notification.publish", {
        sessionId: state.sessionId,
        sequence: projection?.sequence,
        correlationId:
          output.value?.data?.ajrmMarineNotifications?.correlationId || "",
        subjectKey: output.value?.data?.ajrmMarineNotifications?.subjectKey || "",
        path: output.path,
        state: output.value?.state || "normal",
      });
    }
  }

  function preferredDistanceUnit() {
    for (const pathName of CPA_DISTANCE_METADATA_PATHS) {
      const metadata = app.getMetadata?.(pathName);
      const unit = normalizeMetadataDistanceUnit(
        metadata?.displayUnits?.targetUnit ||
          metadata?.displayUnits?.units ||
          metadata?.displayUnits?.symbol,
      );
      if (unit) return unit;
    }
    return "nmi";
  }

  function normalizeMetadataDistanceUnit(unit) {
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
    if (["nm", "nmi", "nauticalmile", "nauticalmiles"].includes(text)) return "nmi";
    return "";
  }

  function capabilities() {
    return {
      contract: "ajrm-marine-traffic-capabilities",
      contractVersion: 1,
      sessionId: state.sessionId,
      mode: "traffic",
      authoritative: true,
      notificationsEnabled: true,
      commandsEnabled: true,
      profile: state.profile,
      autoProfile: true,
      audioPolicy: true,
      voyageState: true,
      version: packageInfo.version,
    };
  }

  function statusText() {
    return `AJRM Marine Traffic v${packageInfo.version}; authoritative notifications and commands enabled`;
  }

  function profileCommand(req, res) {
    const profile = String(req.body?.profile || "");
    try {
      setProfile(state, profile);
      options.profile = profile;
      if (
        profile === options.autoProfile.harbourProfile &&
        options.autoProfile.enabled &&
        Number(autoProfileState.distanceMeters) >
          options.autoProfile.enterDistanceMeters
      ) {
        options.autoProfile.enabled = false;
        autoProfileState.lastWarning =
          "Auto selection disabled because Harbour was selected outside a known harbour.";
        autoProfileState.lastMessage = "Auto selection OFF.";
      }
      recalculate();
      persistOptions();
      debug("traffic.command.profile", {
        sessionId: state.sessionId,
        sequence: projection.sequence,
        profile,
      });
      res.json({ ok: true, profile, commands: commandState() });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  }

  function profilesCommand(req, res) {
    try {
      const settings = setProfileSettings(state, req.body || {});
      options.profile = state.profile;
      options.profiles = settings;
      evaluateAudioPolicy(audioPolicy, state.profile, state.own.sog, {
        force: true,
        ownStw: state.own.stw,
        profileSettings: state.profileSettings,
      });
      recalculate();
      persistOptions();
      debug("traffic.command.profiles", {
        sessionId: state.sessionId,
        sequence: projection.sequence,
        profile: state.profile,
      });
      res.json({ ok: true, profiles: currentProfiles(), commands: commandState() });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  }

  function autoProfileCommand(req, res) {
    options.autoProfile = normalizeAutoProfileOptions({
      ...options.autoProfile,
      ...(req.body || {}),
    });
    autoProfileState.lastWarning = null;
    if (req.body?.refresh === true) refreshHarbourRegions();
    recalculate();
    startHarbourRefreshTimer();
    persistOptions();
    res.json({ ok: true, autoProfile: currentAutoProfileProjection() });
  }

  function audioCommand(req, res) {
    const previousMuted = audioPolicy.muted;
    applyAudioPolicyCommand(audioPolicy, {
      ...(req.body || {}),
      ownSog: state.own.sog,
      ownStw: state.own.stw,
    });
    evaluateAudioPolicy(audioPolicy, state.profile, state.own.sog, {
      ownStw: state.own.stw,
      force: req.body?.automuteStationary !== undefined,
      profileSettings: state.profileSettings,
    });
    if (previousMuted !== audioPolicy.muted || req.body?.muted !== undefined) {
      audioPolicy.correlationId = randomUUID();
      audioPolicy.updatedAt = new Date().toISOString();
    }
    if (
      req.body?.allWellEnabled !== undefined ||
      req.body?.allWellMessage !== undefined ||
      req.body?.allWellIntervalMinutes !== undefined
    ) {
      lastAllWellAtMs = Date.now();
    }
    publish();
    persistOptions();
    res.json({ ok: true, audio: currentAudioPolicyProjection() });
  }

  function silenceCommand(req, res) {
    const identity = String(req.params?.identity || "");
    const silenced = req.body?.silenced !== false;
    const target = setTargetSilenced(state, identity, silenced);
    if (!target) {
      res.status(404).json({ ok: false, error: `Target not found: ${identity}` });
      return;
    }
    recalculate();
    debug("traffic.command.silence", {
      sessionId: state.sessionId,
      sequence: projection.sequence,
      target: target.mmsi || target.id,
      silenced,
    });
    res.json({ ok: true, target, commands: commandState() });
  }

  function commandState() {
    return {
      contract: "ajrm-marine-traffic-commands",
      contractVersion: 1,
      sessionId: state.sessionId,
      enabled: true,
      profile: state.profile,
      profiles: currentProfiles(),
      autoProfile: currentAutoProfileProjection(),
      audioPolicy: currentAudioPolicyProjection(),
      voyageState: currentVoyageStateProjection(),
      silencedTargets: Array.from(state.silencedTargets),
      runtimeOnly: typeof app.savePluginOptions !== "function",
    };
  }

  function debug(event, fields) {
    app.debug(
      `[${PLUGIN_ID}] event=${event} ${Object.entries(fields)
        .map(([key, value]) => `${key}=${value ?? ""}`)
        .join(" ")}`,
    );
  }

  function persistOptions() {
    if (typeof app.savePluginOptions !== "function") return;
    app.savePluginOptions(
      {
        ...options,
        profile: state.profile,
        profiles: currentProfiles(),
        muted: audioPolicy.muted,
        automuteStationary: audioPolicy.automuteStationary,
        automuteStationarySpeed: audioPolicy.automuteStationarySpeed,
        allWellEnabled: audioPolicy.allWellEnabled,
        allWellMessage: audioPolicy.allWellMessage,
        allWellIntervalMinutes: audioPolicy.allWellIntervalMinutes,
      },
      (error) => {
        if (error) {
          app.error(`[${PLUGIN_ID}] unable to save AJRM Marine Traffic settings: ${error.message || error}`);
        }
      },
    );
  }

  function applyPolicies(now = new Date().toISOString()) {
    const systemNotifications = [];
    const autoResult = evaluateAutoProfile({
      currentProfile: state.profile,
      options: options.autoProfile,
      ownPosition: state.own.position,
      ownSog: state.own.sog,
      regions: autoProfileState.regions,
      state: autoProfileState,
      now,
    });
    autoProfileState = {
      ...autoResult.state,
      regions: autoProfileState.regions,
      regionsLoadedAt: autoProfileState.regionsLoadedAt,
    };
    if (autoResult.changed) {
      setProfile(state, autoResult.profile);
      options.profile = autoResult.profile;
      systemNotifications.push(
        systemEventNotification(
          notificationPublisher,
          {
            key: `profile-${autoResult.profile}`,
            title: "Auto Profile",
            label: "Profile selected",
            message: `Profile automatically set to ${profileLabel(autoResult.profile)}.`,
            category: "profile",
            facts: [autoProfileState.nearestRegionName || ""].filter(Boolean),
          },
          now,
        ),
      );
      debug("traffic.auto-profile.change", {
        sessionId: state.sessionId,
        profile: state.profile,
        region: autoProfileState.nearestRegionName,
      });
      persistOptions();
    }
    const previousMuted = audioPolicy.muted;
    const audioAction = evaluateAudioPolicy(audioPolicy, state.profile, state.own.sog, {
      ownStw: state.own.stw,
      profileSettings: state.profileSettings,
    });
    if (audioAction || previousMuted !== audioPolicy.muted) {
      audioPolicy.correlationId = randomUUID();
      audioPolicy.updatedAt = now;
      notificationPublisher.muteState = audioPolicy.muted;
      if (audioAction) {
        systemNotifications.push(
          systemEventNotification(
            notificationPublisher,
            {
              key: audioAction.muted ? "auto-mute" : "auto-unmute",
              title: "Sound",
              label: audioAction.muted ? "Auto mute" : "Auto unmute",
              message: audioAction.muted
                ? "Sound automatically muted because vessel is stationary."
                : "Sound automatically enabled because vessel is moving.",
              category: "audio",
              facts: [profileLabel(state.profile)],
            },
            now,
          ),
        );
      }
      debug("traffic.audio-policy.change", {
        sessionId: state.sessionId,
        profile: state.profile,
        muted: audioPolicy.muted,
        automatic: audioPolicy.automuteState.automaticMuteActive,
      });
    }
    return systemNotifications;
  }

  function maybeAllWellNotification(now = new Date().toISOString()) {
    const nowMs = Date.parse(now) || Date.now();
    if (audioPolicy.allWellEnabled !== true) {
      lastAllWellAtMs = nowMs;
      return null;
    }
    if (audioPolicy.muted) {
      lastAllWellAtMs = nowMs;
      return null;
    }
    if (projection?.source?.ownVesselPositionFresh !== true) {
      lastAllWellAtMs = nowMs;
      return null;
    }
    if (hasActiveTrafficAlert(projection)) {
      lastAllWellAtMs = nowMs;
      return null;
    }
    const intervalMs = audioPolicy.allWellIntervalMinutes * 60 * 1000;
    if (nowMs - lastAllWellAtMs < intervalMs) return null;
    lastAllWellAtMs = nowMs;
    return systemEventNotification(
      notificationPublisher,
      {
        key: "all-well",
        title: "AJRM Marine",
        label: "All's well",
        message: audioPolicy.allWellMessage,
        category: "audio",
        facts: [profileLabel(state.profile)],
      },
      now,
    );
  }

  function currentProfiles() {
    return {
      contract: "ajrm-marine-traffic-profiles",
      contractVersion: 1,
      sessionId: state.sessionId,
      current: state.profile,
      anchor: { ...state.profileSettings.anchor },
      harbor: { ...state.profileSettings.harbor },
      coastal: { ...state.profileSettings.coastal },
      offshore: { ...state.profileSettings.offshore },
    };
  }

  async function startHarbourSubsystem(generation) {
    const loadPromise = loadHarbourRegions();
    let timedOut = false;
    try {
      await withTimeout(loadPromise, options.startupHarbourTimeoutMs);
    } catch (error) {
      timedOut = error?.code === "STARTUP_TIMEOUT";
      const message = timedOut
        ? `Timed out after ${Math.round(options.startupHarbourTimeoutMs / 1000)} seconds waiting for harbour regions.`
        : error.message;
      autoProfileState.lastError = message;
      debug("traffic.auto-profile.startup-error", {
        sessionId: state.sessionId,
        error: message,
      });
      if (typeof app.setPluginError === "function") {
        app.setPluginError(`Auto Profile startup degraded: ${message}`);
      } else {
        app.setPluginStatus(`${statusText()}; Auto Profile startup degraded: ${message}`);
      }
    }
    if (generation !== startupGeneration) return;
    startupReady = true;
    startHarbourRefreshTimer();
    publish();
    flushStartupQueue();
    app.setPluginStatus(
      autoProfileState.lastError
        ? `${statusText()}; Auto Profile startup degraded: ${autoProfileState.lastError}`
        : statusText(),
    );
    debug("traffic.start", {
      sessionId: state.sessionId,
      sequence: projection.sequence,
      profile: options.profile,
      autoProfileRegions: autoProfileState.regions.length,
      autoProfileError: autoProfileState.lastError,
    });

    if (timedOut) {
      loadPromise
        .then(() => {
          if (generation === startupGeneration) {
            app.setPluginStatus(statusText());
            recalculate();
          }
        })
        .catch(() => {});
    }
  }

  function flushStartupQueue() {
    const queued = startupQueue;
    startupQueue = [];
    for (const delta of queued) processDelta(delta);
  }

  async function loadHarbourRegions() {
    try {
      const regions = await loadHarbourRegionResources({
        resourcesApi: app.resourcesApi,
        harbourPrefix: options.autoProfile.harbourRegionNamePrefix,
      });
      autoProfileState.regions = regions;
      autoProfileState.regionsLoadedAt = new Date().toISOString();
      autoProfileState.lastError = null;
      return regions;
    } catch (error) {
      autoProfileState.lastError = error.message;
      debug("traffic.auto-profile.regions-error", {
        sessionId: state.sessionId,
        error: error.message,
      });
      throw error;
    }
  }

  async function refreshHarbourRegions() {
    try {
      await loadHarbourRegions();
      recalculate();
    } catch (error) {
      publish();
    }
  }

  function withTimeout(promise, timeoutMs) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error("Startup timed out");
        error.code = "STARTUP_TIMEOUT";
        reject(error);
      }, timeoutMs);
      timer.unref?.();
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  function startHarbourRefreshTimer() {
    if (harbourRefreshTimer) clearInterval(harbourRefreshTimer);
    harbourRefreshTimer = setInterval(
      refreshHarbourRegions,
      options.autoProfile.refreshRegionsSeconds * 1000,
    );
    harbourRefreshTimer.unref?.();
  }

  function currentAutoProfileProjection() {
    lastAutoProfileProjection = buildAutoProfileProjection(autoProfileSequence);
    return lastAutoProfileProjection;
  }

  function buildAutoProfileProjection(sequence) {
    return autoProfileProjection({
      sessionId: state.sessionId,
      sequence,
      profile: state.profile,
      options: options.autoProfile,
      state: autoProfileState,
    });
  }

  function currentAudioPolicyProjection(increment = false) {
    if (increment || !lastAudioPolicyProjection) audioPolicySequence += 1;
    lastAudioPolicyProjection = audioPolicyProjection({
      sessionId: state.sessionId,
      sequence: audioPolicySequence,
      correlationId: audioPolicy.correlationId,
      mode: "traffic",
      authoritative: true,
      profile: state.profile,
      ownSog: state.own.sog,
      ownStw: state.own.stw,
      policy: audioPolicy,
      profileSettings: state.profileSettings,
    });
    return lastAudioPolicyProjection;
  }

  function currentVoyageStateProjection(increment = false) {
    if (increment || !lastVoyageStateProjection) voyageStateSequence += 1;
    lastVoyageStateProjection = voyageStateProjection({
      sessionId: state.sessionId,
      sequence: voyageStateSequence,
      profile: state.profile,
      own: state.own,
      thresholdMps: audioPolicy.automuteStationarySpeed,
    });
    return lastVoyageStateProjection;
  }
};

function profileLabel(profile) {
  if (profile === "anchor") return "Anchor";
  if (profile === "harbor" || profile === "harbour") return "Harbour";
  if (profile === "coastal") return "Coastal";
  if (profile === "offshore") return "Offshore";
  return String(profile || "Unknown");
}

function autoProfilePublicationSignature(projection) {
  return JSON.stringify({
    enabled: projection.enabled,
    profile: projection.profile,
    settings: projection.settings,
    regionCount: projection.regionCount,
    insideRegionId: projection.insideRegionId,
    insideRegionName: projection.insideRegionName,
    nearestRegionId: projection.nearestRegionId,
    nearestRegionName: projection.nearestRegionName,
    anchorHeld: projection.anchorHeld,
    lastProfileSet: projection.lastProfileSet,
    lastProfileChangeTs: projection.lastProfileChangeTs,
    lastError: projection.lastError,
  });
}

function hasActiveTrafficAlert(projection) {
  return (projection?.targets || []).some((target) =>
    ["warn", "alarm", "emergency"].includes(
      String(target?.encounter?.state || "").toLowerCase(),
    ),
  );
}

function normalizeOptions(value) {
  const profile = ["anchor", "harbor", "coastal", "offshore"].includes(
    value.profile,
  )
    ? value.profile
    : "harbor";
  const delay = Number(value.calculationDelayMs);
  const ownPositionMaxAgeSeconds = Number(value.ownPositionMaxAgeSeconds);
  const startupHarbourTimeoutMs = Number(value.startupHarbourTimeoutMs);
  return {
    profile,
    calculationDelayMs: Number.isFinite(delay)
      ? Math.min(5000, Math.max(0, Math.round(delay)))
      : 100,
    ownPositionMaxAgeSeconds: Number.isFinite(ownPositionMaxAgeSeconds)
      ? Math.min(300, Math.max(5, Math.round(ownPositionMaxAgeSeconds)))
      : 30,
    startupHarbourTimeoutMs: Number.isFinite(startupHarbourTimeoutMs)
      ? Math.min(60000, Math.max(10, Math.round(startupHarbourTimeoutMs)))
      : STARTUP_HARBOUR_TIMEOUT_MS,
    autoProfile: normalizeAutoProfileOptions(value.autoProfile),
    profiles: normalizeProfileSettings(value.profiles, profile),
    muted: value.muted === true,
    automuteStationary: value.automuteStationary !== false,
    automuteStationarySpeed:
      Number.isFinite(Number(value.automuteStationarySpeed)) &&
      Number(value.automuteStationarySpeed) >= 0
        ? Number(value.automuteStationarySpeed)
        : DEFAULT_AUTOMUTE_STATIONARY_SPEED,
    allWellEnabled: value.allWellEnabled !== false,
    allWellMessage:
      String(value.allWellMessage || "").trim() || DEFAULT_ALL_WELL_MESSAGE,
    allWellIntervalMinutes:
      Number.isFinite(Number(value.allWellIntervalMinutes)) &&
      Number(value.allWellIntervalMinutes) >= 1
        ? Math.min(240, Math.round(Number(value.allWellIntervalMinutes)))
        : DEFAULT_ALL_WELL_INTERVAL_MINUTES,
  };
}

function shouldMaterializeDefaultOptions(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

module.exports.ALLOWED_OUTPUT_PREFIX = ALLOWED_OUTPUT_PREFIX;
module.exports.CAPABILITIES_PATH = CAPABILITIES_PATH;
module.exports.TARGETS_PATH = TARGETS_PATH;
module.exports.AUTO_PROFILE_PATH = AUTO_PROFILE_PATH;
module.exports.AUDIO_POLICY_PATH = AUDIO_POLICY_PATH;
module.exports.PROFILES_PATH = PROFILES_PATH;
module.exports._private = {
  autoProfilePublicationSignature,
  shouldMaterializeDefaultOptions,
};
