import assert from 'node:assert';
import {
    AnnotationDataStore,
    annotationDataActions,
    annotationDataActionTypes,
    annotationDataReducer,
    initialAnnotationDataState,
} from '../src/js/annotationdatastore.mjs';

const fcA = {
    type: 'FeatureCollection',
    label: 'Layer A',
    features: [],
    properties: { userdata: { source: 'test' } },
};

const fcB = {
    type: 'FeatureCollection',
    label: 'Layer B',
    features: [],
    properties: {},
};

let state = annotationDataReducer(undefined, annotationDataActions.replaceFeatureCollections([fcA]));
assert.strictEqual(state.featureCollections.length, 1);
assert.strictEqual(state.featureCollections[0].label, 'Layer A');
assert.strictEqual(state.lastAction, annotationDataActionTypes.REPLACE_FEATURE_COLLECTIONS);

state = annotationDataReducer(state, annotationDataActions.addFeatureCollections(fcB));
assert.deepStrictEqual(state.featureCollections.map((fc) => fc.label), ['Layer A', 'Layer B']);

state = annotationDataReducer(state, annotationDataActions.removeFeatureCollection({ label: 'Layer A' }));
assert.deepStrictEqual(state.featureCollections.map((fc) => fc.label), ['Layer B']);

const localStore = new AnnotationDataStore();
localStore.replaceFeatureCollections([fcA]);
const exported = localStore.toGeoJSON();
exported[0].label = 'Mutated outside store';
assert.strictEqual(localStore.toGeoJSON()[0].label, 'Layer A');

localStore.setCache('slide-a', [fcB]);
assert.strictEqual(localStore.getCache('slide-a')[0].label, 'Layer B');
localStore.clearCache('slide-a');
assert.deepStrictEqual(localStore.getCache('slide-a'), []);

let reduxState = { osdPaperjsAnnotation: initialAnnotationDataState };
const reduxActions = [];
const reduxStore = {
    dispatch(action) {
        reduxActions.push(action);
        reduxState = {
            ...reduxState,
            osdPaperjsAnnotation: annotationDataReducer(reduxState.osdPaperjsAnnotation, action),
        };
    },
    getState() {
        return reduxState;
    },
    subscribe() {
        return () => {};
    },
};

const reduxBackedStore = new AnnotationDataStore({
    redux: {
        enabled: true,
        store: reduxStore,
    },
});
reduxBackedStore.replaceFeatureCollections([fcA]);
reduxBackedStore.addFeatureCollections([fcB]);

assert.strictEqual(reduxBackedStore.reduxEnabled, true);
assert.deepStrictEqual(
    reduxBackedStore.toGeoJSON().map((fc) => fc.label),
    ['Layer A', 'Layer B'],
);
assert.deepStrictEqual(
    reduxActions.map((action) => action.type),
    [
        annotationDataActionTypes.REPLACE_FEATURE_COLLECTIONS,
        annotationDataActionTypes.ADD_FEATURE_COLLECTIONS,
    ],
);

console.log('annotationDataStore tests passed');
