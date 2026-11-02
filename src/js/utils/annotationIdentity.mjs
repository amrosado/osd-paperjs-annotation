export function newAnnotationId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Operates on a detached JSON document before it is dispatched to Redux.
export function identifyAnnotationCollections(collections) {
    const layers = new Set(), objects = new Set();
    return collections.filter(collection => collection && typeof collection === 'object').map(collection => {
        if (collection.properties?.wsvvEmbeddingGrid || collection.id === 'wsvv-embedding-grid') return collection;
        let id = String(collection.properties?.userdata?.layer_id || collection.id || '');
        if (!id || layers.has(id)) id = newAnnotationId();
        layers.add(id);
        const properties = {...collection.properties, userdata: {...collection.properties?.userdata, layer_id: id}};
        const features = (collection.features || []).map(feature => {
            let objectId = String(feature.properties?.userdata?.object_id || feature.id || feature.properties?.id || '');
            if (!objectId || objects.has(objectId)) objectId = newAnnotationId();
            objects.add(objectId);
            return {...feature, id: objectId, properties: {...feature.properties,
                userdata: {...feature.properties?.userdata, object_id: objectId, layer_id: id,
                    layer_label: collection.label || 'Annotations'}}};
        });
        return {...collection, id, properties, features};
    });
}

// Keep reducers deterministic when separately imported documents reuse IDs.
// The original layer keeps its identity; the imported copy gets a stable suffix.
export function distinguishAnnotationCollections(collections = []) {
    const layers = new Set(), objects = new Set();
    return collections.map((collection, layerIndex) => {
        if (collection.properties?.wsvvEmbeddingGrid || collection.id === 'wsvv-embedding-grid') return collection;
        const originalLayerId = String(collection.id || collection.properties?.userdata?.layer_id || `layer-${layerIndex}`);
        let id = originalLayerId;
        while (layers.has(id)) id += `:copy:${layerIndex}`;
        layers.add(id);
        let changed = id !== collection.id || collection.properties?.userdata?.layer_id !== id;
        const features = (collection.features || []).map((feature, index) => {
            const originalId = String(feature.id || feature.properties?.userdata?.object_id || `${id}:object:${index}`);
            let objectId = originalId;
            while (objects.has(objectId)) objectId += `:copy:${id}:${index}`;
            objects.add(objectId);
            if (objectId === feature.id && feature.properties?.userdata?.object_id === objectId && !changed) return feature;
            changed = true;
            return {...feature, id: objectId, properties: {...feature.properties,
                userdata: {...feature.properties?.userdata, object_id: objectId, layer_id: id}}};
        });
        return changed ? {...collection, id, features, properties: {...collection.properties,
            userdata: {...collection.properties?.userdata, layer_id: id}}} : collection;
    });
}
