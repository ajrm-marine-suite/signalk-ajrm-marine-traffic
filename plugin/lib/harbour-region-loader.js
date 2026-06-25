'use strict';

const {
	geometrySignedDistanceMeters,
	getRegionGeometry,
	isHarbourRegion,
	normalizeRegionCollection,
} = require("./harbour-regions.js");

async function loadHarbourRegionResources({ resourcesApi, harbourPrefix }) {
	if (!resourcesApi?.listResources) {
		throw new Error("Signal K resourcesApi.listResources is not available");
	}

	const resources = await resourcesApi.listResources("regions", {});
	return normalizeRegionCollection(resources)
		.filter((region) => isHarbourRegion(region, harbourPrefix))
		.map((region) => ({
			...region,
			geometry: getRegionGeometry(region),
		}))
		.filter((region) => region.geometry);
}

function nearestHarbourRegion({ lat, lon, harbourRegions }) {
	let nearest = null;
	for (const region of harbourRegions || []) {
		const distanceMeters = geometrySignedDistanceMeters(
			lat,
			lon,
			region.geometry,
		);
		if (
			Number.isFinite(distanceMeters) &&
			(!nearest || distanceMeters < nearest.distanceMeters)
		) {
			nearest = { ...region, distanceMeters };
		}
	}
	return nearest;
}

module.exports = {
	loadHarbourRegionResources,
	nearestHarbourRegion,
};
