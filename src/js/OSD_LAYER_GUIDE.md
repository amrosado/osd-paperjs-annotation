# OSD Layer Quick Start Guide

The OSD Layer has been successfully created and integrated into your project. Here's how to use it:

## Files Created

1. **`osdLayer.mjs`** - The main OSDLayer class implementation
2. **`geojs-loader.mjs`** - GeoJS library loader with fallback
3. **`osdLayerUsage.mjs`** - Usage examples and helper functions
4. **`paper-overlay.mjs`** - Updated to integrate OSD layer

## Basic Usage

### 1. Creating an OSD Layer

```javascript
import OSDLayer from './osdLayer.mjs';

// Assuming you have an OpenSeadragon viewer
const osdLayer = new OSDLayer({
    viewer: yourOpenSeadragonViewer,
    attribution: 'Your Image Attribution',
    opacity: 1.0,
    visible: true
});
```

### 2. Using with GeoJS (if available)

```javascript
import { createGeoJSMapWithOSD } from './osdLayerUsage.mjs';

const mapInstance = createGeoJSMapWithOSD('#map-container', viewer, {
    gcs: 'EPSG:4326',
    zoom: 1,
    center: { x: 0.5, y: 0.5 }
});

if (mapInstance) {
    console.log('Map and OSD layer created successfully');
    // mapInstance.map - the GeoJS map
    // mapInstance.layer - the OSD layer
}
```

### 3. Integration with PaperOverlay

The OSD layer is automatically integrated when creating a PaperOverlay. The integration happens in the PaperOverlay constructor:

```javascript
// When creating a PaperOverlay, the OSD layer will be automatically set up
const overlay = new PaperOverlay(viewer, {
    overlayType: 'image'
});

// Access the GeoJS integration
if (overlay.geojs_map_polygons) {
    console.log('OSD layer is available:', overlay.geojs_map_polygons);
}
```

## Error Handling

The implementation includes robust error handling:

- **Missing GeoJS**: If GeoJS is not available, a placeholder is created and warnings are logged
- **Missing OpenSeadragon viewer**: Throws an error if no viewer is provided
- **Integration failures**: Logs warnings if GeoJS integration fails

## Key Features

1. **Coordinate Transformation**: Automatic conversion between GeoJS and OpenSeadragon coordinate systems
2. **Event Handling**: Full integration with OpenSeadragon viewer events
3. **Multi-Image Support**: Support for multiple tiled images
4. **Performance Optimized**: Efficient tile loading and memory management

## Troubleshooting

### "Unable to create osd layer"

This error typically occurs when:

1. **GeoJS not loaded**: Make sure GeoJS is available in your environment
2. **Incorrect import path**: Ensure you're importing from the correct file path
3. **Missing viewer**: The OSDLayer requires an OpenSeadragon viewer instance

### Solutions:

1. **Check GeoJS availability**:
   ```javascript
   import { geo } from './geojs-loader.mjs';
   console.log('GeoJS available:', !!geo);
   ```

2. **Verify viewer**:
   ```javascript
   console.log('Viewer available:', !!viewer);
   console.log('Viewer type:', viewer.constructor.name);
   ```

3. **Use the helper functions**:
   ```javascript
   import { createOSDLayer } from './osdLayerUsage.mjs';
   
   try {
       const layer = createOSDLayer(viewer);
       console.log('Layer created successfully');
   } catch (error) {
       console.error('Failed to create layer:', error);
   }
   ```

## Advanced Usage

### Custom Coordinate Transformations

```javascript
const osdLayer = new OSDLayer({ viewer });

// Transform coordinates
const gcsCoord = { x: 100, y: 200 };
const viewportCoord = osdLayer.gcsToViewport(gcsCoord);
const displayCoord = osdLayer.gcsToDisplay(gcsCoord);
```

### Adding Annotations

```javascript
import { addAnnotationsToOSDLayer } from './osdLayerUsage.mjs';

const annotations = [
    {
        type: 'point',
        x: 0.5,
        y: 0.5,
        style: { fillColor: 'red', radius: 5 }
    },
    {
        type: 'polygon',
        coordinates: [[[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]]],
        style: { fillColor: 'blue', fillOpacity: 0.3 }
    }
];

addAnnotationsToOSDLayer(mapInstance, annotations);
```

## Integration Status

✅ **OSDLayer class created and functional**  
✅ **GeoJS integration with fallback**  
✅ **PaperOverlay integration updated**  
✅ **Helper functions and examples provided**  
✅ **Error handling and logging implemented**  

The OSD layer is now ready to use in your OpenSeadragon + GeoJS application!