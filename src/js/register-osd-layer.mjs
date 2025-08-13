/**
 * Manual OSD Layer Registration Utility
 * 
 * This module provides utilities to manually register the OSDLayer with GeoJS
 * when automatic registration fails or needs to be done at a specific time.
 */

import OSDLayer from './osdLayer.mjs';

/**
 * Manually register OSDLayer with a provided geo object
 * @param {Object} geoObject - The GeoJS geo object to register with
 * @returns {boolean} True if registration succeeded
 */
export function manualRegisterOSDLayer(geoObject) {
    if (!geoObject) {
        console.error('No geo object provided for manual registration');
        return false;
    }
    
    if (!geoObject.registerLayer) {
        console.error('Provided geo object does not have registerLayer method');
        console.log('Available methods:', Object.keys(geoObject));
        return false;
    }
    
    try {
        geoObject.registerLayer('osd', OSDLayer);
        console.log('✅ OSDLayer manually registered successfully');
        
        // Verify registration
        if (geoObject.layerTypes && geoObject.layerTypes()['osd']) {
            console.log('✅ OSD layer type verified in registry');
            return true;
        } else {
            console.warn('⚠️  Registration appeared to succeed but layer type not found in registry');
            return false;
        }
    } catch (error) {
        console.error('❌ Error during manual registration:', error);
        return false;
    }
}

/**
 * Attempt to find and register with global geo objects
 * @returns {boolean} True if registration succeeded
 */
export function findAndRegisterGlobal() {
    const globalCandidates = [];
    
    if (typeof window !== 'undefined') {
        // Check common global locations
        if (window.geo) globalCandidates.push({ name: 'window.geo', obj: window.geo });
        if (window.geojs) globalCandidates.push({ name: 'window.geojs', obj: window.geojs });
        if (window.GeoJS) globalCandidates.push({ name: 'window.GeoJS', obj: window.GeoJS });
        if (window.geojs?.geo) globalCandidates.push({ name: 'window.geojs.geo', obj: window.geojs.geo });
        if (window.GeoJS?.geo) globalCandidates.push({ name: 'window.GeoJS.geo', obj: window.GeoJS.geo });
    }
    
    console.log('Found global geo candidates:', globalCandidates.map(c => c.name));
    
    for (const candidate of globalCandidates) {
        console.log(`Trying to register with ${candidate.name}...`);
        if (manualRegisterOSDLayer(candidate.obj)) {
            console.log(`✅ Successfully registered with ${candidate.name}`);
            return true;
        }
    }
    
    console.log('❌ Failed to register with any global geo object');
    return false;
}

/**
 * Check if OSDLayer is already registered
 * @param {Object} geoObject - Optional geo object to check, will search globally if not provided
 * @returns {boolean} True if OSDLayer is registered
 */
export function isOSDLayerRegistered(geoObject = null) {
    const candidates = [];
    
    if (geoObject) {
        candidates.push(geoObject);
    }
    
    if (typeof window !== 'undefined') {
        if (window.geo) candidates.push(window.geo);
        if (window.geojs?.geo) candidates.push(window.geojs.geo);
        if (window.GeoJS?.geo) candidates.push(window.GeoJS.geo);
        if (window.GeoJS) candidates.push(window.GeoJS);
    }
    
    for (const candidate of candidates) {
        if (candidate && candidate.layerTypes) {
            try {
                const layerTypes = candidate.layerTypes();
                if (layerTypes && layerTypes['osd']) {
                    console.log('✅ OSDLayer is registered');
                    return true;
                }
            } catch (error) {
                console.log('Error checking layer types:', error.message);
            }
        }
    }
    
    console.log('❌ OSDLayer is not registered');
    return false;
}

/**
 * Force registration by trying all available strategies
 * @returns {boolean} True if any strategy succeeded
 */
export function forceRegisterOSDLayer() {
    console.log('🔧 Force registering OSDLayer...');
    
    // Strategy 1: Try the built-in register function
    if (OSDLayer.register && OSDLayer.register()) {
        console.log('✅ Registration succeeded via OSDLayer.register()');
        return true;
    }
    
    // Strategy 2: Try global registration
    if (findAndRegisterGlobal()) {
        console.log('✅ Registration succeeded via global search');
        return true;
    }
    
    // Strategy 3: Try dynamic import (if available)
    if (typeof window !== 'undefined' && window.require) {
        try {
            const dynamicGeoJS = window.require('geojs');
            if (manualRegisterOSDLayer(dynamicGeoJS.geo || dynamicGeoJS)) {
                console.log('✅ Registration succeeded via dynamic import');
                return true;
            }
        } catch (error) {
            console.log('Dynamic import strategy failed:', error.message);
        }
    }
    
    console.log('❌ All registration strategies failed');
    return false;
}

// Export all functions
export default {
    manualRegisterOSDLayer,
    findAndRegisterGlobal,
    isOSDLayerRegistered,
    forceRegisterOSDLayer,
    OSDLayer
};

// Global export for browser console access
if (typeof window !== 'undefined') {
    window.OSDLayerRegistration = {
        manualRegisterOSDLayer,
        findAndRegisterGlobal,
        isOSDLayerRegistered,
        forceRegisterOSDLayer,
        OSDLayer
    };
    
    console.log('🛠️  OSD Layer registration utilities available as window.OSDLayerRegistration');
}