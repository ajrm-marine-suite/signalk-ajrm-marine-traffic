'use strict';

function normalizeRegionCollection(value) {
	if (!value) {
		return [];
	}

	if (Array.isArray(value)) {
		return value.map((resource, index) => ({
			...resource,
			id: resource.id ?? resource.identifier ?? String(index),
		}));
	}

	return Object.entries(value).map(([id, resource]) => ({
		...(resource || {}),
		id: resource?.id ?? resource?.identifier ?? id,
	}));
}

function getRegionGeometry(region = {}) {
	const feature = region.feature;
	if (feature?.type === "Feature") {
		return feature.geometry;
	}
	if (feature?.type === "Polygon" || feature?.type === "MultiPolygon") {
		return feature;
	}
	if (
		region.geometry?.type === "Polygon" ||
		region.geometry?.type === "MultiPolygon"
	) {
		return region.geometry;
	}
	return null;
}

function normalizedText(value) {
	return String(value || "").trim().toLowerCase();
}

function isHarbourRegion(region = {}, prefix = "Harbour:") {
	const name = normalizedText(region.name);
	const normalizedPrefix = normalizedText(prefix);
	return Boolean(
		normalizedPrefix && name.startsWith(normalizedPrefix),
	);
}

function pointInRing(lon, lat, ring) {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const xi = Number(ring[i][0]);
		const yi = Number(ring[i][1]);
		const xj = Number(ring[j][0]);
		const yj = Number(ring[j][1]);
		const intersects =
			yi > lat !== yj > lat &&
			lon < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi;
		if (intersects) {
			inside = !inside;
		}
	}
	return inside;
}

function pointInPolygon(lon, lat, polygonCoordinates) {
	if (!Array.isArray(polygonCoordinates) || polygonCoordinates.length === 0) {
		return false;
	}
	if (!pointInRing(lon, lat, polygonCoordinates[0])) {
		return false;
	}
	for (const hole of polygonCoordinates.slice(1)) {
		if (pointInRing(lon, lat, hole)) {
			return false;
		}
	}
	return true;
}

function pointInGeometry(lat, lon, geometry) {
	if (geometry?.type === "Polygon") {
		return pointInPolygon(lon, lat, geometry.coordinates);
	}
	if (geometry?.type === "MultiPolygon") {
		return geometry.coordinates.some((polygon) =>
			pointInPolygon(lon, lat, polygon),
		);
	}
	return false;
}

function projectRegionPoint(point, referenceLat) {
	return {
		x:
			Number(point[0]) *
			111320 *
			Math.cos((Number(referenceLat) * Math.PI) / 180),
		y: Number(point[1]) * 110540,
	};
}

function pointSegmentDistanceMeters(point, start, end) {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	if (dx === 0 && dy === 0) {
		return Math.hypot(point.x - start.x, point.y - start.y);
	}
	const t = Math.max(
		0,
		Math.min(
			1,
			((point.x - start.x) * dx + (point.y - start.y) * dy) /
				(dx * dx + dy * dy),
		),
	);
	return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function ringBoundaryDistanceMeters(lat, lon, ring) {
	const point = projectRegionPoint([lon, lat], lat);
	let minDistance = Number.POSITIVE_INFINITY;
	for (let i = 0; i < ring.length; i++) {
		const start = projectRegionPoint(ring[i], lat);
		const end = projectRegionPoint(ring[(i + 1) % ring.length], lat);
		minDistance = Math.min(
			minDistance,
			pointSegmentDistanceMeters(point, start, end),
		);
	}
	return minDistance;
}

function polygonSignedDistanceMeters(lat, lon, polygonCoordinates) {
	const rings = polygonCoordinates.filter(
		(ring) => Array.isArray(ring) && ring.length >= 2,
	);
	if (rings.length === 0) {
		return Number.POSITIVE_INFINITY;
	}
	const boundaryDistance = Math.min(
		...rings.map((ring) => ringBoundaryDistanceMeters(lat, lon, ring)),
	);
	return pointInPolygon(lon, lat, polygonCoordinates)
		? -boundaryDistance
		: boundaryDistance;
}

function geometrySignedDistanceMeters(lat, lon, geometry) {
	if (geometry?.type === "Polygon") {
		return polygonSignedDistanceMeters(lat, lon, geometry.coordinates);
	}
	if (geometry?.type === "MultiPolygon") {
		return Math.min(
			...geometry.coordinates.map((polygon) =>
				polygonSignedDistanceMeters(lat, lon, polygon),
			),
		);
	}
	return Number.POSITIVE_INFINITY;
}

module.exports = {
	geometrySignedDistanceMeters,
	getRegionGeometry,
	isHarbourRegion,
	normalizedText,
	normalizeRegionCollection,
	pointInGeometry,
	pointInPolygon,
	pointInRing,
	pointSegmentDistanceMeters,
	polygonSignedDistanceMeters,
	projectRegionPoint,
	ringBoundaryDistanceMeters,
};
