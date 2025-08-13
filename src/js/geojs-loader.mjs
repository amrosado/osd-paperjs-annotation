/**
 * GeoJS library loader with fallback support
 * 
 * This module provides a consistent way to import and access GeoJS
 * across the application, with proper error handling and fallbacks.
 */

import GeoJS from 'geojs';

// Debug what we got from the import
console.log('geojs-loader: GeoJS import debug:', {
    GeoJS,
    hasDefault: 'default' in GeoJS,
    hasGeo: 'geo' in GeoJS,
    keys: Object.keys(GeoJS),
    type: typeof GeoJS
});

// Extract components with fallback strategies
let geo, util, map, event, feature, featureLayer, createFileReader;

// Try different extraction strategies
if (GeoJS.geo) {
    // Named exports available directly
    geo = GeoJS.geo;
    util = GeoJS.util;
    map = GeoJS.map;
    event = GeoJS.event;
    feature = GeoJS.feature;
    featureLayer = GeoJS.featureLayer;
    createFileReader = GeoJS.createFileReader;
    console.log('geojs-loader: Using direct properties from GeoJS');
} else if (GeoJS.default) {
    // Check default export
    geo = GeoJS.default.geo || GeoJS.default;
    util = GeoJS.default.util;
    map = GeoJS.default.map;
    event = GeoJS.default.event;
    feature = GeoJS.default.feature;
    featureLayer = GeoJS.default.featureLayer;
    createFileReader = GeoJS.default.createFileReader;
    console.log('geojs-loader: Using default export properties');
} else if (typeof GeoJS === 'object' && GeoJS.registerLayer) {
    // GeoJS itself is the geo object
    geo = GeoJS;
    console.log('geojs-loader: Using GeoJS as geo object directly');
} else {
    console.warn('geojs-loader: Could not extract geo object from GeoJS import');
}

// Export the core geo object
export { geo };

// Export other commonly used GeoJS components
export { 
    GeoJS as default,
    util,
    map,
    event,
    feature,
    featureLayer,
    createFileReader
};

// Validate that GeoJS loaded properly
if (!geo) {
    console.error('GeoJS failed to load - geo object is not available');
} else {
    console.log('GeoJS loaded successfully');
    
    // Log available layer types for debugging
    if (geo.layerTypes) {
        console.log('Available GeoJS layer types:', Object.keys(geo.layerTypes()));
    }
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
        createFileReader
    };
}

window.geo = geo;