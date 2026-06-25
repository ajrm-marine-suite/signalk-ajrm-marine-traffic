'use strict';

const DEFAULT_STATIONARY_AUTOMUTE_STABLE_SAMPLES = 3;

function stationaryAutomuteProfileAllowed(profile) {
	return profile === "anchor" || profile === "harbor" || profile === "harbour";
}

function stationaryAutomuteStationaryState({
	selfTarget,
	speedOverGround,
	threshold,
}) {
	const sog = finiteNumber(speedOverGround) ?? finiteNumber(selfTarget?.sog);
	if (sog == null) {
		return null;
	}
	return sog <= threshold;
}

function clearedStationaryAutomuteState() {
	return {
		automaticMuteActive: false,
		lastStationary: null,
		manualOverride: false,
		pendingCount: 0,
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
	settings = {},
	state = {},
	stableSamples = DEFAULT_STATIONARY_AUTOMUTE_STABLE_SAMPLES,
	speedOverGround,
	threshold,
} = {}) {
	if (settings.automuteStationary !== true) {
		return {
			action: null,
			state: clearedStationaryAutomuteState(),
		};
	}

	const automuteAllowed = stationaryAutomuteProfileAllowed(currentProfile);
	if (!automuteAllowed) {
		const shouldClearAutomaticMute =
			state.automaticMuteActive === true && settings.muted === true;
		return {
			action: shouldClearAutomaticMute ? { muted: false } : null,
			state: {
				...clearedStationaryAutomuteState(),
				manualOverride: state.manualOverride === true,
			},
		};
	}

	const stationary = stationaryAutomuteStationaryState({
		selfTarget,
		speedOverGround,
		threshold,
	});
	if (stationary == null) {
		return {
			action: null,
			state: {
				...state,
				lastStationary: state.lastStationary ?? null,
				pendingCount: 0,
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
				pendingStationary: null,
			},
		};
	}

	// Releasing an automatic mute is safety-critical: as soon as a valid speed
	// sample shows the vessel moving, allow announcements in the same refresh.
	// Keep the debounce when becoming stationary so brief speed dropouts do not
	// repeatedly mute and unmute the system.
	const releaseAutomaticMute =
		stationary === false && state.automaticMuteActive === true;
	if (
		!force &&
		!releaseAutomaticMute &&
		state.lastStationary != null &&
		stateChanged
	) {
		const pendingCount =
			state.pendingStationary === stationary ? (state.pendingCount || 0) + 1 : 1;
		if (pendingCount < Math.max(1, stableSamples)) {
			return {
				action: null,
				state: {
					...state,
					pendingCount,
					pendingStationary: stationary,
				},
			};
		}
	}

	if (force || stateChanged) {
		const desiredMuted = stationary;
		const inheritedAutomaticMute =
			desiredMuted === true &&
			settings.muted === true &&
			state.lastStationary == null &&
			state.manualOverride !== true;
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
			pendingStationary: null,
		},
	};
}

function automaticMuteAction({ desiredMuted, settings = {}, state = {} }) {
	if (settings.muted === desiredMuted) return null;
	if (desiredMuted === false && state.automaticMuteActive !== true) return null;
	return { muted: desiredMuted };
}

function finiteNumber(value) {
	if (value == null || value === "") {
		return null;
	}
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
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
			return "Muted manually. Automute only applies in Harbour or Anchor profiles.";
		}
		return settings.muted
			? "Muted. Automute only applies in Harbour or Anchor profiles."
			: "Sound enabled. Automute only applies in Harbour or Anchor profiles.";
	}

	if (stationary == null) {
		return settings.muted
			? "Muted manually. Automute is waiting for vessel speed."
			: "Sound enabled manually. Automute is waiting for vessel speed.";
	}

	if (state.manualOverride === true) {
		return settings.muted ? "Muted manually." : "Sound enabled manually.";
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
};
