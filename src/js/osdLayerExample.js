/**
 * Example usage of OSDLayer with GeoJS and OpenSeadragon
 * 
 * This example demonstrates how to integrate OpenSeadragon with GeoJS
 * using the custom OSDLayer class.
 */

import OSDLayer from './osdLayer.js';

/**
 * Initialize OpenSeadragon viewer with GeoJS OSD layer
 * @param {string|HTMLElement} container - Container element for the viewer
 * @param {Object} options - Configuration options
 * @returns {Object} Object containing viewer, map, and layer instances
 */
function initializeOSDWithGeoJS(container, options = {}) {
    // Default options
    const defaults = {
        // OpenSeadragon options
        viewer: {
            id: container,
            prefixUrl: '/openseadragon/images/',
            showNavigationControl: true,
            showZoomControl: true,
            showHomeControl: true,
            showFullPageControl: true,
            showRotationControl: false,
            mouseNavEnabled: true,
            animationTime: 1.2,
            blendTime: 0.0,
            constrainDuringPan: false,
            maxZoomPixelRatio: 2,
            minZoomLevel: 0.1,
            visibilityRatio: 1,
            zoomPerScroll: 1.2,
            defaultZoomLevel: 0,
            degrees: 0
        },
        
        // GeoJS map options
        map: {
            zoom: 1,
            center: { x: 0.5, y: 0.5 },
            discreteZoom: false,
            allowRotation: false
        },
        
        // OSD layer options
        layer: {
            attribution: 'OpenSeadragon Image with GeoJS',
            opacity: 1.0,
            visible: true,
            gcs: 'EPSG:4326'
        },
        
        // Tile sources for OpenSeadragon
        tileSources: []
    };
    
    const config = Object.assign({}, defaults, options);
    
    // Create OpenSeadragon viewer
    const viewer = new OpenSeadragon.Viewer(config.viewer);
    
    // Create GeoJS map in the same container
    const map = geo.map(Object.assign({
        node: container,
        gcs: config.layer.gcs
    }, config.map));
    
    // Create OSD layer and add to map
    const osdLayer = new OSDLayer(Object.assign({
        viewer: viewer
    }, config.layer));
    
    map.addLayer(osdLayer);
    
    // Add tile sources if provided
    if (config.tileSources && config.tileSources.length > 0) {
        config.tileSources.forEach(tileSource => {
            osdLayer.addTiledImage({ tileSource });
        });
    }
    
    return {
        viewer,
        map,
        layer: osdLayer
    };
}

/**
 * Add annotation features to the OSD layer
 * @param {OSDLayer} layer - The OSD layer instance
 * @param {Array} annotations - Array of annotation objects
 */
function addAnnotations(layer, annotations) {
    // Create a feature layer for annotations if it doesn't exist
    let annotationLayer = layer.map().layers().find(l => l.name === 'annotations');
    
    if (!annotationLayer) {
        annotationLayer = layer.map().createLayer('feature', {
            name: 'annotations'
        });
    }
    
    annotations.forEach(annotation => {
        switch (annotation.type) {
            case 'point':
                addPointAnnotation(annotationLayer, annotation);
                break;
            case 'polygon':
                addPolygonAnnotation(annotationLayer, annotation);
                break;
            case 'line':
                addLineAnnotation(annotationLayer, annotation);
                break;
            default:
                console.warn(`Unknown annotation type: ${annotation.type}`);
        }
    });
    
    annotationLayer.draw();
}

/**
 * Add a point annotation
 * @param {geo.featureLayer} layer - Feature layer
 * @param {Object} annotation - Point annotation data
 */
function addPointAnnotation(layer, annotation) {
    const pointFeature = layer.createFeature('point');
    
    pointFeature.data([{
        x: annotation.coordinates[0],
        y: annotation.coordinates[1],
        label: annotation.label || ''
    }]);
    
    pointFeature.style({
        radius: annotation.radius || 5,
        fillColor: annotation.fillColor || 'red',
        fillOpacity: annotation.fillOpacity || 0.8,
        strokeColor: annotation.strokeColor || 'black',
        strokeWidth: annotation.strokeWidth || 1
    });
}

/**
 * Add a polygon annotation
 * @param {geo.featureLayer} layer - Feature layer
 * @param {Object} annotation - Polygon annotation data
 */
function addPolygonAnnotation(layer, annotation) {
    const polygonFeature = layer.createFeature('polygon');
    
    polygonFeature.data([{
        outer: annotation.coordinates[0].map(coord => ({
            x: coord[0],
            y: coord[1]
        })),
        label: annotation.label || ''
    }]);
    
    polygonFeature.style({
        fillColor: annotation.fillColor || 'blue',
        fillOpacity: annotation.fillOpacity || 0.3,
        strokeColor: annotation.strokeColor || 'blue',
        strokeWidth: annotation.strokeWidth || 2
    });
}

/**
 * Add a line annotation
 * @param {geo.featureLayer} layer - Feature layer
 * @param {Object} annotation - Line annotation data
 */
function addLineAnnotation(layer, annotation) {
    const lineFeature = layer.createFeature('line');
    
    lineFeature.data([annotation.coordinates.map(coord => ({
        x: coord[0],
        y: coord[1]
    }))]);
    
    lineFeature.style({
        strokeColor: annotation.strokeColor || 'green',
        strokeWidth: annotation.strokeWidth || 2,
        strokeOpacity: annotation.strokeOpacity || 1
    });
}

/**
 * Example usage
 */
function example() {
    // Initialize the viewer
    const { viewer, map, layer } = initializeOSDWithGeoJS('map-container', {
        tileSources: [
            {
                type: 'image',
                url: '/path/to/your/image.jpg'
            }
        ]
    });
    
    // Add some example annotations
    const annotations = [
        {
            type: 'point',
            coordinates: [0.3, 0.3],
            label: 'Point 1',
            fillColor: 'red',
            radius: 8
        },
        {
            type: 'polygon',
            coordinates: [[[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4], [0.2, 0.2]]],
            label: 'Rectangle',
            fillColor: 'blue',
            fillOpacity: 0.3
        },
        {
            type: 'line',
            coordinates: [[0.1, 0.1], [0.5, 0.5], [0.9, 0.1]],
            strokeColor: 'green',
            strokeWidth: 3
        }
    ];
    
    addAnnotations(layer, annotations);
    
    // Set up event handlers
    viewer.addHandler('open', () => {
        console.log('Image opened in OpenSeadragon');
        
        // Fit the map to the image bounds
        const bounds = layer.getGeographicBounds();
        map.bounds(bounds);
    });
    
    layer.geoOn(geo.event.layerUpdate, () => {
        console.log('OSD layer updated');
    });
    
    // Pan to a specific location
    setTimeout(() => {
        layer.panTo({ x: 0.5, y: 0.5 });
    }, 2000);
    
    return { viewer, map, layer };
}

// Export for module usage
export {
    initializeOSDWithGeoJS,
    addAnnotations,
    addPointAnnotation,
    addPolygonAnnotation,
    addLineAnnotation,
    example
};

// Global exports
if (typeof window !== 'undefined') {
    window.OSDLayerExample = {
        initializeOSDWithGeoJS,
        addAnnotations,
        addPointAnnotation,
        addPolygonAnnotation,
        addLineAnnotation,
        example
    };
}