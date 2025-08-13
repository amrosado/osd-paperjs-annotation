/**
 * Test script to verify OSDLayer registration with GeoJS
 * 
 * This script can be used to test whether the OSDLayer is properly
 * registered with GeoJS and can be created successfully.
 */

import { geo } from './geojs-loader.mjs';
import OSDLayer from './osdLayer.mjs';

/**
 * Test OSDLayer registration and creation
 */
export function testOSDLayerRegistration() {
    console.log('=== Testing OSDLayer Registration ===');
    
    // Check if geo object is available
    if (!geo) {
        console.error('❌ GeoJS geo object not available');
        return false;
    }
    console.log('✅ GeoJS geo object is available');
    
    // Check if registerLayer method exists
    if (!geo.registerLayer) {
        console.error('❌ geo.registerLayer method not available');
        return false;
    }
    console.log('✅ geo.registerLayer method is available');
    
    // Check if layerTypes method exists and includes 'osd'
    if (!geo.layerTypes) {
        console.error('❌ geo.layerTypes method not available');
        return false;
    }
    
    const layerTypes = geo.layerTypes();
    console.log('Available layer types:', Object.keys(layerTypes));
    
    if (!layerTypes['osd']) {
        console.error('❌ OSD layer type not registered');
        console.log('Attempting manual registration...');
        
        if (OSDLayer.register && OSDLayer.register()) {
            console.log('✅ Manual registration succeeded');
            const updatedLayerTypes = geo.layerTypes();
            if (updatedLayerTypes['osd']) {
                console.log('✅ OSD layer type now available');
            } else {
                console.error('❌ OSD layer type still not available after manual registration');
                return false;
            }
        } else {
            console.error('❌ Manual registration failed');
            return false;
        }
    } else {
        console.log('✅ OSD layer type is registered');
    }
    
    // Test creating an OSD layer (without viewer for basic test)
    try {
        console.log('Testing OSD layer creation...');
        
        // Create a mock viewer object for testing
        const mockViewer = {
            world: {
                getItemCount: () => 0,
                addHandler: () => {},
                removeHandler: () => {}
            },
            addHandler: () => {},
            removeHandler: () => {},
            removeAllHandlers: () => {},
            viewport: {
                pointFromPixel: () => ({x: 0, y: 0}),
                pixelFromPoint: () => ({x: 0, y: 0}),
                getBounds: () => ({x: 0, y: 0, width: 1, height: 1}),
                panTo: () => {},
                fitBounds: () => {}
            }
        };
        
        const osdLayer = new OSDLayer({
            viewer: mockViewer,
            attribution: 'Test Layer'
        });
        
        if (osdLayer) {
            console.log('✅ OSDLayer instance created successfully');
            console.log('OSDLayer class:', osdLayer.constructor.name);
            return true;
        } else {
            console.error('❌ Failed to create OSDLayer instance');
            return false;
        }
    } catch (error) {
        console.error('❌ Error creating OSDLayer:', error.message);
        return false;
    }
}

/**
 * Test creating a GeoJS map with OSD layer
 */
export function testGeoJSMapWithOSD() {
    console.log('=== Testing GeoJS Map with OSD Layer ===');
    
    if (!geo || !geo.map) {
        console.error('❌ GeoJS map not available');
        return false;
    }
    
    try {
        // Create a basic map (this won't work in Node.js without DOM, but tests the API)
        const map = geo.map({
            node: document.createElement('div'), // Mock node
            gcs: 'EPSG:4326'
        });
        
        if (map) {
            console.log('✅ GeoJS map created successfully');
            
            // Test creating OSD layer through map
            if (geo.layerTypes()['osd']) {
                try {
                    // This would need a real viewer, but tests the registration
                    console.log('✅ OSD layer type available for map.createLayer()');
                    return true;
                } catch (error) {
                    console.error('❌ Error testing map.createLayer with OSD:', error.message);
                    return false;
                }
            } else {
                console.error('❌ OSD layer type not available for map creation');
                return false;
            }
        } else {
            console.error('❌ Failed to create GeoJS map');
            return false;
        }
    } catch (error) {
        console.error('❌ Error creating GeoJS map:', error.message);
        return false;
    }
}

// Run tests if this module is executed directly
if (typeof window !== 'undefined') {
    // Browser environment
    window.testOSDRegistration = {
        testOSDLayerRegistration,
        testGeoJSMapWithOSD
    };
} else if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].includes('test-osd-registration')) {
    // Node.js environment (if run directly)
    testOSDLayerRegistration();
}

export default {
    testOSDLayerRegistration,
    testGeoJSMapWithOSD
};