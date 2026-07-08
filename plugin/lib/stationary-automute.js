'use strict';

const DEFAULT_STATIONARY_AUTOMUTE_STABLE_SAMPLES = 3;

function stationaryAutomuteProfileAllowed(profile, profileSettings = {}) {
	const profileName = profile === "harbour" ? "harbor" : profile;
	const profilePolicy = profileSettings?.[profileName];
	if (typeof profilePolicy?.automuteStationary === "boolean") {
		return profilePolicy.automuteStationary;
	}
	return profile === "anchor" || profile === "harbor" || profile === "harbour";
}

function stationaryAutomuteStationaryState({
	selfTarget,
	speedOverGround,
	speedThroughWater,
	threshold,
}) {
	const sog = finiteNumber(speedOverGround) ?? finiteNumber(selfTarget?.sog);
	const stw = finiteNumber(speedThroughWater) ?? finiteNumber(selfTarget?.stw);
	const speed = maxFinite(sog, stw);
	if (speed == null) {
		return null;
	}
	return speed <= threshold;
}

function clearedStationaryAutomuteState() {
	return {
		automaticMuteActive: false,
		lastStationary: null,
		manualOverride: false,
		pendingCount: 0,
		pendingSinceMs: null,
		pendingStationary: null,
	};
}

function manualStationaryAutomuteOverrideState({
	state = {},
	stationary = null,
} = {}) {
	return {
		...state,
		automaticMuteActive: false,
		lastStationary: stationary,
		manualOverride: true,
	};
}

function stationaryAutomuteTransition({
	currentProfile,
	force = false,
	selfTarget,
	profileSettings,
	settings = {},
	state = {},
	stableSamples = DEFAULT_STATIONARY_AUTOMUTE_STABLE_SAMPLES,
	speedOverGround,
	speedThroughWater,
	threshold,
	nowMs = Date.now(),
} = {}) {
	if (settings.automuteStationary !== true) {
		return {
			action: null,
			state: clearedStationaryAutomuteState(),
		};
	}

	const automuteAllowed = stationaryAutomuteProfileAllowed(
		currentProfile,
		profileSettings,
	);
	if (!automuteAllowed) {
		const shouldClearAutomaticMute =
			settings.muted === true && state.manualOverride !== true;
		return {
			action: shouldClearAutomaticMute ? { muted: false } : null,
			state: {
				...clearedStationaryAutomuteState(),
				manualOverride: state.manualOverride === true,
				pendingSinceMs: null,
			},
		};
	}

	const stationary = stationaryAutomuteStationaryState({
		selfTarget,
		speedOverGround,
		speedThroughWater,
		threshold,
	});
	if (stationary == null) {
		return {
			action: null,
			state: {
				...state,
				lastStationary: state.lastStationary ?? null,
				pendingCount: 0,
				pendingSinceMs: null,
				pendingStationary: null,
			},
		};
	}

	const stateChanged = state.lastStationary == null || state.lastStationary !== stationary;
	if (state.manualOverride === true && !force && !stateChanged) {
		return {
			action: null,
			state: {
				...state,
				lastStationary: stationary,
				pendingCount: 0,
				pendingSinceMs: null,
				pendingStationary: null,
			},
		};
	}

	const inheritedAutomaticMute =
		stationary === true &&
		settings.muted === true &&
		state.lastStationary == null &&
		state.manualOverride !== true;
	const firstKnownStationary =
		stationary === true &&
		state.lastStationary == null &&
		state.manualOverride !== true;
	if (!force && stateChanged && !inheritedAutomaticMute && !firstKnownStationary) {
		const delayMs = transitionDelayMs({ stationary, settings });
		const pendingSinceMs =
			state.pendingStationary === stationary && Number.isFinite(state.pendingSinceMs)
				? state.pendingSinceMs
				: nowMs;
		const pendingCount =
			state.pendingStationary === stationary ? (state.pendingCount || 0) + 1 : 1;
		if (Math.max(0, nowMs - pendingSinceMs) < delayMs) {
			return {
				action: null,
				state: {
					...state,
					pendingCount,
					pendingSinceMs,
					pendingStationary: stationary,
				},
			};
		}
	}

	if (force || stateChanged) {
		const desiredMuted = stationary;
		const action = automaticMuteAction({
			desiredMuted,
			settings,
			state,
		});
		return {
			action,
			state: {
				automaticMuteActive: desiredMuted
					? action != null ||
						state.automaticMuteActive === true ||
						inheritedAutomaticMute
					: false,
				lastStationary: stationary,
				manualOverride: false,
				pendingCount: 0,
				pendingSinceMs: null,
				pendingStationary: null,
			},
		};
	}

	return {
		action: null,
		state: {
			...state,
			lastStationary: stationary,
			pendingCount: 0,
			pendingSinceMs: null,
			pendingStationary: null,
		},
	};
}

function transitionDelayMs({ stationary, settings = {} }) {
	const seconds = stationary
		? finiteNumber(settings.automuteStationaryDelaySeconds)
		: finiteNumber(settings.automuteMovingDelaySeconds);
	return Math.max(0, seconds ?? 0) * 1000;
}

function automaticMuteAction({ desiredMuted, settings = {}, state = {} }) {
	if (settings.muted === desiredMuted) return null;
	if (
		desiredMuted === false &&
		state.automaticMuteActive !== true &&
		state.manualOverride === true
	) {
		return null;
	}
	return { muted: desiredMuted };
}

function finiteNumber(value) {
	if (value == null || value === "") {
		return null;
	}
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function maxFinite(...values) {
	const numbers = values.filter((value) => Number.isFinite(value));
	if (!numbers.length) return null;
	return Math.max(...numbers);
}

function stationaryAutomuteStatusText({
	automuteAllowed = true,
	settings = {},
	state = {},
	stationary,
} = {}) {
	if (settings.automuteStationary !== true) {
		return settings.muted ? "Muted manually." : "Sound enabled.";
	}

	if (!automuteAllowed) {
		if (settings.muted && state.manualOverride === true) {
			return "Muted manually. Stationary automute is disabled for this profile.";
		}
		return settings.muted
			? "Muted. Stationary automute is disabled for this profile."
			: "Sound enabled. Stationary automute is disabled for this profile.";
	}

	if (stationary == null) {
		return settings.muted
			? "Muted manually. Automute is waiting for vessel speed."
			: "Sound enabled manually. Automute is waiting for vessel speed.";
	}

	if (state.manualOverride === true) {
		return settings.muted ? "Muted manually." : "Sound enabled manually.";
	}

	if (state.pendingStationary === true) {
		return "Sound enabled. Waiting before stationary automute.";
	}

	if (state.pendingStationary === false) {
		return settings.muted
			? "Muted. Waiting before motion unmute."
			: "Sound enabled. Confirming vessel movement.";
	}

	if (settings.muted && state.automaticMuteActive === true) {
		return "Muted because vessel is stationary.";
	}

	if (settings.muted) {
		return "Muted manually.";
	}

	if (stationary) {
		return "Sound enabled manually.";
	}

	return "Sound enabled because vessel is moving.";
}

module.exports = {
	clearedStationaryAutomuteState,
	DEFAULT_STATIONARY_AUTOMUTE_STABLE_SAMPLES,
	manualStationaryAutomuteOverrideState,
	stationaryAutomuteProfileAllowed,
	stationaryAutomuteStationaryState,
	stationaryAutomuteStatusText,
	stationaryAutomuteTransition,
	transitionDelayMs,
};
