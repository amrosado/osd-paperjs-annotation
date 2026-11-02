import {identifyAnnotationCollections, distinguishAnnotationCollections} from './utils/annotationIdentity.mjs';

const ANNOTATION_DATA_ACTION_PREFIX = 'osdPaperjsAnnotation';

const ACTION_TYPES = Object.freeze({
    HYDRATE: `${ANNOTATION_DATA_ACTION_PREFIX}/hydrate`,
    REPLACE_FEATURE_COLLECTIONS: `${ANNOTATION_DATA_ACTION_PREFIX}/replaceFeatureCollections`,
    ADD_FEATURE_COLLECTIONS: `${ANNOTATION_DATA_ACTION_PREFIX}/addFeatureCollections`,
    UPSERT_FEATURE_COLLECTION: `${ANNOTATION_DATA_ACTION_PREFIX}/upsertFeatureCollection`,
    REMOVE_FEATURE_COLLECTION: `${ANNOTATION_DATA_ACTION_PREFIX}/removeFeatureCollection`,
    CLEAR_FEATURE_COLLECTIONS: `${ANNOTATION_DATA_ACTION_PREFIX}/clearFeatureCollections`,
    SET_CACHE: `${ANNOTATION_DATA_ACTION_PREFIX}/setCache`,
    CLEAR_CACHE: `${ANNOTATION_DATA_ACTION_PREFIX}/clearCache`,
    SYNC_FROM_PROJECT: `${ANNOTATION_DATA_ACTION_PREFIX}/syncFromProject`,
});

const initialAnnotationDataState = Object.freeze({
    featureCollections: Object.freeze([]),
    cached: Object.freeze({}),
    version: 0,
    lastAction: null,
    lastMeta: null,
});

function cloneData(value) {
    if (value == null) return value;
    // Paper style/rescale payloads often include functions; structuredClone throws
    // DataCloneError on those. Prefer JSON so Redux only stores serializable data.
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        // Fall through for values JSON cannot represent.
    }
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch {
            // Last resort: shallow copy containers.
        }
    }
    if (Array.isArray(value)) return value.map((item) => cloneData(item));
    if (typeof value === 'object') {
        const next = {};
        Object.keys(value).forEach((key) => {
            const entry = value[key];
            if (typeof entry === 'function') return;
            next[key] = cloneData(entry);
        });
        return next;
    }
    return value;
}

function normalizeFeatureCollections(featureCollections) {
    if (featureCollections == null) return [];
    return cloneData(Array.isArray(featureCollections) ? featureCollections : [featureCollections]);
}

function withMutationMetadata(state, actionType, meta = null) {
    return {
        ...state,
        featureCollections: distinguishAnnotationCollections(state.featureCollections),
        version: (state.version || 0) + 1,
        lastAction: actionType,
        lastMeta: cloneData(meta),
    };
}

function collectionKey(featureCollection, fallbackIndex = null) {
    return featureCollection?.id
        ?? featureCollection?.properties?.id
        ?? featureCollection?.label
        ?? featureCollection?.properties?.label
        ?? fallbackIndex;
}

function collectionMatches(featureCollection, matcher, index) {
    if (!matcher) return false;
    if (typeof matcher.index === 'number') return matcher.index === index;
    const key = collectionKey(featureCollection, index);
    return (matcher.id != null && key === matcher.id)
        || (matcher.label != null && featureCollection?.label === matcher.label);
}

function upsertFeatureCollection(featureCollections, featureCollection, matcher = {}) {
    const next = [...featureCollections];
    const targetKey = matcher.id ?? matcher.label ?? collectionKey(featureCollection);
    const index = typeof matcher.index === 'number'
        ? matcher.index
        : next.findIndex((item, i) => collectionKey(item, i) === targetKey);

    if (index >= 0 && index < next.length) {
        next[index] = featureCollection;
    } else {
        next.push(featureCollection);
    }
    return next;
}

function makeAction(type, payload = {}, meta = {}) {
    return { type, payload, meta };
}

// Paper is an editing projection and may contain only part of the Redux tree.
// Apply explicit edits/deletions without treating missing Paper items as deletes.
function mergeProjectEdits(current, incoming, meta = {}) {
    const featureKey = (feature) => feature?.properties?.userdata?.object_id ?? feature?.id;
    const removedLayers = new Set(meta.removedLayerIds || []);
    const removedFeatures = new Set(meta.removedFeatureIds || []);
    const incomingIds = new Set(incoming.flatMap((collection) => (collection.features || []).map(featureKey)).filter(Boolean));
    let next = normalizeFeatureCollections(current).filter((collection) => !removedLayers.has(collectionKey(collection)));
    next = next.map((collection) => ({...collection, features: (collection.features || []).filter((feature) => (
        !removedFeatures.has(featureKey(feature)) && !incomingIds.has(featureKey(feature))
    ))}));
    for (const collection of incoming) {
        const key = collectionKey(collection);
        if (removedLayers.has(key)) continue;
        const index = next.findIndex((candidate) => collectionKey(candidate) === key);
        const features = (collection.features || []).filter((feature) => !removedFeatures.has(featureKey(feature)));
        const previous = index >= 0 ? next[index] : null;
        const merged = {...previous, ...collection, features: [...(previous?.features || []), ...features]};
        if (index >= 0) next[index] = merged;
        else next.push(merged);
    }
    return next;
}

const annotationDataActions = Object.freeze({
    hydrate: (state, meta) => makeAction(ACTION_TYPES.HYDRATE, {...cloneData(state),
        featureCollections: identifyAnnotationCollections(normalizeFeatureCollections(state?.featureCollections))}, meta),
    replaceFeatureCollections: (featureCollections, meta) => makeAction(
        ACTION_TYPES.REPLACE_FEATURE_COLLECTIONS,
        { featureCollections: identifyAnnotationCollections(normalizeFeatureCollections(featureCollections)) },
        meta,
    ),
    addFeatureCollections: (featureCollections, meta) => makeAction(
        ACTION_TYPES.ADD_FEATURE_COLLECTIONS,
        { featureCollections: identifyAnnotationCollections(normalizeFeatureCollections(featureCollections)) },
        meta,
    ),
    upsertFeatureCollection: (featureCollection, matcher = {}, meta) => makeAction(
        ACTION_TYPES.UPSERT_FEATURE_COLLECTION,
        { featureCollection: identifyAnnotationCollections([cloneData(featureCollection)])[0], matcher: cloneData(matcher) },
        meta,
    ),
    removeFeatureCollection: (matcher, meta) => makeAction(
        ACTION_TYPES.REMOVE_FEATURE_COLLECTION,
        { matcher: cloneData(matcher) },
        meta,
    ),
    clearFeatureCollections: (meta) => makeAction(ACTION_TYPES.CLEAR_FEATURE_COLLECTIONS, {}, meta),
    setCache: (key, featureCollections, meta) => makeAction(
        ACTION_TYPES.SET_CACHE,
        { key, featureCollections: normalizeFeatureCollections(featureCollections) },
        meta,
    ),
    clearCache: (key = null, meta) => makeAction(ACTION_TYPES.CLEAR_CACHE, { key }, meta),
    syncFromProject: (featureCollections, meta) => makeAction(
        ACTION_TYPES.SYNC_FROM_PROJECT,
        { featureCollections: identifyAnnotationCollections(normalizeFeatureCollections(featureCollections)) },
        meta,
    ),
});

function annotationDataReducer(state = initialAnnotationDataState, action = {}) {
    switch (action.type) {
        case ACTION_TYPES.HYDRATE:
            return withMutationMetadata({
                ...initialAnnotationDataState,
                ...cloneData(action.payload),
            }, action.type, action.meta);

        case ACTION_TYPES.REPLACE_FEATURE_COLLECTIONS:
        case ACTION_TYPES.SYNC_FROM_PROJECT:
            return withMutationMetadata({
                ...state,
                featureCollections: action.type === ACTION_TYPES.SYNC_FROM_PROJECT && action.meta?.partial
                    ? mergeProjectEdits(state.featureCollections, normalizeFeatureCollections(action.payload?.featureCollections), action.meta)
                    : normalizeFeatureCollections(action.payload?.featureCollections),
            }, action.type, action.meta);

        case ACTION_TYPES.ADD_FEATURE_COLLECTIONS:
            return withMutationMetadata({
                ...state,
                featureCollections: normalizeFeatureCollections(action.payload?.featureCollections).reduce(
                    (current, collection) => upsertFeatureCollection(current, collection), normalizeFeatureCollections(state.featureCollections)),
            }, action.type, action.meta);

        case ACTION_TYPES.UPSERT_FEATURE_COLLECTION: {
            const featureCollection = cloneData(action.payload?.featureCollection);
            if (!featureCollection) return state;
            return withMutationMetadata({
                ...state,
                featureCollections: upsertFeatureCollection(
                    normalizeFeatureCollections(state.featureCollections),
                    featureCollection,
                    action.payload?.matcher,
                ),
            }, action.type, action.meta);
        }

        case ACTION_TYPES.REMOVE_FEATURE_COLLECTION:
            return withMutationMetadata({
                ...state,
                featureCollections: normalizeFeatureCollections(state.featureCollections).filter(
                    (featureCollection, index) => !collectionMatches(featureCollection, action.payload?.matcher, index),
                ),
            }, action.type, action.meta);

        case ACTION_TYPES.CLEAR_FEATURE_COLLECTIONS:
            return withMutationMetadata({
                ...state,
                featureCollections: [],
            }, action.type, action.meta);

        case ACTION_TYPES.SET_CACHE:
            if (action.payload?.key == null) return state;
            return withMutationMetadata({
                ...state,
                cached: {
                    ...(state.cached || {}),
                    [action.payload.key]: normalizeFeatureCollections(action.payload.featureCollections),
                },
            }, action.type, action.meta);

        case ACTION_TYPES.CLEAR_CACHE: {
            if (action.payload?.key == null) {
                return withMutationMetadata({ ...state, cached: {} }, action.type, action.meta);
            }
            const cached = { ...(state.cached || {}) };
            delete cached[action.payload.key];
            return withMutationMetadata({ ...state, cached }, action.type, action.meta);
        }

        default:
            return state;
    }
}

class AnnotationDataStore {
    constructor(options = {}) {
        const reduxOptions = options.redux === true ? { enabled: true } : (options.redux || {});
        this._reduxEnabled = Boolean(reduxOptions.enabled || reduxOptions.store || reduxOptions.dispatch);
        this._sliceKey = reduxOptions.sliceKey || options.sliceKey || 'osdPaperjsAnnotation';
        this._selector = reduxOptions.selector || options.selector || ((state) => state?.[this._sliceKey] ?? state);
        this._dispatch = reduxOptions.dispatch || reduxOptions.store?.dispatch?.bind(reduxOptions.store);
        this._getState = reduxOptions.getState || reduxOptions.store?.getState?.bind(reduxOptions.store);
        this._unsubscribeRedux = null;
        this._hasReduxSubscription = Boolean(this._reduxEnabled && reduxOptions.store?.subscribe);
        this._listeners = new Set();
        this._state = annotationDataReducer(initialAnnotationDataState, annotationDataActions.hydrate(options.initialState || {}));
        this._lastReduxNotificationVersion = 0;

        if (this._reduxEnabled && (!this._dispatch || !this._getState)) {
            throw new Error('AnnotationDataStore redux mode requires a Redux store or dispatch/getState pair.');
        }

        this._lastReduxNotificationVersion = Number(this.state?.version || 0);

        if (this._hasReduxSubscription) {
            this._unsubscribeRedux = reduxOptions.store.subscribe(() => this._notifyReduxIfChanged());
        }
    }

    get reduxEnabled() {
        return this._reduxEnabled;
    }

    get state() {
        if (!this._reduxEnabled) return this._state;
        return this._selector(this._getState()) || initialAnnotationDataState;
    }

    dispatch(action) {
        if (this._reduxEnabled) {
            this._dispatch(action);
            if (!this._hasReduxSubscription) {
                this._notify();
            }
        } else {
            this._state = annotationDataReducer(this._state, action);
            this._notify();
        }
        return this.state;
    }

    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    destroy() {
        if (this._unsubscribeRedux) this._unsubscribeRedux();
        this._unsubscribeRedux = null;
        this._listeners.clear();
    }

    replaceFeatureCollections(featureCollections, meta = {}) {
        return this.dispatch(annotationDataActions.replaceFeatureCollections(featureCollections, meta));
    }

    addFeatureCollections(featureCollections, meta = {}) {
        return this.dispatch(annotationDataActions.addFeatureCollections(featureCollections, meta));
    }

    upsertFeatureCollection(featureCollection, matcher = {}, meta = {}) {
        return this.dispatch(annotationDataActions.upsertFeatureCollection(featureCollection, matcher, meta));
    }

    removeFeatureCollection(matcher, meta = {}) {
        return this.dispatch(annotationDataActions.removeFeatureCollection(matcher, meta));
    }

    clearFeatureCollections(meta = {}) {
        return this.dispatch(annotationDataActions.clearFeatureCollections(meta));
    }

    setCache(key, featureCollections, meta = {}) {
        return this.dispatch(annotationDataActions.setCache(key, featureCollections, meta));
    }

    getCache(key) {
        return cloneData(this.state.cached?.[key] || []);
    }

    clearCache(key = null, meta = {}) {
        return this.dispatch(annotationDataActions.clearCache(key, meta));
    }

    syncFromToolkit(toolkit, meta = {}) {
        if (!toolkit || typeof toolkit.snapshotGeoJSON !== 'function') return this.state;
        const snapshot = toolkit.snapshotGeoJSON();
        const presentObjects = new Set(snapshot.flatMap(layer => (layer.features || []).map(feature => feature.id)));
        const presentLayers = new Set(snapshot.map(layer => layer.id));
        return this.dispatch(annotationDataActions.syncFromProject(snapshot, {
            ...meta,
            // Replacement and mask helpers also remove Paper items. A surviving
            // object with the same identity is an edit, not a database delete.
            removedFeatureIds: (meta.removedFeatureIds || []).filter(id => !presentObjects.has(id)),
            removedLayerIds: (meta.removedLayerIds || []).filter(id => !presentLayers.has(id)),
            partial: this.reduxEnabled,
        }));
    }

    toGeoJSON() {
        return normalizeFeatureCollections(this.state.featureCollections);
    }

    toGeoJSONString(replacer, space) {
        return JSON.stringify(this.toGeoJSON(), replacer, space);
    }

    _notifyReduxIfChanged() {
        const state = this.state;
        const version = Number(state?.version || 0);
        if (version === this._lastReduxNotificationVersion) return;
        this._lastReduxNotificationVersion = version;
        this._notify(state);
    }

    _notify(state = this.state) {
        this._listeners.forEach((listener) => {
            try {
                listener(state);
            } catch (error) {
                // One bad subscriber (e.g. Paper projection) must not block GeoJS.
                console.error('AnnotationDataStore listener failed:', error);
            }
        });
    }
}

export {
    ACTION_TYPES as annotationDataActionTypes,
    AnnotationDataStore,
    annotationDataActions,
    annotationDataReducer,
    initialAnnotationDataState,
};
