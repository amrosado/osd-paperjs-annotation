# OSDLayer - GeoJS Integration with OpenSeadragon

This implementation provides a GeoJS layer class that integrates OpenSeadragon viewers with GeoJS mapping capabilities, modeled after the GeoJS `osmLayer` but designed specifically for high-resolution image viewing.

## Overview

The `OSDLayer` class extends GeoJS's `featureLayer` to provide seamless integration between OpenSeadragon's high-resolution image display capabilities and GeoJS's mapping and annotation features.

## Key Features

- **OpenSeadragon Integration**: Direct integration with OpenSeadragon viewers for high-resolution image display
- **Coordinate Transformation**: Automatic conversion between geographic coordinates and OpenSeadragon viewport coordinates
- **Event Handling**: Comprehensive event handling for viewer interactions and tile management
- **Feature Support**: Full support for GeoJS features (points, lines, polygons, etc.) overlaid on images
- **Multi-Image Support**: Support for multiple tiled images within a single layer
- **Performance Optimized**: Efficient tile loading and rendering with proper cleanup

## Usage

### Basic Setup

```javascript
import OSDLayer from './osdLayer.js';

// Create OpenSeadragon viewer
const viewer = new OpenSeadragon.Viewer({
    id: 'viewer-container',
    prefixUrl: '/openseadragon/images/',
    // ... other OSD options
});

// Create GeoJS map
const map = geo.map({
    node: '#map-container',
    gcs: 'EPSG:4326'
});

// Create and add OSD layer
const osdLayer = new OSDLayer({
    viewer: viewer,
    attribution: 'My High-Resolution Image',
    opacity: 1.0
});

map.addLayer(osdLayer);
```

### Adding Images

```javascript
// Add a tiled image to the OpenSeadragon viewer
osdLayer.addTiledImage({
    tileSource: {
        type: 'image',
        url: '/path/to/image.jpg'
    }
}).then(tiledImage => {
    console.log('Image added successfully');
});
```

### Coordinate Transformation

```javascript
// Convert between coordinate systems
const gcsCoord = { x: 100, y: 200 };
const viewportCoord = osdLayer.gcsToViewport(gcsCoord);
const displayCoord = osdLayer.gcsToDisplay(gcsCoord);

// Convert back
const originalGcs = osdLayer.viewportToGcs(viewportCoord);
const originalFromDisplay = osdLayer.displayToGcs(displayCoord);
```

### Adding Annotations

```javascript
// Create a feature layer for annotations
const annotationLayer = map.createLayer('feature');

// Add point features
const pointFeature = annotationLayer.createFeature('point');
pointFeature.data([
    { x: 0.5, y: 0.5, label: 'Center Point' }
]);

// Add polygon features
const polygonFeature = annotationLayer.createFeature('polygon');
polygonFeature.data([{
    outer: [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.8, y: 0.8 },
        { x: 0.2, y: 0.8 }
    ]
}]);

annotationLayer.draw();
```

## API Reference

### Constructor Options

- `viewer` (required): OpenSeadragon.Viewer instance
- `attribution`: Attribution text for the layer
- `keepLower`: Whether to keep lower resolution tiles (default: true)
- `opacity`: Layer opacity 0-1 (default: 1.0)
- `visible`: Initial visibility (default: true)
- `gcs`: Geographic coordinate system (default: 'EPSG:4326')

### Methods

#### Image Management
- `addTiledImage(options)`: Add a tiled image to the viewer
- `removeTiledImage(tiledImage)`: Remove a tiled image
- `getTiledImages()`: Get all tiled images

#### Coordinate Transformation
- `gcsToViewport(gcsCoord)`: Convert geographic to viewport coordinates
- `viewportToGcs(viewportCoord)`: Convert viewport to geographic coordinates
- `gcsToDisplay(gcsCoord)`: Convert geographic to display coordinates
- `displayToGcs(displayCoord)`: Convert display to geographic coordinates

#### Navigation
- `panTo(gcsCoord, immediately)`: Pan to geographic coordinate
- `fitBounds(bounds, immediately)`: Fit view to geographic bounds
- `getGeographicBounds()`: Get current view bounds in geographic coordinates

#### Layer Properties
- `setOpacity(opacity)`: Set layer opacity
- `getOpacity()`: Get layer opacity
- `setVisibility(visible)`: Set layer visibility
- `getVisibility()`: Get layer visibility
- `getViewer()`: Get OpenSeadragon viewer instance

### Events

The layer emits standard GeoJS events:
- `geo.event.layerAdd`: When an image is added
- `geo.event.layerRemove`: When an image is removed
- `geo.event.layerUpdate`: When the layer is updated
- `geo.event.layerError`: When an error occurs

## Integration with Paper.js Annotations

The OSDLayer works seamlessly with the existing Paper.js annotation system:

```javascript
// After setting up OSDLayer
const annotationToolkit = new AnnotationToolkit(viewer);

// The annotations will automatically work with the coordinate transformations
// provided by the OSDLayer
```

## Example Implementation

See `osdLayerExample.js` for a complete example including:
- Setting up the viewer and layer
- Adding various types of annotations
- Handling events
- Navigation controls

## Architecture

The `OSDLayer` class:

1. **Extends `geo.featureLayer`**: Inherits all GeoJS layer capabilities
2. **Wraps OpenSeadragon.Viewer**: Provides controlled access to OSD functionality
3. **Manages Coordinate Systems**: Handles transformations between GeoJS and OSD coordinate spaces
4. **Event Coordination**: Synchronizes events between GeoJS and OpenSeadragon
5. **Resource Management**: Properly manages tiles, images, and memory

## Comparison with osmLayer

| Feature | osmLayer | OSDLayer |
|---------|----------|----------|
| Data Source | OSM tile servers | High-resolution images via OpenSeadragon |
| Coordinate System | Web Mercator | Configurable (default EPSG:4326) |
| Zoom Levels | Discrete tile levels | Continuous zoom with OpenSeadragon |
| Image Quality | Tile-based | High-resolution, seamless |
| Annotation Support | Standard GeoJS | Enhanced with Paper.js integration |
| Use Case | Web mapping | Scientific imaging, artwork, documents |

## Dependencies

- GeoJS (geo.js)
- OpenSeadragon
- Paper.js (for annotations, optional)

## License

This implementation follows the same license as the parent project.