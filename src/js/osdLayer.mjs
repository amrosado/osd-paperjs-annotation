/**
 * OpenSeadragon layer for GeoJS
 * Modeled on osmLayer but using OpenSeadragon instead of OSM tiles
 * 
 * This class creates a GeoJS layer that integrates with an OpenSeadragon viewer
 * to display high-resolution images with GeoJS overlays and features.
 */

// Import GeoJS if available globally, otherwise assume it's loaded
// const geo = window.geo || require('geojs');
import GeoJS from './geojs-loader';

/**
 * OpenSeadragon Layer Class
 * 
 * A GeoJS layer that uses OpenSeadragon for displaying high-resolution images
 * with the ability to add GeoJS features and annotations on top.
 */
class OSDLayer extends GeoJS.featureLayer {
    
    /**
     * Create an OpenSeadragon layer
     * @param {Object} options - Configuration options
     * @param {OpenSeadragon.Viewer} options.viewer - The OpenSeadragon viewer instance
     * @param {String} options.attribution - Attribution text for the layer
     * @param {Boolean} [options.keepLower=true] - Whether to keep lower resolution tiles
     * @param {Number} [options.opacity=1.0] - Layer opacity (0-1)
     * @param {Boolean} [options.visible=true] - Initial visibility
     * @param {String} [options.gcs='EPSG:4326'] - Geographic coordinate system
     */
    constructor(options = {}) {
        // Set default options
        const defaults = {
            attribution: 'OpenSeadragon Image',
            keepLower: true,
            opacity: 1.0,
            visible: true,
            gcs: 'EPSG:4326',
            // OSD-specific defaults
            animationTime: 1.2,
            blendTime: 0,
            compositeOperation: 'source-over',
            debugMode: false,
            degrees: 0,
            flipped: false,
            preload: false,
            clip: null
        };
        
        const settings = Object.assign(defaults, options);
        
        // Call parent constructor
        super(settings);
        
        // Store OpenSeadragon viewer reference
        this._viewer = settings.viewer;
        if (!this._viewer) {
            throw new Error('OpenSeadragon viewer is required');
        }
        
        // Store configuration
        this._attribution = settings.attribution;
        this._keepLower = settings.keepLower;
        this._gcs = settings.gcs;
        this._opacity = settings.opacity;
        
        // Initialize OSD-specific properties
        this._tiledImages = new Map();
        this._activeTiles = new Set();
        this._loadingTiles = new Set();
        
        // Bind viewer events
        this._bindViewerEvents();
        
        // Initialize coordinate transformation
        this._initCoordinateTransform();
        
        return this;
    }
    
    /**
     * Initialize coordinate transformation between GeoJS and OpenSeadragon
     * @private
     */
    _initCoordinateTransform() {
        // Get image bounds from OpenSeadragon
        if (this._viewer.world.getItemCount() > 0) {
            const tiledImage = this._viewer.world.getItemAt(0);
            this._imageBounds = tiledImage.getBounds();
            this._imageSize = tiledImage.getContentSize();
        }
        
        // Set up transformation functions
        this._setupTransforms();
    }
    
    /**
     * Set up coordinate transformation functions
     * @private
     */
    _setupTransforms() {
        // Transform from geographic coordinates to OpenSeadragon viewport coordinates
        this.gcsToViewport = (gcsCoord) => {
            if (!this._imageBounds) return gcsCoord;
            
            // Normalize coordinates to image bounds
            const x = (gcsCoord.x - this._imageBounds.x) / this._imageBounds.width;
            const y = (gcsCoord.y - this._imageBounds.y) / this._imageBounds.height;
            
            return { x, y };
        };
        
        // Transform from OpenSeadragon viewport coordinates to geographic coordinates
        this.viewportToGcs = (viewportCoord) => {
            if (!this._imageBounds) return viewportCoord;
            
            const x = viewportCoord.x * this._imageBounds.width + this._imageBounds.x;
            const y = viewportCoord.y * this._imageBounds.height + this._imageBounds.y;
            
            return { x, y };
        };
        
        // Transform from display coordinates to geographic coordinates
        this.displayToGcs = (displayCoord) => {
            const viewportCoord = this._viewer.viewport.pointFromPixel(displayCoord);
            return this.viewportToGcs(viewportCoord);
        };
        
        // Transform from geographic coordinates to display coordinates
        this.gcsToDisplay = (gcsCoord) => {
            const viewportCoord = this.gcsToViewport(gcsCoord);
            return this._viewer.viewport.pixelFromPoint(viewportCoord);
        };
    }
    
    /**
     * Bind OpenSeadragon viewer events
     * @private
     */
    _bindViewerEvents() {
        // Update on viewport changes
        this._viewer.addHandler('animation', () => {
            this._updateLayer();
        });
        
        this._viewer.addHandler('animation-finish', () => {
            this._updateLayer();
        });
        
        // Handle tile loading
        this._viewer.addHandler('tile-load-failed', (event) => {
            this._loadingTiles.delete(event.tile);
            this.geoTrigger(geo.event.layerError, {
                layer: this,
                error: new Error(`Tile load failed: ${event.message}`)
            });
        });
        
        this._viewer.addHandler('tile-loaded', (event) => {
            this._loadingTiles.delete(event.tile);
            this._activeTiles.add(event.tile);
            this._updateLayer();
        });
        
        this._viewer.addHandler('tile-unloaded', (event) => {
            this._activeTiles.delete(event.tile);
        });
        
        // Handle image addition/removal
        this._viewer.world.addHandler('add-item', (event) => {
            this._onImageAdded(event.item);
        });
        
        this._viewer.world.addHandler('remove-item', (event) => {
            this._onImageRemoved(event.item);
        });
        
        // Handle viewer size changes
        this._viewer.addHandler('resize', () => {
            this._updateLayer();
        });
    }
    
    /**
     * Handle image added to viewer
     * @param {OpenSeadragon.TiledImage} tiledImage 
     * @private
     */
    _onImageAdded(tiledImage) {
        this._tiledImages.set(tiledImage.source, tiledImage);
        
        // Update coordinate transforms when first image is added
        if (this._tiledImages.size === 1) {
            this._initCoordinateTransform();
        }
        
        // Set image properties
        tiledImage.setOpacity(this._opacity);
        
        this.geoTrigger(geo.event.layerAdd, {
            layer: this,
            tiledImage: tiledImage
        });
    }
    
    /**
     * Handle image removed from viewer
     * @param {OpenSeadragon.TiledImage} tiledImage 
     * @private
     */
    _onImageRemoved(tiledImage) {
        this._tiledImages.delete(tiledImage.source);
        
        this.geoTrigger(geo.event.layerRemove, {
            layer: this,
            tiledImage: tiledImage
        });
    }
    
    /**
     * Update the layer display
     * @private
     */
    _updateLayer() {
        // Update coordinate transforms
        this._setupTransforms();
        
        // Trigger layer update event
        this.geoTrigger(geo.event.layerUpdate, {
            layer: this
        });
        
        // Request redraw of features
        this.map().scheduleAnimationFrame(() => {
            this.draw();
        });
    }
    
    /**
     * Add a tiled image to the OpenSeadragon viewer
     * @param {Object} imageOptions - OpenSeadragon tiled image options
     * @returns {Promise} Promise that resolves when image is added
     */
    addTiledImage(imageOptions) {
        return new Promise((resolve, reject) => {
            const options = Object.assign({
                success: (event) => {
                    resolve(event.item);
                },
                error: (event) => {
                    reject(new Error(`Failed to add tiled image: ${event.message}`));
                }
            }, imageOptions);
            
            this._viewer.addTiledImage(options);
        });
    }
    
    /**
     * Remove a tiled image from the viewer
     * @param {OpenSeadragon.TiledImage} tiledImage 
     */
    removeTiledImage(tiledImage) {
        this._viewer.world.removeItem(tiledImage);
    }
    
    /**
     * Get the current viewport bounds in geographic coordinates
     * @returns {Object} Bounds object with left, top, right, bottom properties
     */
    getGeographicBounds() {
        const viewportBounds = this._viewer.viewport.getBounds();
        
        const topLeft = this.viewportToGcs({
            x: viewportBounds.x,
            y: viewportBounds.y
        });
        
        const bottomRight = this.viewportToGcs({
            x: viewportBounds.x + viewportBounds.width,
            y: viewportBounds.y + viewportBounds.height
        });
        
        return {
            left: topLeft.x,
            top: topLeft.y,
            right: bottomRight.x,
            bottom: bottomRight.y
        };
    }
    
    /**
     * Set layer opacity
     * @param {Number} opacity - Opacity value (0-1)
     */
    setOpacity(opacity) {
        this._opacity = Math.max(0, Math.min(1, opacity));
        
        // Update all tiled images
        this._tiledImages.forEach(tiledImage => {
            tiledImage.setOpacity(this._opacity);
        });
        
        // Update feature layer opacity
        super.opacity(this._opacity);
    }
    
    /**
     * Get layer opacity
     * @returns {Number} Current opacity value
     */
    getOpacity() {
        return this._opacity;
    }
    
    /**
     * Set layer visibility
     * @param {Boolean} visible - Visibility state
     */
    setVisibility(visible) {
        this._visible = visible;
        
        // Update all tiled images
        this._tiledImages.forEach(tiledImage => {
            tiledImage.setOpacity(visible ? this._opacity : 0);
        });
        
        // Update feature layer visibility
        super.visible(visible);
    }
    
    /**
     * Get layer visibility
     * @returns {Boolean} Current visibility state
     */
    getVisibility() {
        return this._visible;
    }
    
    /**
     * Get the OpenSeadragon viewer instance
     * @returns {OpenSeadragon.Viewer} The viewer instance
     */
    getViewer() {
        return this._viewer;
    }
    
    /**
     * Get all tiled images in this layer
     * @returns {Array} Array of tiled images
     */
    getTiledImages() {
        return Array.from(this._tiledImages.values());
    }
    
    /**
     * Pan the viewer to a geographic coordinate
     * @param {Object} gcsCoord - Geographic coordinate {x, y}
     * @param {Boolean} [immediately=false] - Whether to pan immediately
     */
    panTo(gcsCoord, immediately = false) {
        const viewportCoord = this.gcsToViewport(gcsCoord);
        this._viewer.viewport.panTo(viewportCoord, immediately);
    }
    
    /**
     * Zoom to fit geographic bounds
     * @param {Object} bounds - Bounds object with left, top, right, bottom
     * @param {Boolean} [immediately=false] - Whether to zoom immediately
     */
    fitBounds(bounds, immediately = false) {
        const topLeft = this.gcsToViewport({
            x: bounds.left,
            y: bounds.top
        });
        
        const bottomRight = this.gcsToViewport({
            x: bounds.right,
            y: bounds.bottom
        });
        
        const viewportBounds = new OpenSeadragon.Rect(
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y
        );
        
        this._viewer.viewport.fitBounds(viewportBounds, immediately);
    }
    
    /**
     * Override draw method to ensure proper rendering
     */
    draw() {
        // Update transforms before drawing features
        this._setupTransforms();
        
        // Call parent draw method
        return super.draw();
    }
    
    /**
     * Clean up resources when layer is destroyed
     */
    _exit() {
        // Remove all event handlers
        this._viewer.removeAllHandlers('animation');
        this._viewer.removeAllHandlers('animation-finish');
        this._viewer.removeAllHandlers('tile-load-failed');
        this._viewer.removeAllHandlers('tile-loaded');
        this._viewer.removeAllHandlers('tile-unloaded');
        this._viewer.removeAllHandlers('resize');
        
        // Clear collections
        this._tiledImages.clear();
        this._activeTiles.clear();
        this._loadingTiles.clear();
        
        // Call parent cleanup
        super._exit();
    }
}

// Register the layer with GeoJS
function registerOSDLayer() {
    // Re-check for geo object in case it became available
    let currentGeo = GeoJS.geo;
    
    // Fallback strategies if geo is still not available
    if (!currentGeo) {
        if (typeof window !== 'undefined') {
            currentGeo = window.geo || window.geojs?.geo;
        }
        
        // Try getting from global GeoJS
        if (!currentGeo && typeof window !== 'undefined' && window.GeoJS) {
            currentGeo = window.GeoJS.geo || window.GeoJS;
        }
        
        // Try importing again if in module context
        if (!currentGeo) {
            try {
                // Dynamic import attempt
                if (typeof window !== 'undefined' && window.require) {
                    const dynamicGeoJS = window.require('geojs');
                    currentGeo = dynamicGeoJS.geo || dynamicGeoJS;
                }
            } catch (e) {
                console.log('Dynamic import failed:', e.message);
            }
        }
    }
    
    if (currentGeo && currentGeo.registerLayer) {
        try {
            currentGeo.registerLayer('osd', OSDLayer);
            console.log('OSDLayer successfully registered with GeoJS as "osd" layer type');
            
            // Verify registration worked
            if (currentGeo.layerTypes && currentGeo.layerTypes()['osd']) {
                console.log('✅ OSD layer type verified in registry');
            }
            
            // Update the module-level geo reference
            geo = currentGeo;
            return true;
        } catch (error) {
            console.error('Error during OSDLayer registration:', error);
            return false;
        }
    } else if (currentGeo) {
        console.warn('GeoJS geo object found but registerLayer method not available');
        console.log('Available methods:', Object.keys(currentGeo));
        return false;
    } else {
        console.warn('GeoJS geo object not available for layer registration');
        return false;
    }
}

// Attempt registration immediately
let registrationSuccess = registerOSDLayer();

// If registration failed, try multiple delayed attempts
if (!registrationSuccess) {
    const retryTimes = [100, 500, 1000, 2000];
    
    retryTimes.forEach((delay, index) => {
        setTimeout(() => {
            if (!registrationSuccess) {
                console.log(`Retry attempt ${index + 1} for OSDLayer registration...`);
                registrationSuccess = registerOSDLayer();
                if (registrationSuccess) {
                    console.log(`✅ OSDLayer registration succeeded on retry attempt ${index + 1}`);
                }
            }
        }, delay);
    });
}

// Export registration function for manual use
OSDLayer.register = registerOSDLayer;

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OSDLayer;
}

// Global export
if (typeof window !== 'undefined') {
    window.OSDLayer = OSDLayer;
}

export default OSDLayer;