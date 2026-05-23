/**
 * GeoJS library loader with fallback support
 *
 * This module provides a consistent way to import and access GeoJS
 * across the application, with proper error handling and fallbacks.
 */

import GeoJSDefault from 'geojs';
import * as GeoJSNamespace from 'geojs';

function valueFromCandidate(candidate, key) {
    if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) return undefined;
    return candidate[key];
}

function normalizeGeoJS(candidate) {
    if (!candidate) return null;

    const nestedGeo = valueFromCandidate(candidate, 'geo');
    if (nestedGeo) {
        return {
            geo: nestedGeo,
            util: candidate.util ?? nestedGeo.util,
            map: candidate.map ?? nestedGeo.map,
            event: candidate.event ?? nestedGeo.event,
            feature: candidate.feature ?? nestedGeo.feature,
            featureLayer: candidate.featureLayer ?? nestedGeo.featureLayer,
            createFileReader: candidate.createFileReader ?? nestedGeo.createFileReader,
        };
    }

    if (typeof candidate === 'object' || typeof candidate === 'function') {
        const defaultExport = valueFromCandidate(candidate, 'default');
        if (defaultExport && defaultExport !== candidate) {
            const normalizedDefault = normalizeGeoJS(defaultExport);
            if (normalizedDefault?.geo) return normalizedDefault;
        }

        if (candidate.registerLayer || candidate.map || candidate.util) {
            return {
                geo: candidate,
                util: candidate.util,
                map: candidate.map,
                event: candidate.event,
                feature: candidate.feature,
                featureLayer: candidate.featureLayer,
                createFileReader: candidate.createFileReader,
            };
        }
    }

    return null;
}

const candidates = [
    GeoJSDefault,
    GeoJSNamespace,
    GeoJSNamespace.default,
    globalThis.geo,
    globalThis.geojs,
    globalThis.geojs?.geo,
];

const normalized = candidates.map(normalizeGeoJS).find((item) => item?.geo);

let geo = normalized?.geo;
let util = normalized?.util;
let map = normalized?.map;
let event = normalized?.event;
let feature = normalized?.feature;
let featureLayer = normalized?.featureLayer;
let createFileReader = normalized?.createFileReader;

if (!geo) {
    console.warn('geojs-loader: Could not extract geo object from GeoJS import');
}

if (geo) {
    util = util ?? geo.util;
    map = map ?? geo.map;
    event = event ?? geo.event;
    feature = feature ?? geo.feature;
    featureLayer = featureLayer ?? geo.featureLayer;
    createFileReader = createFileReader ?? geo.createFileReader;
}

// Export the core geo object
export { geo };

// Export other commonly used GeoJS components
export {
    GeoJSDefault as default,
    util,
    map,
    event,
    feature,
    featureLayer,
    createFileReader,
};

// Validate that GeoJS loaded properly
if (!geo) {
    console.error('GeoJS failed to load - geo object is not available');
}
if (geo && (!map || !util)) {
    console.warn('GeoJS loaded, but map/util exports were not found.', {
        hasMap: Boolean(map),
        hasUtil: Boolean(util),
    });
}

// Global export for compatibility
if (typeof window !== 'undefined') {
    window.geoJSLoader = {
        geo,
        util,
        map,
        event,
        feature,
        featureLayer,
        createFileReader,
    };
    window.geo = geo;
}
