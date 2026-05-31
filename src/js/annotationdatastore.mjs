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
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function normalizeFeatureCollections(featureCollections) {
    if (featureCollections == null) return [];
    return cloneData(Array.isArray(featureCollections) ? featureCollections : [featureCollections]);
}

function withMutationMetadata(state, actionType, meta = null) {
    return {
        ...state,
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

const annotationDataActions = Object.freeze({
    hydrate: (state, meta) => makeAction(ACTION_TYPES.HYDRATE, cloneData(state), meta),
    replaceFeatureCollections: (featureCollections, meta) => makeAction(
        ACTION_TYPES.REPLACE_FEATURE_COLLECTIONS,
        { featureCollections: normalizeFeatureCollections(featureCollections) },
        meta,
    ),
    addFeatureCollections: (featureCollections, meta) => makeAction(
        ACTION_TYPES.ADD_FEATURE_COLLECTIONS,
        { featureCollections: normalizeFeatureCollections(featureCollections) },
        meta,
    ),
    upsertFeatureCollection: (featureCollection, matcher = {}, meta) => makeAction(
        ACTION_TYPES.UPSERT_FEATURE_COLLECTION,
        { featureCollection: cloneData(featureCollection), matcher: cloneData(matcher) },
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
        { featureCollections: normalizeFeatureCollections(featureCollections) },
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
                featureCollections: normalizeFeatureCollections(action.payload?.featureCollections),
            }, action.type, action.meta);

        case ACTION_TYPES.ADD_FEATURE_COLLECTIONS:
            return withMutationMetadata({
                ...state,
                featureCollections: [
                    ...normalizeFeatureCollections(state.featureCollections),
                    ...normalizeFeatureCollections(action.payload?.featureCollections),
                ],
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
        return this.dispatch(annotationDataActions.syncFromProject(toolkit.snapshotGeoJSON(), meta));
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
        this._listeners.forEach((listener) => listener(state));
    }
}

export {
    ACTION_TYPES as annotationDataActionTypes,
    AnnotationDataStore,
    annotationDataActions,
    annotationDataReducer,
    initialAnnotationDataState,
};
