"use strict";

const STATUS_PATH = "/plugins/signalk-ajrm-marine-traffic/status";
const COMMAND_PATH = "/plugins/signalk-ajrm-marine-traffic/commands";
const PROFILE_NAMES = ["anchor", "harbor", "coastal", "offshore"];
const VESSEL_SIZES = ["small", "medium", "large"];
const DEFAULT_PROFILES = {
  current: "harbor",
  anchor: profileDefaults(
    { cpa: 0, tcpa: 3600, speed: 0 },
    { cpa: 0, tcpa: 3600, speed: 0 },
  ),
  harbor: profileDefaults(
    {
      small: { cpa: 50, tcpa: 180, speed: 0.5 },
      medium: { cpa: 100, tcpa: 240, speed: 0.5 },
      large: { cpa: 200, tcpa: 360, speed: 0.5 },
    },
    {
      small: { cpa: 25, tcpa: 60, speed: 3 },
      medium: { cpa: 50, tcpa: 120, speed: 3 },
      large: { cpa: 100, tcpa: 180, speed: 3 },
    },
  ),
  coastal: profileDefaults(
    {
      small: { cpa: 741, tcpa: 600, speed: 0 },
      medium: { cpa: 1482, tcpa: 900, speed: 0 },
      large: { cpa: 2778, tcpa: 1200, speed: 0 },
    },
    {
      small: { cpa: 278, tcpa: 300, speed: 0.5 },
      medium: { cpa: 741, tcpa: 480, speed: 0.5 },
      large: { cpa: 1482, tcpa: 720, speed: 0.5 },
    },
  ),
  offshore: profileDefaults(
    {
      small: { cpa: 926, tcpa: 720, speed: 0 },
      medium: { cpa: 2315, tcpa: 1200, speed: 0 },
      large: { cpa: 5556, tcpa: 1800, speed: 0 },
    },
    {
      small: { cpa: 370, tcpa: 360, speed: 0 },
      medium: { cpa: 1111, tcpa: 600, speed: 0 },
      large: { cpa: 2778, tcpa: 900, speed: 0 },
    },
  ),
};
const els = {
  status: document.getElementById("status"),
  refresh: document.getElementById("refresh"),
  health: document.getElementById("health"),
  profile: document.getElementById("profile"),
  unsilenceAll: document.getElementById("unsilenceAll"),
  commandStatus: document.getElementById("commandStatus"),
  autoProfileEnabled: document.getElementById("autoProfileEnabled"),
  outsideProfile: document.getElementById("outsideProfile"),
  refreshRegions: document.getElementById("refreshRegions"),
  autoProfileStatus: document.getElementById("autoProfileStatus"),
  autoProfileMetrics: document.getElementById("autoProfileMetrics"),
  editProfile: document.getElementById("editProfile"),
  editSize: document.getElementById("editSize"),
  resetSensitivity: document.getElementById("resetSensitivity"),
  resetProfileDefaults: document.getElementById("resetProfileDefaults"),
  saveProfiles: document.getElementById("saveProfiles"),
  cpaSensitivity: document.getElementById("cpaSensitivity"),
  cpaSensitivityValue: document.getElementById("cpaSensitivityValue"),
  tcpaLookahead: document.getElementById("tcpaLookahead"),
  tcpaLookaheadValue: document.getElementById("tcpaLookaheadValue"),
  repeatSensitivity: document.getElementById("repeatSensitivity"),
  repeatSensitivityValue: document.getElementById("repeatSensitivityValue"),
  warningCpa: document.getElementById("warningCpa"),
  warningCpaValue: document.getElementById("warningCpaValue"),
  warningTcpa: document.getElementById("warningTcpa"),
  warningTcpaValue: document.getElementById("warningTcpaValue"),
  warningSpeed: document.getElementById("warningSpeed"),
  warningSpeedValue: document.getElementById("warningSpeedValue"),
  dangerCpa: document.getElementById("dangerCpa"),
  dangerCpaValue: document.getElementById("dangerCpaValue"),
  dangerTcpa: document.getElementById("dangerTcpa"),
  dangerTcpaValue: document.getElementById("dangerTcpaValue"),
  dangerSpeed: document.getElementById("dangerSpeed"),
  dangerSpeedValue: document.getElementById("dangerSpeedValue"),
  profileStatus: document.getElementById("profileStatus"),
  mute: document.getElementById("mute"),
  automuteStationary: document.getElementById("automuteStationary"),
  automuteSpeed: document.getElementById("automuteSpeed"),
  allWellEnabled: document.getElementById("allWellEnabled"),
  allWellMessage: document.getElementById("allWellMessage"),
  allWellInterval: document.getElementById("allWellInterval"),
  audioPolicyStatus: document.getElementById("audioPolicyStatus"),
  targetCount: document.getElementById("targetCount"),
  targets: document.getElementById("targets"),
};
let snapshot = null;
let profileDraft = null;
let profilesDirty = false;
let editingProfile = null;

async function jsonRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
  return body;
}

async function refresh() {
  els.refresh.disabled = true;
  try {
    snapshot = await jsonRequest(STATUS_PATH);
    render();
    els.status.textContent = "Traffic Core status received.";
    els.status.className = "status ok";
  } catch (error) {
    els.status.textContent = `Traffic Core unavailable: ${error.message}`;
    els.status.className = "status warning";
  } finally {
    els.refresh.disabled = false;
  }
}

function render() {
  const capabilities = snapshot?.capabilities || {};
  const targets = snapshot?.targets || {};
  const source = targets.source || {};
  const rows = Array.isArray(targets.targets) ? targets.targets : [];
  const autoProfile = snapshot?.autoProfile || {};
  const audioPolicy = snapshot?.audioPolicy || {};
  const silenced = rows.filter((target) => target?.encounter?.silenced).length;
  els.health.innerHTML = [
    metric("Version", snapshot?.version || capabilities.version),
    metric("Mode", capabilities.mode || "unknown"),
    metric("Profile", targets.profile || capabilities.profile || "unknown"),
    metric("Session", shortId(capabilities.sessionId)),
    metric("Sequence", targets.sequence ?? "—"),
    metric("Own position", source.ownVesselPositionFresh ? "Fresh" : "Stale"),
    metric("Replay", source.ajrmMarineLoggerPlayback ? "Active" : "Off"),
  ].join("");
  const enabled = capabilities.commandsEnabled === true;
  els.profile.disabled = !enabled;
  els.unsilenceAll.disabled = !enabled || silenced === 0;
  els.profile.value = targets.profile || capabilities.profile || "coastal";
  els.autoProfileEnabled.disabled = !enabled;
  els.outsideProfile.disabled = !enabled;
  els.refreshRegions.disabled = !enabled;
  els.autoProfileEnabled.checked = autoProfile.enabled === true;
  els.outsideProfile.value = autoProfile.settings?.outsideProfile || "coastal";
  els.autoProfileStatus.textContent = autoProfile.status || "Auto Profile state unavailable.";
  els.autoProfileMetrics.innerHTML = [
    metric("Harbour regions", autoProfile.regionCount ?? 0),
    metric("Nearest", autoProfile.nearestRegionName || "—"),
    metric("Distance", metres(autoProfile.distanceMeters)),
    metric("Anchor held", autoProfile.anchorHeld ? "Yes" : "No"),
  ].join("");
  renderProfileEditor(enabled);
  els.mute.disabled = !enabled;
  els.automuteStationary.disabled = !enabled;
  els.automuteSpeed.disabled = !enabled;
  els.allWellEnabled.disabled = !enabled;
  els.allWellMessage.disabled = !enabled;
  els.allWellInterval.disabled = !enabled;
  els.mute.textContent = audioPolicy.muted ? "Enable audio" : "Mute audio";
  els.automuteStationary.checked = audioPolicy.automuteStationary === true;
  setEditableInputValue(els.automuteSpeed, audioPolicy.automuteStationarySpeed ?? 0.35);
  els.allWellEnabled.checked = audioPolicy.allWellEnabled === true;
  setEditableInputValue(els.allWellMessage, audioPolicy.allWellMessage || "All's well.");
  setEditableInputValue(els.allWellInterval, audioPolicy.allWellIntervalMinutes ?? 30);
  els.audioPolicyStatus.textContent = audioPolicy.status || "Audio Policy state unavailable.";
  els.targetCount.textContent = rows.length;
  els.targets.innerHTML = rows.length
    ? rows.map(targetRow).join("")
    : '<tr><td colspan="7" class="muted">No targets.</td></tr>';
}

function renderProfileEditor(enabled) {
  const selectedProfile = PROFILE_NAMES.includes(editingProfile)
    ? editingProfile
    : PROFILE_NAMES.includes(els.editProfile.value)
      ? els.editProfile.value
      : null;
  if (!profilesDirty || !profileDraft) {
    profileDraft = normalizeProfiles(snapshot?.profiles || snapshot?.commands?.profiles || {});
    editingProfile = selectedProfile || profileDraft.current || targetsProfile();
  }
  const profileName = PROFILE_NAMES.includes(editingProfile)
    ? editingProfile
    : profileDraft.current;
  els.editProfile.value = profileName;
  const size = VESSEL_SIZES.includes(els.editSize.value) ? els.editSize.value : "small";
  const profile = profileDraft[profileName];
  for (const control of profileControls()) control.disabled = !enabled;
  els.editProfile.disabled = !enabled;
  els.editSize.disabled = !enabled;
  els.resetSensitivity.disabled = !enabled;
  els.resetProfileDefaults.disabled = !enabled;
  els.saveProfiles.disabled = !enabled || !profilesDirty;
  els.cpaSensitivity.value = percent(profile.cpaSensitivity);
  els.tcpaLookahead.value = percent(profile.tcpaLookahead);
  els.repeatSensitivity.value = percent(profile.repeatSensitivity);
  els.cpaSensitivityValue.textContent = `${els.cpaSensitivity.value}%`;
  els.tcpaLookaheadValue.textContent = `${els.tcpaLookahead.value}%`;
  els.repeatSensitivityValue.textContent = `${els.repeatSensitivity.value}%`;
  for (const kind of ["warning", "danger"]) {
    for (const field of ["cpa", "tcpa", "speed"]) {
      const input = els[`${kind}${capitalize(field)}`];
      const value = profile[kind].bySize[size][field];
      input.value = value;
      els[`${kind}${capitalize(field)}Value`].textContent =
        field === "cpa" ? distanceText(value) : field === "tcpa" ? timeText(value) : speedText(value);
    }
  }
  els.profileStatus.textContent = profilesDirty
    ? "Profile changes are not saved yet."
    : "Profile settings loaded from Traffic Core.";
}

function targetRow(target) {
  const encounter = target?.encounter || {};
  return `<tr>
    <td>${escapeHtml(target?.name || target?.mmsi || target?.id || "Unknown")}</td>
    <td><span class="pill ${escapeHtml(encounter.state || "normal")}">${escapeHtml(encounter.state || "normal")}</span></td>
    <td>${metres(encounter.range)}</td><td>${metres(encounter.cpa)}</td>
    <td>${seconds(encounter.tcpa)}</td>
    <td class="${target?.freshness?.stale ? "stale" : ""}">${target?.freshness?.stale ? "Stale" : age(target?.freshness?.ageMs)}</td>
    <td><button type="button" data-target="${escapeHtml(target?.mmsi || target?.id || "")}" data-silenced="${encounter.silenced === true}">${encounter.silenced ? "Unsilence" : "Silence"}</button></td>
  </tr>`;
}

async function runCommand(action) {
  els.commandStatus.textContent = "Applying…";
  try {
    els.commandStatus.textContent = await action();
    await refresh();
  } catch (error) {
    els.commandStatus.textContent = error.message;
  }
}

els.profile.addEventListener("change", () => runCommand(async () => {
  await jsonRequest(`${COMMAND_PATH}/profile`, {
    method: "PUT",
    body: JSON.stringify({ profile: els.profile.value }),
  });
  return `Profile set to ${els.profile.value}.`;
}));
els.unsilenceAll.addEventListener("click", () => runCommand(async () => {
  const result = await jsonRequest(`${COMMAND_PATH}/unsilence-all`, { method: "POST" });
  return `${result.unsilenced} target(s) unsilenced.`;
}));
els.autoProfileEnabled.addEventListener("change", () => runCommand(async () => {
  await jsonRequest(`${COMMAND_PATH}/auto-profile`, {
    method: "PUT",
    body: JSON.stringify({ enabled: els.autoProfileEnabled.checked }),
  });
  return els.autoProfileEnabled.checked ? "Auto Profile enabled." : "Auto Profile disabled.";
}));
els.outsideProfile.addEventListener("change", () => runCommand(async () => {
  await jsonRequest(`${COMMAND_PATH}/auto-profile`, {
    method: "PUT",
    body: JSON.stringify({ outsideProfile: els.outsideProfile.value }),
  });
  return `Outside profile set to ${els.outsideProfile.value}.`;
}));
els.refreshRegions.addEventListener("click", () => runCommand(async () => {
  await jsonRequest(`${COMMAND_PATH}/auto-profile`, {
    method: "PUT",
    body: JSON.stringify({ refresh: true }),
  });
  return "Harbour region refresh requested.";
}));
els.editProfile.addEventListener("change", () => {
  if (!profileDraft) profileDraft = normalizeProfiles(snapshot?.profiles || {});
  editingProfile = els.editProfile.value;
  renderProfileEditor(snapshot?.capabilities?.commandsEnabled === true);
});
els.editSize.addEventListener("change", () =>
  renderProfileEditor(snapshot?.capabilities?.commandsEnabled === true),
);
for (const control of ["cpaSensitivity", "tcpaLookahead", "repeatSensitivity"]) {
  els[control].addEventListener("input", () => {
    const profile = editableProfile();
    if (!profile) return;
    profile.cpaSensitivity = Number(els.cpaSensitivity.value) / 100;
    profile.tcpaLookahead = Number(els.tcpaLookahead.value) / 100;
    profile.repeatSensitivity = Number(els.repeatSensitivity.value) / 100;
    markProfilesDirty();
  });
}
for (const input of criteriaControls()) {
  input.addEventListener("input", () => {
    const profile = editableProfile();
    if (!profile) return;
    const criteria = profile[input.dataset.kind].bySize[els.editSize.value];
    criteria[input.dataset.field] = Number(input.value);
    markProfilesDirty();
  });
}
els.resetSensitivity.addEventListener("click", () => {
  const profile = editableProfile();
  if (!profile) return;
  profile.cpaSensitivity = 1;
  profile.tcpaLookahead = 1;
  profile.repeatSensitivity = 1;
  markProfilesDirty();
});
els.resetProfileDefaults.addEventListener("click", () => {
  if (!profileDraft) return;
  const profileName = editableProfileName();
  profileDraft[profileName] = clone(DEFAULT_PROFILES[profileName]);
  markProfilesDirty();
});
els.saveProfiles.addEventListener("click", () => runCommand(async () => {
  if (!profileDraft) return "No profile settings to save.";
  const savedProfile = editableProfileName();
  profileDraft.current = PROFILE_NAMES.includes(profileDraft.current)
    ? profileDraft.current
    : targetsProfile();
  const result = await jsonRequest(`${COMMAND_PATH}/profiles`, {
    method: "PUT",
    body: JSON.stringify(profileDraft),
  });
  profileDraft = normalizeProfiles(result.profiles);
  profilesDirty = false;
  editingProfile = savedProfile;
  return `Saved ${labelForProfile(savedProfile)} profile limits.`;
}));
els.mute.addEventListener("click", () => runCommand(async () => {
  const muted = snapshot?.audioPolicy?.muted !== true;
  await jsonRequest(`${COMMAND_PATH}/audio`, {
    method: "PUT",
    body: JSON.stringify({ muted }),
  });
  return muted ? "Traffic Core audio muted." : "Traffic Core audio enabled.";
}));
els.automuteStationary.addEventListener("change", () => saveAudioPolicy());
els.automuteSpeed.addEventListener("change", () => saveAudioPolicy());
els.allWellEnabled.addEventListener("change", () => saveAudioPolicy());
els.allWellMessage.addEventListener("change", () => saveAudioPolicy());
els.allWellInterval.addEventListener("change", () => saveAudioPolicy());
for (const input of [els.automuteSpeed, els.allWellMessage, els.allWellInterval]) {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
  });
}
els.targets.addEventListener("click", (event) => {
  const button = event.target.closest("[data-target]");
  if (!button) return;
  runCommand(async () => {
    const silenced = button.dataset.silenced !== "true";
    await jsonRequest(
      `${COMMAND_PATH}/targets/${encodeURIComponent(button.dataset.target)}/silence`,
      { method: "POST", body: JSON.stringify({ silenced }) },
    );
    return silenced ? "Target silenced." : "Target unsilenced.";
  });
});
els.refresh.addEventListener("click", refresh);

function saveAudioPolicy() {
  return runCommand(async () => {
    await jsonRequest(`${COMMAND_PATH}/audio`, {
      method: "PUT",
      body: JSON.stringify({
        automuteStationary: els.automuteStationary.checked,
        automuteStationarySpeed: Number(els.automuteSpeed.value),
        allWellEnabled: els.allWellEnabled.checked,
        allWellMessage: els.allWellMessage.value,
        allWellIntervalMinutes: Number(els.allWellInterval.value),
      }),
    });
    return "Audio Policy updated.";
  });
}

function metric(label, value) { return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? "—")}</strong></div>`; }
function setEditableInputValue(input, value) {
  if (document.activeElement === input) return;
  input.value = value;
}
function profileDefaults(warning, danger) {
  return {
    cpaSensitivity: 1,
    tcpaLookahead: 1,
    repeatSensitivity: 1,
    warning: criteriaDefaults(warning),
    danger: criteriaDefaults(danger),
  };
}
function criteriaDefaults(value) {
  const bySize = {};
  for (const size of VESSEL_SIZES) bySize[size] = { ...(value[size] || value) };
  return { ...bySize.medium, bySize };
}
function normalizeProfiles(value = {}) {
  const profiles = { current: PROFILE_NAMES.includes(value.current) ? value.current : targetsProfile() };
  for (const profile of PROFILE_NAMES) {
    const supplied = value[profile] || {};
    const defaults = DEFAULT_PROFILES[profile];
    profiles[profile] = {
      cpaSensitivity: nonNegative(supplied.cpaSensitivity, defaults.cpaSensitivity),
      tcpaLookahead: nonNegative(supplied.tcpaLookahead, defaults.tcpaLookahead),
      repeatSensitivity: nonNegative(supplied.repeatSensitivity, defaults.repeatSensitivity),
      warning: normalizeCriteria(supplied.warning, defaults.warning),
      danger: normalizeCriteria(supplied.danger, defaults.danger),
    };
  }
  return profiles;
}
function normalizeCriteria(value = {}, defaults = {}) {
  const base = {
    cpa: nonNegative(value.cpa, defaults.cpa || 0),
    tcpa: nonNegative(value.tcpa, defaults.tcpa || 0),
    speed: nonNegative(value.speed, defaults.speed || 0),
  };
  const bySize = {};
  for (const size of VESSEL_SIZES) {
    const supplied = value.bySize?.[size] || value[size] || {};
    const fallback = defaults.bySize?.[size] || defaults[size] || base;
    bySize[size] = {
      cpa: nonNegative(supplied.cpa, fallback.cpa),
      tcpa: nonNegative(supplied.tcpa, fallback.tcpa),
      speed: nonNegative(supplied.speed, fallback.speed),
    };
  }
  return { ...base, bySize };
}
function nonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
function editableProfile() {
  if (!profileDraft) profileDraft = normalizeProfiles(snapshot?.profiles || {});
  editingProfile = editableProfileName();
  return profileDraft[editingProfile];
}
function editableProfileName() {
  return PROFILE_NAMES.includes(els.editProfile.value)
    ? els.editProfile.value
    : PROFILE_NAMES.includes(editingProfile)
      ? editingProfile
      : profileDraft?.current || targetsProfile();
}
function markProfilesDirty() {
  profilesDirty = true;
  renderProfileEditor(snapshot?.capabilities?.commandsEnabled === true);
}
function profileControls() {
  return [
    els.cpaSensitivity,
    els.tcpaLookahead,
    els.repeatSensitivity,
    ...criteriaControls(),
  ];
}
function criteriaControls() {
  return [
    els.warningCpa,
    els.warningTcpa,
    els.warningSpeed,
    els.dangerCpa,
    els.dangerTcpa,
    els.dangerSpeed,
  ];
}
function targetsProfile() {
  return snapshot?.targets?.profile || snapshot?.capabilities?.profile || "coastal";
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function percent(value) {
  return Math.round(nonNegative(value, 1) * 100);
}
function capitalize(value) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
function distanceText(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "OFF";
  return number >= 1852 ? `${(number / 1852).toFixed(number >= 9250 ? 0 : 2)} NM` : `${Math.round(number)} m`;
}
function timeText(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "OFF";
  return number >= 90 ? `${Math.round(number / 60)} min` : `${Math.round(number)} s`;
}
function speedText(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "OFF";
  return `${number.toFixed(number < 1 ? 1 : 0)} kn`;
}
function labelForProfile(value) {
  return { anchor: "Anchored", harbor: "Harbour", coastal: "Coastal", offshore: "Offshore" }[value] || value;
}
function metres(value) { return Number.isFinite(Number(value)) ? `${Math.round(Number(value))} m` : "—"; }
function seconds(value) { const number=Number(value); if(!Number.isFinite(number))return "—"; return number>=90?`${Math.round(number/60)} min`:`${Math.round(number)} s`; }
function age(value) { return Number.isFinite(Number(value)) ? `${Math.round(Number(value)/1000)} s` : "—"; }
function shortId(value) { return String(value || "").slice(0,8) || "—"; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char])); }

refresh();
setInterval(refresh, 2000);
