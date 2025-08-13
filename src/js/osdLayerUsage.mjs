/**
 * Example usage of OSDLayer with OpenSeadragon and GeoJS
 * 
 * This file demonstrates how to properly create and use an OSD layer
 * in the context of the existing paper-overlay system.
 */

import OSDLayer from './osdLayer.mjs';
import { geo } from './geojs-loader.mjs';

// Ensure OSDLayer is registered when this module is loaded
if (geo && OSDLayer.register) {
    OSDLayer.register();
}

/**
 * Create an OSD layer for an existing OpenSeadragon viewer
 * @param {OpenSeadragon.Viewer} viewer - The OpenSeadragon viewer instance
 * @param {Object} options - Layer options
 * @returns {OSDLayer} The created OSD layer
 */
export function createOSDLayer(viewer, options = {}) {
    if (!viewer) {
        throw new Error('OpenSeadragon viewer is required');
    }

    // Create the OSD layer
    const osdLayer = new OSDLayer({
        viewer: viewer,
        attribution: options.attribution || 'OpenSeadragon Image',
        opacity: options.opacity || 1.0,
        visible: options.visible !== false,
        ...options
    });

    return osdLayer;
}

/**
 * Create a GeoJS map with OSD layer integration
 * @param {string|HTMLElement} container - Container for the map
 * @param {OpenSeadragon.Viewer} viewer - The OpenSeadragon viewer
 * @param {Object} options - Map and layer options
 * @returns {Object} Object containing map and layer instances
 */
export function createGeoJSMapWithOSD(container, viewer, options = {}) {
    // Check if GeoJS is available
    if (!geo || !geo.map) {
        console.warn('GeoJS not available for map creation');
        return null;
    }

    try {
        // Create GeoJS map
        const map = geo.map({
            node: container,
            gcs: options.gcs || 'EPSG:4326',
            zoom: options.zoom || 1,
            center: options.center || { x: 0.5, y: 0.5 },
            ...options.mapOptions
        });

        // Create OSD layer
        const osdLayer = createOSDLayer(viewer, options.layerOptions);
        
        // Add layer to map
        map.addLayer(osdLayer);

        return {
            map: map,
            layer: osdLayer
        };
    } catch (error) {
        console.error('Failed to create GeoJS map with OSD layer:', error);
        return null;
    }
}

/**
 * Add annotation features to an OSD layer
 * @param {Object} mapInstance - Object containing map and layer from createGeoJSMapWithOSD
 * @param {Array} annotations - Array of annotation objects
 */
export function addAnnotationsToOSDLayer(mapInstance, annotations) {
    if (!mapInstance || !mapInstance.map || !annotations) {
        console.warn('Invalid map instance or annotations');
        return;
    }

    try {
        // Create a feature layer for annotations
        const featureLayer = mapInstance.map.createLayer('feature', {
            features: ['point', 'line', 'polygon']
        });

        annotations.forEach(annotation => {
            switch (annotation.type) {
                case 'point':
                    addPointFeature(featureLayer, annotation);
                    break;
                case 'line':
                    addLineFeature(featureLayer, annotation);
                    break;
                case 'polygon':
                    addPolygonFeature(featureLayer, annotation);
                    break;
                default:
                    console.warn(`Unknown annotation type: ${annotation.type}`);
            }
        });

        featureLayer.draw();
        return featureLayer;
    } catch (error) {
        console.error('Failed to add annotations:', error);
        return null;
    }
}

/**
 * Add a point feature to a layer
 */
function addPointFeature(layer, annotation) {
    const pointFeature = layer.createFeature('point');
    pointFeature.data([{
        x: annotation.x,
        y: annotation.y,
        ...annotation.data
    }]);
    pointFeature.style(annotation.style || {});
}

/**
 * Add a line feature to a layer
 */
function addLineFeature(layer, annotation) {
    const lineFeature = layer.createFeature('line');
    lineFeature.data([annotation.coordinates.map(coord => ({
        x: coord[0],
        y: coord[1]
    }))]);
    lineFeature.style(annotation.style || {});
}

/**
 * Add a polygon feature to a layer
 */
function addPolygonFeature(layer, annotation) {
    const polygonFeature = layer.createFeature('polygon');
    polygonFeature.data([{
        outer: annotation.coordinates[0].map(coord => ({
            x: coord[0],
            y: coord[1]
        }))
    }]);
    polygonFeature.style(annotation.style || {});
}

/**
 * Example of how to use the OSD layer in a PaperOverlay context
 * @param {PaperOverlay} paperOverlay - The paper overlay instance
 */
export function integrateOSDLayerWithPaperOverlay(paperOverlay) {
    if (!paperOverlay || !paperOverlay.viewer) {
        console.warn('Invalid paper overlay');
        return null;
    }

    try {
        // Create OSD layer for the paper overlay's viewer
        const osdLayer = createOSDLayer(paperOverlay.viewer, {
            attribution: 'Paper Overlay with OSD Layer'
        });

        // Store reference on the paper overlay for easy access
        paperOverlay.osdLayer = osdLayer;

        console.log('OSD layer integrated with PaperOverlay');
        return osdLayer;
    } catch (error) {
        console.error('Failed to integrate OSD layer with PaperOverlay:', error);
        return null;
    }
}

// Export all functions
export default {
    createOSDLayer,
    createGeoJSMapWithOSD,
    addAnnotationsToOSDLayer,
    integrateOSDLayerWithPaperOverlay
};