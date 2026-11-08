import { OpenSeadragon } from './osd-loader.mjs';
import { debugDuration, debugLog, debugLogJson, debugNow, isDebugEnabled } from '../../../helpers/debugLog.js';
import { normalizeEmbeddingId } from '../../../helpers/embeddingIds.js';
import { geo, map as GeoMap, util as geoUtil } from './geojs-loader.mjs';
import { displayBoundsFromBounds } from './geojs-selection-helpers.mjs';
import { normalizePointTextStyle, POINT_TEXT_MARKER_RADIUS, pointTextOffsetForMatrix } from './utils/pointTextStyle.mjs';
import { displayStyleForFeature, subscribeAuthorColors } from '../../../helpers/annotationAuthors.js';

const GEOJS_DISPLAY_Z_INDEX = '20';
const PAPER_OVERLAY_Z_INDEX = '30';
const EMBEDDING_RECT_POINT_PIXEL_THRESHOLD = 0;
const DEFAULT_OVERVIEW_RENDER_THRESHOLD = 50000;
const DEFAULT_OVERVIEW_BIN_PIXELS = 10;
const DEFAULT_OVERVIEW_GRID_SIZE = 32;
const DEFAULT_SPATIAL_QUERY_BIN_LIMIT = 20000;

const DEFAULT_DISPLAY_OPTIONS = Object.freeze({
    enabled: false,
    renderer: 'webgl',
    hidePaperItems: true,
    editOn: 'click',
    pointRadius: 9,
    lineWidth: 0.75,
    fillOpacity: 0,
    strokeOpacity: 1,
    selectedPointRadius: 10,
    selectedLineWidth: 1.5,
    selectedStrokeColor: '#60a5fa',
    selectedStrokeOpacity: 1,
    selectedFillOpacity: 0,
    renderMargin: 256,
    spatialBinSize: 4096,
    overviewRenderThreshold: DEFAULT_OVERVIEW_RENDER_THRESHOLD,
    overviewBinPixels: DEFAULT_OVERVIEW_BIN_PIXELS,
    overviewGridSize: DEFAULT_OVERVIEW_GRID_SIZE,
    spatialQueryBinLimit: DEFAULT_SPATIAL_QUERY_BIN_LIMIT,
    overviewFillColor: '#00d5ff',
    overviewStrokeColor: '#111827',
    overviewFillOpacity: 0.95,
    overviewStrokeOpacity: 1,
    overviewStrokeWidth: 1.1,
    renderEmbeddingBoundaries: true,
    coordinateMode: 'image',
    immediateViewportUpdates: true,
    hitTolerance: 6,
});

function colorToCSS(value, fallback) {
    if (!value) return fallback;
    if (typeof value === 'string') return value;
    if (typeof value.toCSS === 'function') return value.toCSS();
    if (Array.isArray(value)) return `rgba(${value.join(',')})`;
    return fallback;
}

function colorToGeoJS(value, fallback) {
    const raw = colorToCSS(value, fallback) ?? fallback;
    const color = geoUtil.convertColorAndOpacity?.(raw, undefined, fallback)
        ?? geoUtil.convertColor?.(raw)
        ?? geoUtil.convertColor?.(fallback);
    if (color && Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b)) {
        return { r: color.r, g: color.g, b: color.b };
    }
    return { r: 0, g: 0, b: 0 };
}

function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function finiteRect(value) {
    return value
        && Number.isFinite(Number(value.x))
        && Number.isFinite(Number(value.y))
        && Number.isFinite(Number(value.width))
        && Number.isFinite(Number(value.height))
        && Number(value.width) > 0
        && Number(value.height) > 0;
}

function summarizeBounds(bounds) {
    if (!bounds) return null;
    const minX = finiteNumber(bounds.minX ?? bounds.left ?? bounds.x, null);
    const minY = finiteNumber(bounds.minY ?? bounds.top ?? bounds.y, null);
    const maxX = finiteNumber(bounds.maxX ?? bounds.right ?? (minX !== null ? minX + Number(bounds.width) : null), null);
    const maxY = finiteNumber(bounds.maxY ?? bounds.bottom ?? (minY !== null ? minY + Number(bounds.height) : null), null);
    if ([minX, minY, maxX, maxY].some((value) => value === null)) return null;
    return {
        minX: Number(minX.toFixed(2)),
        minY: Number(minY.toFixed(2)),
        maxX: Number(maxX.toFixed(2)),
        maxY: Number(maxY.toFixed(2)),
        width: Number((maxX - minX).toFixed(2)),
        height: Number((maxY - minY).toFixed(2)),
    };
}

function featureStyleValue(key, fallback) {
    return (datum, _index, row) => {
        const source = row && row[key] !== undefined ? row : datum;
        return source?.[key] ?? fallback;
    };
}

function flattenFeatureCollections(featureCollections = []) {
    const rows = [];
    let globalFeatureIndex = 0;
    featureCollections.forEach((collection, collectionIndex) => {
        (collection.features || []).forEach((feature, featureIndex) => {
            // Live-session peers stamp userdata.object_id; prefer it so GeoJS rows
            // match Paper keys and visibility handoff works across clients.
            const id = feature.properties?.userdata?.object_id
                ?? feature.id
                ?? feature.properties?.id
                ?? feature.properties?.userdata?.id
                ?? `${collection.id || collection.label || collectionIndex}:${featureIndex}:${feature.properties?.label || 'feature'}`;
            rows.push({
                id,
                collectionIndex,
                featureIndex,
                globalFeatureIndex,
                collection,
                feature,
            });
            globalFeatureIndex += 1;
        });
    });
    return rows;
}

function coordinateToPoint(coord) {
    return { x: coord[0], y: coord[1] };
}

function closeRing(ring) {
    if (!ring.length) return ring;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return ring;
    return [...ring, first];
}

function rotatePoint(point, center, degrees) {
    const radians = degrees * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    return [
        center[0] + dx * cos - dy * sin,
        center[1] + dx * sin + dy * cos,
    ];
}

function rectanglePointGeometryToPolygon(geom) {
    const center = geom.coordinates || [];
    const props = geom.properties || {};
    if (center.length < 2 || !props.width || !props.height) return null;
    const x = center[0];
    const y = center[1];
    const halfWidth = props.width / 2;
    const halfHeight = props.height / 2;
    const ring = [
        [x - halfWidth, y - halfHeight],
        [x + halfWidth, y - halfHeight],
        [x + halfWidth, y + halfHeight],
        [x - halfWidth, y + halfHeight],
    ].map((point) => rotatePoint(point, center, props.angle || 0));
    return [closeRing(ring)];
}

function ellipsePointGeometryToPolygon(geom, steps = 48) {
    const center = geom.coordinates || [];
    const props = geom.properties || {};
    if (center.length < 2 || !props.majorRadius || !props.minorRadius) return null;
    const ring = [];
    for (let i = 0; i < steps; i += 1) {
        const theta = (i / steps) * Math.PI * 2;
        const point = [
            center[0] + Math.cos(theta) * props.majorRadius,
            center[1] + Math.sin(theta) * props.minorRadius,
        ];
        ring.push(rotatePoint(point, center, props.angle || 0));
    }
    return [closeRing(ring)];
}

function pointSubtypePolygon(geom) {
    const subtype = geom.properties?.subtype?.toLowerCase?.();
    if (subtype === 'rectangle') return rectanglePointGeometryToPolygon(geom);
    if (subtype === 'ellipse') return ellipsePointGeometryToPolygon(geom);
    return null;
}

function paperFeatureKey(item, fallbackIndex) {
    // Live sessions stamp userdata.object_id; prefer it so GeoJS rows match Paper.
    return item?.data?.userdata?.object_id
        ?? item?.annotationItem?.toGeoJSONFeature?.()?.id
        ?? item?.data?.userdata?.id
        ?? item?.embedding_id
        ?? item?.displayName
        ?? fallbackIndex;
}

function styleValueToCSS(value, fallback = null) {
    if (!value) return fallback;
    if (typeof value === 'string') return value;
    if (typeof value.toCSS === 'function') return value.toCSS();
    return fallback;
}

function paperItemBoundsFeature(item, id) {
    const imageBounds = item?.data?.geojsImageBounds;
    const hasImageBounds = imageBounds
        && [imageBounds.left, imageBounds.top, imageBounds.width, imageBounds.height]
            .map(Number)
            .every(Number.isFinite)
        && Number(imageBounds.width) > 0
        && Number(imageBounds.height) > 0
        && item?.data?.tiledImage;
    const bounds = item?.bounds;

    if (!hasImageBounds && !bounds) return null;

    const ring = hasImageBounds
        ? closeRing([
            [Number(imageBounds.left), Number(imageBounds.top)],
            [Number(imageBounds.left) + Number(imageBounds.width), Number(imageBounds.top)],
            [Number(imageBounds.left) + Number(imageBounds.width), Number(imageBounds.top) + Number(imageBounds.height)],
            [Number(imageBounds.left), Number(imageBounds.top) + Number(imageBounds.height)],
        ])
        : closeRing([
            [bounds.left, bounds.top],
            [bounds.right, bounds.top],
            [bounds.right, bounds.bottom],
            [bounds.left, bounds.bottom],
        ]);

    return {
        type: 'Feature',
        id,
        geometry: {
            type: 'Polygon',
            coordinates: [ring],
        },
        properties: {
            id,
            label: item.displayName,
            fillColor: styleValueToCSS(item.style?.fillColor, '#3b82f6'),
            coordinateSpace: hasImageBounds ? 'tiledImage' : 'paper',
            fillOpacity: 0,
            strokeColor: styleValueToCSS(item.style?.strokeColor, '#1f2937'),
            strokeOpacity: Number(item.style?.strokeColor?.alpha ?? item.strokeOpacity ?? 1),
            strokeWidth: Math.min(finiteNumber(item.style?.strokeWidth, 0.75), 0.75),
        },
    };
}

function paperItemToFeature(item, id) {
    try {
        const feature = item?.annotationItem?.toGeoJSONFeature?.();
        if (feature) {
            const objectId = item?.data?.userdata?.object_id
                ?? feature.properties?.userdata?.object_id
                ?? feature.id
                ?? id;
            return {
                ...feature,
                id: objectId,
                properties: {
                    ...(feature.properties || {}),
                    id: feature.properties?.id ?? objectId,
                    userdata: {
                        ...(feature.properties?.userdata || {}),
                        ...(item?.data?.userdata || {}),
                        object_id: objectId,
                    },
                },
            };
        }
    } catch (error) {
        console.warn('Unable to convert Paper item to GeoJSON feature for GeoJS display.', error);
    }
    return paperItemBoundsFeature(item, id);
}

function geojsFeatureStyle(row, key, fallback) {
    const props = row.feature.properties || {};
    if (!props.wsvvEmbeddingGrid && !row?.directEmbedding) {
        const override = displayStyleForFeature(row.feature);
        if (override && override[key] != null) return override[key];
    }
    if (key === 'strokeWidth') {
        const logical = props.rescale?.strokeWidth ?? props.strokeWidth
            ?? row.collection.properties?.defaultStyle?.strokeWidth;
        return logical ?? fallback;
    }
    if (key === 'radius') {
        const radius = props.radius ?? row.collection.properties?.defaultStyle?.radius;
        return radius ?? fallback;
    }
    return props[key] ?? row.collection.properties?.defaultStyle?.[key] ?? fallback;
}

function getViewerSize(viewer) {
    const element = viewer?.canvas || viewer?.container || viewer?.element;
    return {
        width: Math.max(1, element?.clientWidth || 1),
        height: Math.max(1, element?.clientHeight || 1),
    };
}

class GeoJSDisplay {
    constructor(annotationToolkit, options = {}) {
        this.toolkit = annotationToolkit;
        this.viewer = annotationToolkit.viewer;
        this.options = {
            ...DEFAULT_DISPLAY_OPTIONS,
            ...(options === true ? { enabled: true } : options),
        };
        this._activePaperItem = null;
        this._animationFrame = null;
        this._viewportUpdateFrame = null;
        this._viewportUpdatePending = false;
        this._isUpdating = false;
        this._paperVisibility = new Map();
        this._featureRows = [];
        this._storeRows = [];
        this._embeddingRows = [];
        this._spatialIndex = null;
        this._paperItems = [];
        this._rowByPaperItem = new Map();
        this._rowById = new Map();
        // null = all features visible. An empty Set would hide every row until the
        // first _refreshVisibleFeatureIds, which left live-session peers blank.
        this._visibleFeatureIds = null;
        this._lastRenderedRowIds = new Set();
        this._storeRowsSignature = '';
        this._unsubscribeStore = null;
        this._viewerHandlers = [];
        this._projectHandlers = [];
        this._domHandlers = [];
        this._renderDataDirty = true;
        this._renderRowsKey = null;
        this._renderDataVersion = 0;
        this._overviewRowsCache = null;
        this._displayTransformVersion = 0;
        this._frameGeometryCache = null;
        this._tiledImageByFileId = new Map();
        this._worldItemCount = -1;
        this._ownsGeoJSMap = false;
        this._ownsGeoJSElement = false;
        this._unsubscribeAuthorColors = subscribeAuthorColors(() => {
            this._renderDataDirty = true;
            this.scheduleUpdate();
        });
        this._selectedEmbeddingIds = new Set();
        this._embeddingSelectionSignature = '';
        this._embeddingGridLineStyle = { hide_unselected: false, strokeOpacity: null, strokeWidth: null };
        this._lastViewportRequestSignature = null;
        this._lastAppliedMapBoundsSignature = null;


        if (!geo || !GeoMap || !geoUtil) {
            throw new Error('geojs_display requires the geojs package to be available.');
        }

        this._createOverlay();
        this._createGeoJSFeatures();
        this._bindEvents();
        this.syncFromStore();
    }

    get enabled() {
        return !this.destroyed;
    }

    destroy() {
        this.destroyed = true;
        this._unsubscribeAuthorColors?.();
        this._unsubscribeAuthorColors = null;
        if (this._animationFrame) {
            (globalThis.cancelAnimationFrame || globalThis.clearTimeout)(this._animationFrame);
        }
        this._animationFrame = null;
        if (this._viewportUpdateFrame) {
            (globalThis.cancelAnimationFrame || globalThis.clearTimeout)(this._viewportUpdateFrame);
        }
        this._viewportUpdateFrame = null;
        this._unsubscribeStore?.();
        this._unsubscribeStore = null;
        this._viewerHandlers.forEach(({ name, handler }) => this.viewer.removeHandler(name, handler));
        this._projectHandlers.forEach(({ name, handler }) => this.toolkit.paperScope.project.off(name, handler));
        this._domHandlers.forEach(({ element, name, handler, options }) => element.removeEventListener(name, handler, options));
        this._restorePaperVisibility();
        if (this._layer && this._map?.deleteLayer) {
            this._map.deleteLayer(this._layer);
        }
        this._layer = null;
        if (this._textLayer && this._map?.deleteLayer) this._map.deleteLayer(this._textLayer);
        this._textLayer = null;
        if (this._ownsGeoJSMap) this._map?.exit?.();
        if (this._ownsGeoJSElement) this.element?.remove();
    }

    setVisible(visible) {
        if (this._usesSharedGeoJSMap) {
            this._layer?.visible?.(Boolean(visible));
            this._textLayer?.visible?.(Boolean(visible));
            this._map?.draw?.();
        } else if (this.element) {
            this.element.style.display = visible ? '' : 'none';
        }
        if (visible) {
            this._hideInactivePaperItems();
            this.scheduleUpdate();
        } else {
            this._restorePaperVisibility();
        }
    }

    syncFromStore({refreshPaperItems = false} = {}) {
        const collections = this.toolkit.dataStore?.state?.featureCollections || [];
        const embedding = collections.find(collection => collection.properties?.wsvvEmbeddingGrid || collection.id === 'wsvv-embedding-grid');
        const embeddingChanged = this._storeEmbeddingCollection !== embedding;
        this._storeEmbeddingCollection = embedding;
        if (embeddingChanged && this.toolkit.dataStore?.reduxEnabled) {
            this._embeddingRows = embedding ? flattenFeatureCollections([embedding]).map(row => ({...row, directEmbedding: true})) : [];
            this.setEmbeddingSelectionState(this._selectedEmbeddingIds || [], embedding?.properties?.gridLineStyle || {}, {fromStore: true});
        }
        const nextStoreRows = flattenFeatureCollections(collections)
            .filter((row) => row.feature?.geometry?.type && row.feature.geometry.coordinates != null)
            .filter((row) => !row.collection?.properties?.wsvvEmbeddingGrid && row.collection?.id !== 'wsvv-embedding-grid');
        const nextSignature = this._storeRowsSignatureForRows(nextStoreRows);
        if (nextSignature === this._storeRowsSignature && !embeddingChanged) {
            // Projection can replace Paper items after Redux listeners have
            // already consumed this version. Reattach without changing store data.
            if (refreshPaperItems) this._refreshFeatureRows();
            debugLog('geojs.display', 'sync-from-store-skipped', {
                storeRows: nextStoreRows.length,
                reason: 'unchanged-store-rows',
            });
            return;
        }
        this._storeRows = nextStoreRows;
        this._storeRowsSignature = nextSignature;
        debugLog('geojs.display', 'sync-from-store', {
            storeRows: this._storeRows.length,
        });
        this._refreshFeatureRows();
    }

    setEmbeddingFeatureCollection(collection) {
        if (this.toolkit.dataStore?.reduxEnabled) {
            if (collection) this.toolkit.dataStore.upsertFeatureCollection(collection, {id: 'wsvv-embedding-grid'}, {source: 'modelOutputRender'});
            else this.toolkit.dataStore.removeFeatureCollection({id: 'wsvv-embedding-grid'}, {source: 'clear_embedding_grid'});
            return;
        }
        this._embeddingRows = collection
            ? flattenFeatureCollections([collection]).map((row) => ({ ...row, directEmbedding: true }))
            : [];
        this._refreshFeatureRows();
    }

    setEmbeddingRows(rows) {
        if (this.toolkit.dataStore?.reduxEnabled) {
            const previous = this._storeEmbeddingCollection;
            const collection = rows?.[0]?.collection || previous || {};
            this.setEmbeddingFeatureCollection({...collection, type: 'FeatureCollection', id: 'wsvv-embedding-grid',
                label: collection.label || 'WSI embedding grid', properties: {...previous?.properties, ...collection.properties,
                    wsvvEmbeddingGrid: true,
                    gridLineStyle: this._embeddingGridLineStyle}, features: (rows || []).map(row => row.feature)});
            return;
        }
        const started = debugNow();
        this._embeddingRows = Array.isArray(rows) ? rows : [];
        debugLog('geojs.display', 'set-embedding-rows', {
            rowCount: this._embeddingRows.length,
        });
        this._refreshFeatureRows();
        debugDuration('geojs.display', 'set-embedding-rows-complete', started, {
            rowCount: this._embeddingRows.length,
            featureRowCount: this._featureRows.length,
        });
        this.paperScope?.project?.emit?.('embedding-rows-changed', {
            rowCount: this._embeddingRows.length,
        });
    }

    getEmbeddingRows() {
        return Array.isArray(this._embeddingRows) ? this._embeddingRows : [];
    }

    clearEmbeddingFeatureCollection() {
        if (this.toolkit.dataStore?.reduxEnabled) {
            this.setEmbeddingFeatureCollection(null);
            return;
        }
        if (!this._embeddingRows.length) return;
        this._embeddingRows = [];
        this._refreshFeatureRows();
        this.paperScope?.project?.emit?.('embedding-rows-changed', {rowCount: 0});
    }

    hasSelectableRows() {
        return this._featureRows.some((row) => this._isSelectableRow(row))
            || this._embeddingRows.some((row) => this._isSelectableRow(row));
    }

    isEmbeddingSelectedId(id) {
        const normalized = normalizeEmbeddingId(id);
        return normalized !== null && this._selectedEmbeddingIds.has(normalized);
    }

    setEmbeddingSelectionState(selectedIds = [], gridLineStyle = {}, {fromStore = false} = {}) {
        const input = selectedIds instanceof Set ? Array.from(selectedIds) : (Array.isArray(selectedIds) ? selectedIds : [selectedIds]);
        const selected = new Set(input.map((id) => normalizeEmbeddingId(id)).filter((id) => id !== null));
        const opacityValue = gridLineStyle?.opacity ?? gridLineStyle?.strokeOpacity;
        const thicknessValue = gridLineStyle?.thickness ?? gridLineStyle?.strokeWidth;
        const opacity = opacityValue == null ? null : finiteNumber(opacityValue, null);
        const thickness = thicknessValue == null ? null : finiteNumber(thicknessValue, null);
        const style = {
            hide_unselected: Boolean(gridLineStyle?.hide_unselected),
            strokeOpacity: opacity,
            strokeWidth: thickness,
        };
        const signature = Array.from(selected).sort().join('|')
            + ':hide=' + String(style.hide_unselected)
            + ':opacity=' + String(style.strokeOpacity)
            + ':width=' + String(style.strokeWidth);
        if (signature === this._embeddingSelectionSignature) return;

        const styleChanged = JSON.stringify(style) !== JSON.stringify(this._embeddingGridLineStyle);
        this._selectedEmbeddingIds = selected;
        this._embeddingGridLineStyle = style;
        this._embeddingSelectionSignature = signature;
        this._refreshVisibleFeatureIds();
        this._markRenderDataDirty();
        this.scheduleUpdate();
        if (!fromStore && styleChanged && this.toolkit.dataStore?.reduxEnabled && this._storeEmbeddingCollection) {
            const collection = this._storeEmbeddingCollection;
            this.toolkit.dataStore.upsertFeatureCollection({...collection, properties: {...collection.properties,
                gridLineStyle: style}}, {id: collection.id}, {source: 'modelOutputStyle'});
        }
        debugLog('geojs.display', 'embedding-selection-state', {
            selectedCount: this._selectedEmbeddingIds.size,
            hideUnselected: this._embeddingGridLineStyle.hide_unselected,
            strokeOpacity: this._embeddingGridLineStyle.strokeOpacity,
            strokeWidth: this._embeddingGridLineStyle.strokeWidth,
            visibleCount: this._visibleFeatureCount(),
        });
    }

    updateEmbeddingRowStyles(updates = []) {
        if (this.toolkit.dataStore?.reduxEnabled && this._storeEmbeddingCollection) {
            const byId = new Map(updates.map(update => [normalizeEmbeddingId(update.id), update]));
            let changed = false;
            const collection = this._storeEmbeddingCollection;
            const features = collection.features.map(feature => {
                const update = byId.get(normalizeEmbeddingId(feature.id));
                if (!update) return feature;
                const {id, ...patch} = update;
                if (!Object.keys(patch).some(key => feature.properties?.[key] !== patch[key])) return feature;
                changed = true;
                return {...feature, properties: {...feature.properties, ...patch}};
            });
            if (changed) this.toolkit.dataStore.upsertFeatureCollection({...collection, features}, {id: collection.id}, {source: 'modelOutputStyle'});
            return;
        }
        const rows = Array.isArray(updates) ? updates : [];
        if (!rows.length || !this._embeddingRows.length) return;
        const updateById = new Map();
        rows.forEach((update) => {
            const id = normalizeEmbeddingId(update?.id);
            if (id !== null) updateById.set(id, update);
        });
        if (!updateById.size) return;

        let changed = 0;
        this._embeddingRows.forEach((row) => {
            const id = normalizeEmbeddingId(row?.id ?? row?.feature?.properties?.embedding_id ?? row?.feature?.properties?.id);
            const update = id !== null ? updateById.get(id) : null;
            const props = update ? row?.feature?.properties : null;
            if (!props) return;
            if (update.strokeColor !== undefined) props.strokeColor = update.strokeColor;
            if (update.strokeOpacity !== undefined) props.strokeOpacity = update.strokeOpacity;
            if (update.strokeWidth !== undefined) props.strokeWidth = update.strokeWidth;
            if (update.selectedColor !== undefined) props.selectedColor = update.selectedColor;
            if (update.group !== undefined) props.group = update.group;
            if (update.label !== undefined) props.label = update.label;
            changed += 1;
        });
        if (!changed) return;

        this._markRenderDataDirty();
        this.scheduleUpdate();
        debugLog('geojs.display', 'embedding-row-styles-updated', {
            requestedRows: rows.length,
            changedRows: changed,
        });
    }

    setEmbeddingPresence(peers = [], ownColor = null) {
        const signature = JSON.stringify([peers, ownColor]);
        if (signature === this._embeddingPresenceSignature) return;
        this._embeddingPresenceSignature = signature;
        this._embeddingOwnColor = ownColor;
        this._peerSelectionColors = new Map();
        for (const peer of peers) for (const id of peer.selectedIds || []) {
            if (!this._peerSelectionColors.has(String(id))) this._peerSelectionColors.set(String(id), peer.color);
        }
        this._refreshVisibleFeatureIds();
        this._markRenderDataDirty();
        this.scheduleUpdate();
    }

    _refreshFeatureRows() {
        const started = debugNow();
        const initialStoreRows = this._storeRows.length;
        const initialEmbeddingRows = this._embeddingRows.length;

        const tiledStarted = debugNow();
        this._refreshTiledImageCache();
        if (this._storeEmbeddingCollection) {
            this._embeddingRows = flattenFeatureCollections([this._storeEmbeddingCollection]).map(row => {
                const props = row.feature.properties || {};
                if (!props.geojsSourceImage || !props.geojsImageBounds) return {...row, directEmbedding: true};
                const {left, top, width, height} = props.geojsImageBounds;
                const first = this._tiledImagePointToImage(row, {x: left, y: top});
                const last = this._tiledImagePointToImage(row, {x: left + width, y: top + height});
                const bounds = {minX: first?.x ?? left, minY: first?.y ?? top,
                    maxX: last?.x ?? left + width, maxY: last?.y ?? top + height};
                return {...row, directEmbedding: true, feature: {...row.feature,
                    geometry: {...row.feature.geometry, coordinates: [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2]},
                    properties: {...props, geojsLayoutBounds: bounds}}, _geojsDisplayCullingBounds: bounds};
            });
        }
        const tiledMs = debugNow() - tiledStarted;

        const rows = this._storeRows.length ? [...this._storeRows, ...this._embeddingRows] : this._embeddingRows;

        const paperStarted = debugNow();
        const paperItems = this._refreshPaperItemCache();
        const paperMs = debugNow() - paperStarted;

        let attachMs = 0;
        if (paperItems.length) {
            const attachStarted = debugNow();
            this._attachPaperItemsToRows(rows, paperItems);
            attachMs = debugNow() - attachStarted;
        }

        const appendStarted = debugNow();
        this._featureRows = paperItems.length && !this.toolkit.dataStore?.reduxEnabled
            ? this._appendLivePaperRows(rows, paperItems) : rows;
        const appendMs = debugNow() - appendStarted;

        const indexStarted = debugNow();
        this._indexFeatureRows();
        const indexMs = debugNow() - indexStarted;

        const spatialStarted = debugNow();
        this._rebuildSpatialIndex();
        const spatialMs = debugNow() - spatialStarted;

        const visibleStarted = debugNow();
        this._refreshVisibleFeatureIds();
        const visibleMs = debugNow() - visibleStarted;

        this._markRenderDataDirty();
        this.scheduleUpdate();
        debugDuration('geojs.display', 'refresh-feature-rows', started, {
            storeRows: initialStoreRows,
            embeddingRows: initialEmbeddingRows,
            featureRows: this._featureRows.length,
            paperItems: paperItems.length,
            visibleMode: this._visibleFeatureIds === null ? 'all' : 'set',
            visibleCount: this._visibleFeatureCount(),
            hasSpatialIndex: Boolean(this._spatialIndex),
            spatialBins: this._spatialIndex?.bins?.size || 0,
            timings: {
                tiledMs: Number(tiledMs.toFixed(2)),
                paperMs: Number(paperMs.toFixed(2)),
                attachMs: Number(attachMs.toFixed(2)),
                appendMs: Number(appendMs.toFixed(2)),
                indexMs: Number(indexMs.toFixed(2)),
                spatialMs: Number(spatialMs.toFixed(2)),
                visibleMs: Number(visibleMs.toFixed(2)),
            },
        });
    }


    enterPaperEdit(row) {
        const paperItem = this._findPaperItem(row) || this._createPaperItemForRow(row);
        if (!paperItem) return null;
        if (this._activePaperItem && this._activePaperItem !== paperItem) {
            this._setPaperItemVisible(this._activePaperItem, false);
            this._activePaperItem.deselect?.(true);
        }
        this._activePaperItem = paperItem;
        this._ensureVisibleFeatureIdSet();
        this._visibleFeatureIds.delete(row.id);
        this._markRenderDataDirty();
        this._setPaperItemVisible(paperItem, true);
        paperItem.select?.();
        this.scheduleUpdate();
        this.toolkit.paperScope.project.emit('geojs-display-edit-started', {
            item: paperItem,
            feature: row.feature,
            featureIndex: row.featureIndex,
            globalFeatureIndex: row.globalFeatureIndex,
            collectionIndex: row.collectionIndex,
        });
        return paperItem;
    }

    finishPaperEdit() {
        if (!this._activePaperItem) return;
        const item = this._activePaperItem;
        this._activePaperItem = null;
        this._setPaperItemVisible(item, false);
        this.syncFromStore();
        this.toolkit.paperScope.project.emit('geojs-display-edit-finished', { item });
    }

    scheduleUpdate() {
        if (this._animationFrame || this.destroyed) return;
        const schedule = globalThis.requestAnimationFrame || globalThis.setTimeout;
        this._animationFrame = schedule(() => {
            this._animationFrame = null;
            this.update();
        }, 0);
    }

    requestViewportUpdate({ force = false } = {}) {
        if (this.destroyed) return;
        const viewportSignature = this._viewportSignature();
        if (!force && viewportSignature && viewportSignature === this._lastViewportRequestSignature && !this._renderDataDirty) {
            return;
        }
        this._lastViewportRequestSignature = viewportSignature;
        if (this._usesDisplayCoordinates()) {
            this._markRenderGeometryDirty();
        }
        // Applying one remote camera requires zoom + pan (+ rotation) calls.
        // Draw their final state once, rather than each intermediate camera.
        if (this.viewer.__slideSessionApplyingViewport || !this.options.immediateViewportUpdates) {
            this.scheduleUpdate();
            return;
        }
        if (force) {
            if (this._viewportUpdateFrame) {
                (globalThis.cancelAnimationFrame || globalThis.clearTimeout)(this._viewportUpdateFrame);
                this._viewportUpdateFrame = null;
            }
            this._viewportUpdatePending = false;
            this.update();
            return;
        }
        if (this._viewportUpdateFrame) {
            this._viewportUpdatePending = true;
            return;
        }

        this.update();
        const schedule = globalThis.requestAnimationFrame || globalThis.setTimeout;
        this._viewportUpdateFrame = schedule(() => {
            this._viewportUpdateFrame = null;
            if (this._viewportUpdatePending) {
                this._viewportUpdatePending = false;
                this.requestViewportUpdate();
            }
        }, 0);
    }

    update() {
        if (this.destroyed || this._isUpdating) return;
        const debugStarted = debugNow();
        const debugEnabled = isDebugEnabled('geojs.display');
        this._isUpdating = true;
        try {
        if (this._layoutCoordinateGeneration !== 1) {
            this._layoutCoordinateGeneration = 1;
            this._markRenderDataDirty();
            this._featureRows.forEach((row) => {
                if (!row?.feature?.properties?.geojsLayoutBounds) {
                    row._geojsCullingSpace = null;
                    row._geojsDisplayCullingBounds = undefined;
                }
            });
            this._rebuildSpatialIndex();
        }
        const { width, height } = getViewerSize(this.viewer);
        const contentSize = this._mapContentSize(width, height);
        if (this._width !== width || this._height !== height) {
            this._width = width;
            this._height = height;
            this.element.style.width = `${width}px`;
            this.element.style.height = `${height}px`;
            this._map.size?.({ width, height });
        }
        if (this._mapContentWidth !== contentSize.width || this._mapContentHeight !== contentSize.height) {
            this._mapContentWidth = contentSize.width;
            this._mapContentHeight = contentSize.height;
            if (!this._usesSharedGeoJSMap) {
                this._map.maxBounds?.({
                    left: 0,
                    top: 0,
                    right: contentSize.width,
                    bottom: contentSize.height,
                });
            }
            this._markRenderDataDirty();
            debugLog('geojs.display', 'map-content-size-updated', {
                ...contentSize,
                sharedGeoMap: Boolean(this._usesSharedGeoJSMap),
            });
        }

        this._syncMapViewport(width, height);
        if (this._spatialIndex && this._spatialIndexSpace !== 'layout-annotations') {
            this._rebuildSpatialIndex();
        }
        this._beginDisplayFrame();

        const mapBoundsFlat = summarizeBounds(this._lastMapBounds);
        debugLog('geojs.display', 'update-start', {
            totalRows: this._featureRows.length,
            visibleIds: this._visibleFeatureCount(),
            hasSpatialIndex: Boolean(this._spatialIndex),
            mapBounds: this._lastMapBounds || null,
            mapBoundsFlat,
            mapMinX: mapBoundsFlat?.minX ?? null,
            mapMinY: mapBoundsFlat?.minY ?? null,
            mapMaxX: mapBoundsFlat?.maxX ?? null,
            mapMaxY: mapBoundsFlat?.maxY ?? null,
            mapWidth: mapBoundsFlat?.width ?? null,
            mapHeight: mapBoundsFlat?.height ?? null,
            contentWidth: this._mapContentWidth,
            contentHeight: this._mapContentHeight,
            layoutScaleBase: this._layoutScaleBase(),
            coordinateMode: this.options.coordinateMode,
            renderEmbeddingBoundaries: Boolean(this.options.renderEmbeddingBoundaries),
            renderer: this.options.renderer,
        });
        const candidateRows = this._spatialIndex && !this._usesDisplayCoordinates()
            ? this._featureRows
            : this._featureRows.filter((row) => this._isFeatureIdVisible(row.id));
        const overviewBeforeCull = this._shouldUseOverviewRender(candidateRows);
        const cullStarted = debugNow();
        const rows = overviewBeforeCull ? candidateRows : this._visibleRowsForRender(candidateRows);
        const cullMs = debugNow() - cullStarted;
        const prepareStarted = debugNow();
        const renderPreparation = this._prepareRowsForGeoJSRender(rows, { forceOverview: overviewBeforeCull });
        const rowsForGeoJS = renderPreparation.rows;
        const prepareMs = debugNow() - prepareStarted;
        if (rows !== this._lastRenderedRows) {
            this._lastRenderedRows = rows;
            this._lastRenderedRowIds = new Set(rows.map((row) => row.id));
        }
        debugLog('geojs.display', 'update-rows-prepared', {
            candidateRows: candidateRows.length,
            visibleRows: rows.length,
            geojsRows: rowsForGeoJS.length,
            renderMode: renderPreparation.mode,
            overviewBeforeCull,
            aggregatedRows: renderPreparation.aggregatedRows || 0,
            aggregatedSourceRows: renderPreparation.aggregatedSourceRows || 0,
            selectedRows: this._selectedEmbeddingIds?.size || 0,
            selectedRowsInRender: debugEnabled ? rows.reduce((count, row) => count + (this._rowIsSelected(row) ? 1 : 0), 0) : null,
            cullMs: Number(cullMs.toFixed(2)),
            prepareMs: Number(prepareMs.toFixed(2)),
        });
        if (typeof window !== 'undefined' && window.__WSVV_DEBUG_GEOJS) {
            window.__WSVV_LAST_GEOJS_RENDER = {
                totalRows: this._featureRows.length,
                candidateRows: candidateRows.length,
                renderedRows: rows.length,
                geojsRows: rowsForGeoJS.length,
                renderMode: renderPreparation.mode,
                overviewBeforeCull,
                visibleIds: this._visibleFeatureCount(),
                hasSpatialIndex: Boolean(this._spatialIndex),
                mapBounds: this._lastMapBounds || null,
            };
        }
        const rowsKey = this._renderRowsSignature(rowsForGeoJS);
        let geojsRowsTiming = null;
        let rebuiltGeojsData = false;
        if (this._renderDataDirty || rowsKey !== this._renderRowsKey) {
            rebuiltGeojsData = true;
            const geojsTimingStarted = debugNow();
            debugLog('geojs.display', 'update-build-feature-data-start', {
                visibleRows: rows.length,
                geojsRows: rowsForGeoJS.length,
                renderMode: renderPreparation.mode,
            });
            const pointStarted = debugNow();
            const pointRows = this._pointRows(rowsForGeoJS);
            const pointRowsMs = debugNow() - pointStarted;
            const pointBoundsFlat = debugEnabled ? this._pointRowsBounds(pointRows) : null;
            debugLog('geojs.display', 'update-point-rows-built', {
                pointRows: pointRows.length,
                durationMs: Number(pointRowsMs.toFixed(2)),
                pointBoundsFlat,
                pointMinX: pointBoundsFlat?.minX ?? null,
                pointMinY: pointBoundsFlat?.minY ?? null,
                pointMaxX: pointBoundsFlat?.maxX ?? null,
                pointMaxY: pointBoundsFlat?.maxY ?? null,
                pointWidth: pointBoundsFlat?.width ?? null,
                pointHeight: pointBoundsFlat?.height ?? null,
                firstPointX: finiteNumber(pointRows[0]?.position?.x, null),
                firstPointY: finiteNumber(pointRows[0]?.position?.y, null),
            });
            const lineStarted = debugNow();
            const lineRows = this._lineRows(rowsForGeoJS);
            const lineRowsMs = debugNow() - lineStarted;
            debugLog('geojs.display', 'update-line-rows-built', {
                lineRows: lineRows.length,
                durationMs: Number(lineRowsMs.toFixed(2)),
            });
            const polygonStarted = debugNow();
            const polygonRows = this._polygonRows(rowsForGeoJS);
            const polygonRowsMs = debugNow() - polygonStarted;
            debugLog('geojs.display', 'update-polygon-rows-built', {
                polygonRows: polygonRows.length,
                durationMs: Number(polygonRowsMs.toFixed(2)),
            });
            const dataStarted = debugNow();
            debugLog('geojs.display', 'update-feature-data-start', {
                pointRows: pointRows.length,
                lineRows: lineRows.length,
                polygonRows: polygonRows.length,
            });
            const pointDataStarted = debugNow();
            this._pointFeature.data(pointRows);
            const pointDataMs = debugNow() - pointDataStarted;
            const lineDataStarted = debugNow();
            this._lineFeature.data(lineRows);
            const lineDataMs = debugNow() - lineDataStarted;
            const polygonDataStarted = debugNow();
            this._polygonFeature.data(polygonRows);
            this._textFeature?.data(this._textRows(rowsForGeoJS));
            const polygonDataMs = debugNow() - polygonDataStarted;
            const dataMs = debugNow() - dataStarted;
            debugLog('geojs.display', 'update-feature-data-complete', {
                pointDataMs: Number(pointDataMs.toFixed(2)),
                lineDataMs: Number(lineDataMs.toFixed(2)),
                polygonDataMs: Number(polygonDataMs.toFixed(2)),
                durationMs: Number(dataMs.toFixed(2)),
            });
            geojsRowsTiming = {
                pointRows: pointRows.length,
                lineRows: lineRows.length,
                polygonRows: polygonRows.length,
                pointRowsMs: Number(pointRowsMs.toFixed(2)),
                lineRowsMs: Number(lineRowsMs.toFixed(2)),
                polygonRowsMs: Number(polygonRowsMs.toFixed(2)),
                dataMs: Number(dataMs.toFixed(2)),
                pointDataMs: Number(pointDataMs.toFixed(2)),
                lineDataMs: Number(lineDataMs.toFixed(2)),
                polygonDataMs: Number(polygonDataMs.toFixed(2)),
                totalMs: Number((debugNow() - geojsTimingStarted).toFixed(2)),
            };
            this._renderRowsKey = rowsKey;
            this._renderDataDirty = false;
        }
        const drawStarted = debugNow();
        debugLog('geojs.display', 'update-draw-start', {
            rebuiltGeojsData,
            geojsRows: rowsForGeoJS.length,
            renderMode: renderPreparation.mode,
        });
        this._map.draw();
        // GeoJS may recreate layer canvases on draw; keep Paper above the tile stack.
        this._raisePaperOverlaysAboveGeoJS();
        const drawMs = debugNow() - drawStarted;
        const paperVisibilityStarted = debugNow();
        this._syncPaperVisibilityForSelection();
        const paperVisibilityMs = debugNow() - paperVisibilityStarted;
        debugDuration("geojs.display", "update", debugStarted, {
            totalRows: this._featureRows.length,
            candidateRows: candidateRows.length,
            renderedRows: rows.length,
                geojsRows: rowsForGeoJS.length,
                renderMode: renderPreparation.mode,
            visibleIds: this._visibleFeatureCount(),
            hasSpatialIndex: Boolean(this._spatialIndex),
            rebuiltGeojsData,
            geojsRowsTiming,
            cullMs: Number(cullMs.toFixed(2)),
            prepareMs: Number(prepareMs.toFixed(2)),
            aggregatedRows: renderPreparation.aggregatedRows || 0,
            aggregatedSourceRows: renderPreparation.aggregatedSourceRows || 0,
            drawMs: Number(drawMs.toFixed(2)),
            paperVisibilityMs: Number(paperVisibilityMs.toFixed(2)),
        });
        } finally {
            this._frameGeometryCache = null;
            this._isUpdating = false;
        }
    }

    _createOverlay() {
        const { width, height } = getViewerSize(this.viewer);
        const contentSize = this._mapContentSize(width, height);
        this._width = width;
        this._height = height;
        this._mapContentWidth = contentSize.width;
        this._mapContentHeight = contentSize.height;

        if (this.viewer?.geoMap) {
            this._usesSharedGeoJSMap = true;
            this._map = this.viewer.geoMap;
            this.element = this.viewer.geoNode || this.viewer.drawer?.canvas || this.viewer.canvas;
            debugLog('geojs.display', 'overlay-created', {
                renderer: this.options.renderer,
                width,
                height,
                contentWidth: contentSize.width,
                contentHeight: contentSize.height,
                sharedGeoMap: true,
                parentClassName: this.element?.parentElement?.className || null,
            });
            this._raisePaperOverlaysAboveGeoJS();
            this._layer = this._map.createLayer('feature', {
                renderer: this._annotationFeatureRenderer(),
                autoshareRenderer: false,
                features: ['point', 'line', 'polygon'],
                zIndex: 100,
            });
            return;
        }

        this._ownsGeoJSMap = true;
        this._ownsGeoJSElement = true;
        this.element = document.createElement('div');
        this.element.className = 'geojs-display-overlay';
        if (this.viewer?.canvas && globalThis.getComputedStyle?.(this.viewer.canvas)?.position === 'static') {
            this.viewer.canvas.style.position = 'relative';
        }
        Object.assign(this.element.style, {
            position: 'absolute',
            left: '0',
            top: '0',
            width: `${width}px`,
            height: `${height}px`,
            pointerEvents: 'none',
            zIndex: GEOJS_DISPLAY_Z_INDEX,
            opacity: '1',
        });
        this.viewer.canvas.appendChild(this.element);
        debugLog('geojs.display', 'overlay-created', {
            renderer: this.options.renderer,
            width,
            height,
            contentWidth: contentSize.width,
            contentHeight: contentSize.height,
            zIndex: GEOJS_DISPLAY_Z_INDEX,
            sharedGeoMap: false,
            parentClassName: this.element.parentElement?.className || null,
        });
        this._raisePaperOverlaysAboveGeoJS();

        const params = geoUtil.pixelCoordinateParams(this.element, contentSize.width, contentSize.height);
        this._map = GeoMap({
            ...params.map,
            node: this.element,
            interactor: null,
            clampBoundsX: false,
            clampBoundsY: false,
            clampZoom: false,
            zoom: 0,
            center: { x: contentSize.width / 2, y: contentSize.height / 2 },
        });
        this._layer = this._map.createLayer('feature', {
            renderer: this._annotationFeatureRenderer(),
            autoshareRenderer: false,
            features: ['point', 'line', 'polygon'],
        });
    }

    _raisePaperOverlaysAboveGeoJS() {
        const host = this.viewer?.canvas;
        const overlays = this.viewer?.PaperOverlays || [];
        if (!host) return;
        overlays.forEach((overlay) => {
            if (!overlay?._canvasdiv) return;
            const node = overlay._canvasdiv;
            node.style.position = 'absolute';
            node.style.left = '0';
            node.style.top = '0';
            node.style.right = '0';
            node.style.bottom = '0';
            node.style.width = '100%';
            node.style.height = '100%';
            // Sit above GeoJS tile/feature canvases (zIndex 100 within the map node).
            node.style.zIndex = '200';
            const pointerEvents = this.viewer?.isMouseNavEnabled?.() ? 'none' : 'auto';
            node.style.pointerEvents = pointerEvents;
            if (overlay._canvas) {
                overlay._canvas.style.display = 'block';
                overlay._canvas.style.pointerEvents = pointerEvents;
            }
            host.appendChild(node);
        });
    }

    _annotationFeatureRenderer() {
        // WebGL feature layers are unreliable on some mobile browsers; canvas keeps
        // strokes visible alongside the shared tile map.
        try {
            if (typeof window !== 'undefined') {
                if (window.matchMedia?.('(pointer: coarse)').matches) return 'canvas';
                if (navigator.maxTouchPoints > 0 && window.matchMedia?.('(max-width: 900px)').matches) {
                    return 'canvas';
                }
            }
        } catch {
            // Fall through to the configured renderer.
        }
        return this.options.renderer || 'webgl';
    }

    _createGeoJSFeatures() {
        this._pointFeature = this._layer.createFeature('point', { selectionAPI: false })
            .position((d) => d.position)
            .style({
                radius: featureStyleValue('radius', this.options.pointRadius),
                fillColor: featureStyleValue('fillColor', colorToGeoJS('#3b82f6', '#3b82f6')),
                fillOpacity: featureStyleValue('fillOpacity', this.options.fillOpacity),
                strokeColor: featureStyleValue('strokeColor', colorToGeoJS('#1f2937', '#1f2937')),
                strokeOpacity: featureStyleValue('strokeOpacity', this.options.strokeOpacity),
                strokeWidth: featureStyleValue('strokeWidth', this.options.lineWidth),
            });
        this._lineFeature = this._layer.createFeature('line', { selectionAPI: false })
            .line((d) => d.line)
            .style({
                strokeColor: featureStyleValue('strokeColor', colorToGeoJS('#1f2937', '#1f2937')),
                strokeOpacity: featureStyleValue('strokeOpacity', this.options.strokeOpacity),
                strokeWidth: featureStyleValue('strokeWidth', this.options.lineWidth),
                uniformLine: true,
            });
        this._polygonFeature = this._layer.createFeature('polygon', { selectionAPI: false })
            .polygon((d) => ({ outer: d.outer, inner: d.inner }))
            .style({
                fill: true,
                fillColor: featureStyleValue('fillColor', colorToGeoJS('#3b82f6', '#3b82f6')),
                fillOpacity: featureStyleValue('fillOpacity', this.options.fillOpacity),
                stroke: true,
                strokeColor: featureStyleValue('strokeColor', colorToGeoJS('#1f2937', '#1f2937')),
                strokeOpacity: featureStyleValue('strokeOpacity', this.options.strokeOpacity),
                strokeWidth: featureStyleValue('strokeWidth', this.options.lineWidth),
                uniformPolygon: true,
            });

        // GeoJS text uses its canvas renderer; keep polygons/points on WebGL.
        // Both layers share the map and the same image/display coordinates.
        this._textLayer = this._map.createLayer('feature', {renderer: 'canvas', features: ['text'], zIndex: 101});
        this._textFeature = this._textLayer.createFeature('text', {selectionAPI: false})
            .position(d => d.position)
            .text(d => d.text)
            .style({font: d => `${d.fontSize}px ${d.fontFamily}`, color: d => d.strokeColor,
                textOpacity: d => d.strokeOpacity, textAlign: 'left', textBaseline: 'alphabetic',
                offset: d => this._pointTextOffset(d.sourceRow),
                rotation: () => this.viewer.isGeoJSTileViewer ? -Number(this.viewer._viewportRotation || 0) * Math.PI / 180 : 0,
                textScaled: false, rotateWithMap: false, textStrokeWidth: 0});

        if (this.options.editOn === 'click') this._bindClickHitTesting();
    }

    _bindEvents() {
        this._unsubscribeStore = this.toolkit.dataStore.subscribe(() => this.syncFromStore());
        const viewportChangeHandler = () => this.requestViewportUpdate();
        this.viewer.addHandler('viewport-change', viewportChangeHandler);
        this._viewerHandlers.push({ name: 'viewport-change', handler: viewportChangeHandler });
        ['animation', 'animation-finish', 'resize', 'rotate', 'flip'].forEach((name) => {
            const handler = () => {
                if (name === 'resize') {
                    // Pixel size changed even when image bounds did not.
                    this._markRenderGeometryDirty();
                    this.requestViewportUpdate({force: true});
                    this._raisePaperOverlaysAboveGeoJS();
                    return;
                }
                this.requestViewportUpdate();
            };
            this.viewer.addHandler(name, handler);
            this._viewerHandlers.push({ name, handler });
        });
        ['item-updated', 'item-removed', 'items-changed'].forEach((name) => {
            const handler = () => this.syncFromStore();
            this.toolkit.paperScope.project.on(name, handler);
            this._projectHandlers.push({ name, handler });
        });
        ['item-selected', 'item-deselected'].forEach((name) => {
            const handler = (event) => this._syncPaperSelectionState(event?.item);
            this.toolkit.paperScope.project.on(name, handler);
            this._projectHandlers.push({ name, handler });
        });
    }

    _bindClickHitTesting() {
        const handler = (event) => {
            if (!this.options.enableNonSelectionPaperEdit || this._activeToolUsesGeoJSSelection()) return;
            const row = this.hitTestRowAtEvent(event);
            if (!row) return;
            event.preventDefault();
            event.stopPropagation();
            this.enterPaperEdit(row);
        };
        const options = { capture: true };
        this.viewer.canvas.addEventListener('click', handler, options);
        this._domHandlers.push({ element: this.viewer.canvas, name: 'click', handler, options });
    }

    hitTestRowAtEvent(event) {
        return this.hitTestRowsAtEvent(event)[0] || null;
    }

    hitTestRowsAtEvent(event) {
        const nativeEvent = event?.event || event?.original?.nativeEvent || event;
        if (!nativeEvent || nativeEvent.clientX == null || nativeEvent.clientY == null) return [];
        const display = typeof this.viewer?.clientToCanvasLocal === 'function'
            ? this.viewer.clientToCanvasLocal(nativeEvent)
            : (() => {
                const rect = this.viewer.canvas.getBoundingClientRect();
                return {
                    x: nativeEvent.clientX - rect.left,
                    y: nativeEvent.clientY - rect.top,
                };
            })();
        return this.hitTestRowsAtDisplayPoint(display);
    }

    hitTestRowsAtDisplayPoint(display, tolerance = this.options.hitTolerance) {
        this._beginHitTestDisplayFrame('point');
        const pointTolerance = finiteNumber(tolerance, 6);
        const rows = this._featureRows.filter((row) => this._isFeatureIdVisible(row.id));
        return this._rowsAtDisplayPoint(rows, display, pointTolerance);
    }

    hitTestRowsAtProjectPoint(point, tolerance = this.options.hitTolerance) {
        if (!point) return [];
        return this.hitTestRowsAtDisplayPoint(this._projectPointToDisplay(point), tolerance);
    }

    hitTestPaperItemsAtEvent(event) {
        return this.hitTestRowsAtEvent(event)
            .filter((row) => !row?.directEmbedding || row.paperItem)
            .map((row) => this.getPaperItemForRow(row, { create: false }))
            .filter(Boolean);
    }

    hitTestPaperItemsAtProjectPoint(point, tolerance = this.options.hitTolerance) {
        if (!point) return [];
        return this.hitTestRowsAtProjectPoint(point, tolerance)
            .filter((row) => !row?.directEmbedding || row.paperItem)
            .map((row) => this.getPaperItemForRow(row, { create: false }))
            .filter(Boolean);
    }

    getPaperItemForRow(row, { create = false } = {}) {
        const existing = this._findPaperItem(row);
        if (existing || !create) return existing || null;
        return this._createPaperItemForRow(row);
    }

    findPaperItemsInImageRectangle(pointA, pointB, onlyFullyContained = false) {
        const rect = {
            minX: Math.min(pointA.x, pointB.x),
            minY: Math.min(pointA.y, pointB.y),
            maxX: Math.max(pointA.x, pointB.x),
            maxY: Math.max(pointA.y, pointB.y),
        };
        const items = [];
        const seen = new Set();
        this._featureRows.forEach((row) => {
            const bounds = this._rowImageBounds(row);
            if (!bounds || !this._boundsMatchRectangle(bounds, rect, onlyFullyContained)) return;
            const item = this.getPaperItemForRow(row, { create: false });
            if (!item || seen.has(item)) return;
            items.push(item);
            seen.add(item);
        });
        return items;
    }

    findPaperItemsInProjectRectangle(pointA, pointB, onlyFullyContained = false) {
        return this.findPaperItemsInDisplayRectangle(
            this._projectPointToDisplay(pointA),
            this._projectPointToDisplay(pointB),
            onlyFullyContained,
        );
    }

    findRowsInProjectRectangle(pointA, pointB, onlyFullyContained = false) {
        return this.findRowsInDisplayRectangle(
            this._projectPointToDisplay(pointA),
            this._projectPointToDisplay(pointB),
            onlyFullyContained,
        );
    }

    findRowsInProjectRectangleByCenter(pointA, pointB) {
        return this.findRowsInDisplayRectangleByCenter(
            this._projectPointToDisplay(pointA),
            this._projectPointToDisplay(pointB),
        );
    }

    findRowsInDisplayRectangle(pointA, pointB, onlyFullyContained = false) {
        this._beginHitTestDisplayFrame('rectangle');
        const rect = this._displayRectangleFromPoints(pointA, pointB);
        return this._featureRows
            .filter((row) => this._isFeatureIdVisible(row.id))
            .filter((row) => {
                const bounds = this._rowDisplayBounds(row);
                return bounds && this._boundsMatchRectangle(bounds, rect, onlyFullyContained);
            });
    }

    findRowsInDisplayRectangleByCenter(pointA, pointB) {
        this._beginHitTestDisplayFrame('rectangle-center');
        const rect = this._displayRectangleFromPoints(pointA, pointB);
        return this._featureRows
            .filter((row) => this._isFeatureIdVisible(row.id))
            .filter((row) => {
                const bounds = this._rowDisplayBounds(row);
                if (!bounds) return false;
                const center = {
                    x: (bounds.minX + bounds.maxX) / 2,
                    y: (bounds.minY + bounds.maxY) / 2,
                };
                return this._displayBoundsContainPoint(rect, center, 0);
            });
    }

    findDirectEmbeddingRowsInDisplayRectangle(pointA, pointB, onlyFullyContained = false) {
        this._beginHitTestDisplayFrame('direct-embedding-rectangle');
        const mapRect = this._mapRectangleFromDisplayPoints(pointA, pointB);
        if (!mapRect) {
            const fallbackRows = this.findRowsInDisplayRectangle(pointA, pointB, onlyFullyContained)
                .filter((row) => row?.directEmbedding && !row?.directEmbeddingOverview);
            debugLogJson('geojs.selection', 'direct-map-rectangle-hit-test', {
                mode: onlyFullyContained ? 'contained' : 'overlap',
                fallback: 'display-rectangle',
                rowCount: fallbackRows.length,
                ...this._selectionRectangleLogDetails(pointA, pointB),
                rowSamplesJson: JSON.stringify(this._selectionRowSamples(fallbackRows)),
                fileCountsJson: JSON.stringify(this._selectionFileCounts(fallbackRows)),
            });
            return fallbackRows;
        }
        const query = this._rowsInMapRectangleResult(mapRect, onlyFullyContained);
        const rows = query.rows.filter((row) => row?.directEmbedding && !row?.directEmbeddingOverview);
        debugLogJson('geojs.selection', 'direct-map-rectangle-hit-test', {
            mode: onlyFullyContained ? 'contained' : 'overlap',
            rowCount: rows.length,
            querySource: query.source,
            querySourceRowCount: query.sourceRowCount,
            queryVisibleRowCount: query.visibleRowCount,
            queryMatchedRowCount: query.rows.length,
            queryDirectMatchedRowCount: rows.length,
            firstId: rows[0]?.id ?? null,
            lastId: rows[rows.length - 1]?.id ?? null,
            ...this._selectionRectangleLogDetails(pointA, pointB),
            rowSamplesJson: JSON.stringify(this._selectionRowSamples(rows)),
            fileCountsJson: JSON.stringify(this._selectionFileCounts(rows)),
        });
        return rows;
    }

    findDirectEmbeddingRowsInDisplayPolygon(points) {
        this._beginHitTestDisplayFrame('direct-embedding-polygon');
        const polygon = (points || [])
            .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
            .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
        if (polygon.length < 3) return [];
        const bounds = polygon.reduce((acc, point) => ({
            minX: Math.min(acc.minX, point.x),
            minY: Math.min(acc.minY, point.y),
            maxX: Math.max(acc.maxX, point.x),
            maxY: Math.max(acc.maxY, point.y),
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        const candidates = this.findDirectEmbeddingRowsInDisplayRectangle(
            { x: bounds.minX, y: bounds.minY },
            { x: bounds.maxX, y: bounds.maxY },
            false,
        );
        const rows = candidates.filter((row) => {
            const rowBounds = this._rowDisplayBounds(row);
            if (!rowBounds) return false;
            return this._displayPolygonContainsPoint(polygon, {
                x: (rowBounds.minX + rowBounds.maxX) / 2,
                y: (rowBounds.minY + rowBounds.maxY) / 2,
            });
        });
        debugLogJson('geojs.selection', 'direct-polygon-hit-test', {
            mode: 'center',
            pointCount: polygon.length,
            candidateCount: candidates.length,
            rowCount: rows.length,
            firstId: rows[0]?.id ?? null,
            lastId: rows[rows.length - 1]?.id ?? null,
            bounds,
            rowSamplesJson: JSON.stringify(this._selectionRowSamples(rows)),
            fileCountsJson: JSON.stringify(this._selectionFileCounts(rows)),
        });
        return rows;
    }

    _displayPolygonContainsPoint(polygon, point) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
            const xi = polygon[i].x;
            const yi = polygon[i].y;
            const xj = polygon[j].x;
            const yj = polygon[j].y;
            const intersects = ((yi > point.y) !== (yj > point.y))
                && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    findDirectEmbeddingRowsInDisplayRectangleByCenter(pointA, pointB) {
        this._beginHitTestDisplayFrame('direct-embedding-rectangle-center');
        const mapRect = this._mapRectangleFromDisplayPoints(pointA, pointB);
        if (!mapRect) {
            const fallbackRows = this.findRowsInDisplayRectangleByCenter(pointA, pointB)
                .filter((row) => row?.directEmbedding && !row?.directEmbeddingOverview);
            debugLogJson('geojs.selection', 'direct-map-rectangle-hit-test', {
                mode: 'center',
                fallback: 'display-rectangle-center',
                rowCount: fallbackRows.length,
                ...this._selectionRectangleLogDetails(pointA, pointB),
                rowSamplesJson: JSON.stringify(this._selectionRowSamples(fallbackRows)),
                fileCountsJson: JSON.stringify(this._selectionFileCounts(fallbackRows)),
            });
            return fallbackRows;
        }
        const query = this._rowsInMapRectangleResult(mapRect, false);
        const rows = query.rows
            .filter((row) => row?.directEmbedding && !row?.directEmbeddingOverview)
            .filter((row) => {
                const bounds = this._rowCullingBounds(row);
                if (!bounds) return false;
                const center = {
                    x: (bounds.minX + bounds.maxX) / 2,
                    y: (bounds.minY + bounds.maxY) / 2,
                };
                return this._displayBoundsContainPoint(mapRect, center, 0);
            });
        debugLogJson('geojs.selection', 'direct-map-rectangle-hit-test', {
            mode: 'center',
            rowCount: rows.length,
            querySource: query.source,
            querySourceRowCount: query.sourceRowCount,
            queryVisibleRowCount: query.visibleRowCount,
            queryMatchedRowCount: query.rows.length,
            queryDirectMatchedRowCount: rows.length,
            firstId: rows[0]?.id ?? null,
            lastId: rows[rows.length - 1]?.id ?? null,
            ...this._selectionRectangleLogDetails(pointA, pointB),
            rowSamplesJson: JSON.stringify(this._selectionRowSamples(rows)),
            fileCountsJson: JSON.stringify(this._selectionFileCounts(rows)),
        });
        return rows;
    }

    findPaperItemsInDisplayRectangle(pointA, pointB, onlyFullyContained = false) {
        this._beginHitTestDisplayFrame('paper-rectangle');
        const rect = {
            minX: Math.min(pointA.x, pointB.x),
            minY: Math.min(pointA.y, pointB.y),
            maxX: Math.max(pointA.x, pointB.x),
            maxY: Math.max(pointA.y, pointB.y),
        };
        const items = [];
        const seen = new Set();
        this._featureRows
            .filter((row) => this._isFeatureIdVisible(row.id))
            .forEach((row) => {
                const bounds = this._rowDisplayBounds(row);
                if (!bounds || !this._boundsMatchRectangle(bounds, rect, onlyFullyContained)) return;
                const item = this.getPaperItemForRow(row, { create: false });
                if (!item || seen.has(item)) return;
                items.push(item);
                seen.add(item);
            });
        return items;
    }

    _rowsAtDisplayPoint(rows, point, tolerance) {
        const matches = [];
        rows.forEach((row) => {
            const bounds = this._rowDisplayBounds(row);
            if (!bounds || !this._displayBoundsContainPoint(bounds, point, tolerance)) return;
            matches.push({ row, area: Math.max(1, (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)) });
        });
        return matches
            .sort((a, b) => a.area - b.area)
            .map((match) => match.row);
    }

    _displayRectangleFromPoints(pointA, pointB) {
        return {
            minX: Math.min(pointA.x, pointB.x),
            minY: Math.min(pointA.y, pointB.y),
            maxX: Math.max(pointA.x, pointB.x),
            maxY: Math.max(pointA.y, pointB.y),
        };
    }

    _debugPoint(point) {
        if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return null;
        return {
            x: Number(Number(point.x).toFixed(2)),
            y: Number(Number(point.y).toFixed(2)),
        };
    }

    _debugBounds(prefix, bounds) {
        const flat = summarizeBounds(bounds);
        return {
            [prefix + 'MinX']: flat?.minX ?? null,
            [prefix + 'MinY']: flat?.minY ?? null,
            [prefix + 'MaxX']: flat?.maxX ?? null,
            [prefix + 'MaxY']: flat?.maxY ?? null,
            [prefix + 'Width']: flat?.width ?? null,
            [prefix + 'Height']: flat?.height ?? null,
        };
    }

    _boundsFromPoints(points) {
        const validPoints = (points || []).filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
        if (!validPoints.length) return null;
        return validPoints.reduce((bounds, point) => ({
            minX: Math.min(bounds.minX, point.x),
            minY: Math.min(bounds.minY, point.y),
            maxX: Math.max(bounds.maxX, point.x),
            maxY: Math.max(bounds.maxY, point.y),
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    }

    _selectionRectangleCoordinateDiagnostics(pointA, pointB) {
        if (!pointA || !pointB || !this._map?.displayToGcs) return null;
        const displayRect = this._displayRectangleFromPoints(pointA, pointB);
        const displayCorners = [
            { x: displayRect.minX, y: displayRect.minY },
            { x: displayRect.maxX, y: displayRect.minY },
            { x: displayRect.maxX, y: displayRect.maxY },
            { x: displayRect.minX, y: displayRect.maxY },
        ];
        const mapCorners = displayCorners
            .map((point) => this._map.displayToGcs(point))
            .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
        const interfaceCorners = displayCorners
            .map((point) => this._map.displayToGcs(point))
            .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
        const roundTripCorners = mapCorners
            .map((point) => this._map.gcsToDisplay?.(point))
            .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
        const mapRect = this._boundsFromPoints(mapCorners);
        const interfaceMapRect = this._boundsFromPoints(interfaceCorners);
        return {
            displayRect,
            mapRect,
            interfaceMapRect,
            displayCorners,
            mapCorners,
            interfaceCorners,
            roundTripCorners,
            mapYDirection: mapCorners.length >= 4 ? Number((mapCorners[2].y - mapCorners[0].y).toFixed(2)) : null,
            interfaceYDirection: interfaceCorners.length >= 4 ? Number((interfaceCorners[2].y - interfaceCorners[0].y).toFixed(2)) : null,
        };
    }

    _selectionRectangleLogDetails(pointA, pointB) {
        const diagnostics = this._selectionRectangleCoordinateDiagnostics(pointA, pointB);
        if (!diagnostics) return { coordinateDiagnosticsAvailable: false };
        return {
            coordinateDiagnosticsAvailable: true,
            ...this._debugBounds('display', diagnostics.displayRect),
            ...this._debugBounds('map', diagnostics.mapRect),
            ...this._debugBounds('interfaceMap', diagnostics.interfaceMapRect),
            ...this._debugBounds('viewportMap', summarizeBounds(this._map?.bounds?.())),
            contentWidth: this._mapContentWidth,
            contentHeight: this._mapContentHeight,
            mapYDirection: diagnostics.mapYDirection,
            interfaceYDirection: diagnostics.interfaceYDirection,
            displayCornersJson: JSON.stringify(diagnostics.displayCorners.map((point) => this._debugPoint(point))),
            mapCornersJson: JSON.stringify(diagnostics.mapCorners.map((point) => this._debugPoint(point))),
            interfaceMapCornersJson: JSON.stringify(diagnostics.interfaceCorners.map((point) => this._debugPoint(point))),
            roundTripDisplayCornersJson: JSON.stringify(diagnostics.roundTripCorners.map((point) => this._debugPoint(point))),
        };
    }

    _selectionFileCounts(rows, limit = 10) {
        const counts = new Map();
        (rows || []).forEach((row) => {
            const props = row?.feature?.properties || {};
            const fileId = props.wsifileId ?? props.wsifile_id ?? 'unknown';
            const key = String(fileId);
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        return Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([fileId, count]) => ({ fileId, count }));
    }

    _selectionRowSamples(rows, limit = 8) {
        return (rows || []).slice(0, limit).map((row) => {
            const bounds = this._rowCullingBounds(row);
            const displayBounds = this._rowDisplayBounds(row);
            const props = row?.feature?.properties || {};
            return {
                id: row?.id ?? null,
                fileId: props.wsifileId ?? props.wsifile_id ?? null,
                mapBounds: summarizeBounds(bounds),
                displayBounds: summarizeBounds(displayBounds),
            };
        });
    }

    _mapRectangleFromDisplayPoints(pointA, pointB) {
        if (!pointA || !pointB || !this._map?.displayToGcs) return null;
        const displayRect = this._displayRectangleFromPoints(pointA, pointB);
        const points = [
            { x: displayRect.minX, y: displayRect.minY },
            { x: displayRect.maxX, y: displayRect.minY },
            { x: displayRect.maxX, y: displayRect.maxY },
            { x: displayRect.minX, y: displayRect.maxY },
        ]
            .map((point) => this._map.displayToGcs(point))
            .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
        if (!points.length) return null;
        return points.reduce((bounds, point) => ({
            minX: Math.min(bounds.minX, point.x),
            minY: Math.min(bounds.minY, point.y),
            maxX: Math.max(bounds.maxX, point.x),
            maxY: Math.max(bounds.maxY, point.y),
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    }

    _rowsInMapRectangleResult(rect, onlyFullyContained = false) {
        const sourceRows = this._spatialIndex ? this._querySpatialIndex(rect) : this._featureRows;
        let visibleRowCount = 0;
        const rows = sourceRows.filter((row) => {
            if (!this._isFeatureIdVisible(row.id)) return false;
            visibleRowCount += 1;
            const bounds = this._rowCullingBounds(row);
            if (!bounds) return false;
            if (onlyFullyContained) {
                return bounds.minX >= rect.minX
                    && bounds.maxX <= rect.maxX
                    && bounds.minY >= rect.minY
                    && bounds.maxY <= rect.maxY;
            }
            return this._boundsIntersect(bounds, rect);
        });
        return {
            rows,
            source: this._spatialIndex ? 'spatial-index' : 'feature-rows',
            sourceRowCount: sourceRows.length,
            visibleRowCount,
        };
    }

    _rowsInMapRectangle(rect, onlyFullyContained = false) {
        return this._rowsInMapRectangleResult(rect, onlyFullyContained).rows;
    }

    _displayBoundsContainPoint(bounds, point, tolerance = 0) {
        return point.x >= bounds.minX - tolerance
            && point.x <= bounds.maxX + tolerance
            && point.y >= bounds.minY - tolerance
            && point.y <= bounds.maxY + tolerance;
    }

    _beginDisplayFrame() {
        this._displayTransformVersion = (this._displayTransformVersion || 0) + 1;
        this._frameGeometryCache = {
            paperRect: null,
            overlayRect: null,
            layerByTiledImage: new Map(),
        };
        this._refreshTiledImageCache();
    }

    _beginHitTestDisplayFrame(reason = 'hit-test') {
        this._syncMapViewport(this._width, this._height);
        this._beginDisplayFrame();
        if (reason !== 'point') {
            debugLog('geojs.selection', 'hit-test-display-frame', {
                reason,
                coordinateMode: this.options.coordinateMode,
                sharedGeoMap: Boolean(this._usesSharedGeoJSMap),
                displayTransformVersion: this._displayTransformVersion || 0,
                viewportSignature: this._viewportSignature(this._width, this._height),
                width: this._width,
                height: this._height,
            });
        }
    }

    _frameRects() {
        if (!this._frameGeometryCache) {
            this._frameGeometryCache = {
                paperRect: null,
                overlayRect: null,
                layerByTiledImage: new Map(),
            };
        }
        if (!this._frameGeometryCache.paperRect) {
            this._frameGeometryCache.paperRect = this.toolkit.overlay._canvas.getBoundingClientRect();
        }
        if (!this._frameGeometryCache.overlayRect) {
            this._frameGeometryCache.overlayRect = this.element.getBoundingClientRect();
        }
        return this._frameGeometryCache;
    }

    _displayPointCache(row) {
        if (row._geojsDisplayPointCache?.version === this._displayTransformVersion) {
            return row._geojsDisplayPointCache.points;
        }
        row._geojsDisplayPointCache = {
            version: this._displayTransformVersion,
            points: new Map(),
        };
        return row._geojsDisplayPointCache.points;
    }

    _includeSelectedRows(rows) {
        if (!this._selectedEmbeddingIds?.size) return rows;
        const selectedRows = [];
        this._selectedEmbeddingIds.forEach((id) => {
            const row = this._rowById.get(id);
            if (row && this._isFeatureIdVisible(row.id)) selectedRows.push(row);
        });
        if (!selectedRows.length) return rows;
        const seen = new Set();
        return [...rows, ...selectedRows].filter((row) => {
            if (!row || seen.has(row.id)) return false;
            seen.add(row.id);
            return true;
        });
    }

    _rowUsesViewportCulling(row) {
        return Boolean(
            row?.directEmbedding
            || row?.directEmbeddingOverview
            || row?.feature?.properties?.wsvvEmbeddingGrid
        );
    }

    _visibleRowsForRender(rows) {
        // Image-space vertices remain valid while the camera moves. Keep a
        // padded working set so nearby pans reuse both culling and GPU data.
        if (this._spatialIndex && !this._usesDisplayCoordinates() && this.options.renderEmbeddingBoundaries) {
            const viewport = this._currentImageViewportBounds(0);
            const cached = this._viewportRowsCache;
            const span = viewport ? viewport.maxX - viewport.minX : 0;
            if (viewport && cached?.source === rows && cached.version === this._renderDataVersion
                && span >= cached.span * 0.7 && span <= cached.span * 1.3
                && viewport.minX >= cached.bounds.minX && viewport.maxX <= cached.bounds.maxX
                && viewport.minY >= cached.bounds.minY && viewport.maxY <= cached.bounds.maxY) return cached.rows;
            if (viewport) {
                if (this._renderPartitions?.source !== rows) this._renderPartitions = {source: rows,
                    pinned: rows.filter(row => !this._rowUsesViewportCulling(row))};
                const margin = Math.max(0, finiteNumber(this.options.renderMargin, 0));
                const padded = this._currentImageViewportBounds(margin) || viewport;
                const padX = (viewport.maxX - viewport.minX) * 0.3;
                const padY = (viewport.maxY - viewport.minY) * 0.3;
                const bounds = {minX: padded.minX - padX, minY: padded.minY - padY,
                    maxX: padded.maxX + padX, maxY: padded.maxY + padY};
                const pinned = this._renderPartitions.pinned.filter(row => this._isFeatureIdVisible(row.id));
                const indexed = this._querySpatialIndex(bounds).filter(row => this._rowUsesViewportCulling(row));
                const visible = this._includeSelectedRows([...pinned, ...indexed]);
                this._viewportRowsCache = {source: rows, version: this._renderDataVersion, span, bounds, rows: visible};
                return visible;
            }
        }
        const pinned = rows.filter((row) => !this._rowUsesViewportCulling(row));
        const cullable = rows.filter((row) => this._rowUsesViewportCulling(row));
        if (!cullable.length) return this._includeSelectedRows(pinned);

        const margin = Math.max(0, finiteNumber(this.options.renderMargin, 0));
        if (this._usesDisplayCoordinates()) {
            const viewport = {
                minX: -margin,
                minY: -margin,
                maxX: this._width + margin,
                maxY: this._height + margin,
            };
            const visible = cullable.filter((row) => {
                const bounds = this._rowDisplayBounds(row);
                if (!bounds) return true;
                return this._boundsIntersect(bounds, viewport);
            });
            return this._includeSelectedRows([...pinned, ...visible]);
        }

        const viewport = this._currentImageViewportBounds(margin);
        if (!viewport) return this._includeSelectedRows(rows);
        if (!this._spatialIndex) {
            const visible = cullable.filter((row) => {
                const bounds = this._rowCullingBounds(row);
                return !bounds || this._boundsIntersect(bounds, viewport);
            });
            return this._includeSelectedRows([...pinned, ...visible]);
        }
        const indexed = this._querySpatialIndex(viewport).filter((row) => this._rowUsesViewportCulling(row));
        return this._includeSelectedRows([...pinned, ...indexed]);
    }

    _markRenderDataDirty() {
        this._viewportRowsCache = null;
        this._renderDataDirty = true;
        this._renderRowsKey = null;
        this._renderDataVersion = (this._renderDataVersion || 0) + 1;
        this._overviewRowsCache = null;
        this._lastViewportRequestSignature = null;
    }

    _markRenderGeometryDirty() {
        this._viewportRowsCache = null;
        this._renderDataDirty = true;
        this._renderRowsKey = null;
        this._lastViewportRequestSignature = null;
    }

    _usesDisplayCoordinates() {
        return this.options.coordinateMode === 'display';
    }

    _syncMapViewport(width = this._width, height = this._height) {
        if (this._usesDisplayCoordinates()) {
            this._applyMapBounds({
                left: 0,
                top: 0,
                right: width,
                bottom: height,
            });
            return;
        }

        if (this._usesSharedGeoJSMap) {
            const bounds = this._currentSharedMapBounds(0);
            if (bounds) this._lastMapBounds = bounds;
            return;
        }

        const bounds = this._currentImageViewportBounds(0);
        const validBounds = bounds
            && Number.isFinite(bounds.minX)
            && Number.isFinite(bounds.minY)
            && Number.isFinite(bounds.maxX)
            && Number.isFinite(bounds.maxY)
            && bounds.maxX > bounds.minX
            && bounds.maxY > bounds.minY;
        if (validBounds) {
            this._lastMapBounds = bounds;
            this._applyMapBounds({
                left: bounds.minX,
                top: bounds.minY,
                right: bounds.maxX,
                bottom: bounds.maxY,
            });
            return;
        }
        if (this._lastMapBounds) {
            this._applyMapBounds({
                left: this._lastMapBounds.minX,
                top: this._lastMapBounds.minY,
                right: this._lastMapBounds.maxX,
                bottom: this._lastMapBounds.maxY,
            });
            return;
        }
        this._map.zoom?.(0);
        this._map.center?.({ x: width / 2, y: height / 2 });
    }

    _viewportSignature(width = this._width, height = this._height) {
        const size = getViewerSize(this.viewer);
        const w = Math.round(Number(width) || size.width || 0);
        const h = Math.round(Number(height) || size.height || 0);
        if (this._usesDisplayCoordinates()) {
            const viewport = this.viewer?.viewport;
            const center = viewport?.getCenter?.(true);
            const zoom = viewport?.getZoom?.(true);
            const centerX = Number.isFinite(center?.x) ? center.x.toFixed(5) : '';
            const centerY = Number.isFinite(center?.y) ? center.y.toFixed(5) : '';
            const zoomText = Number.isFinite(zoom) ? Number(zoom).toFixed(5) : '';
            return `display:${w}x${h}:${centerX},${centerY},${zoomText}`;
        }
        // Include container size: sidebar chrome can change the map pixel size while
        // image bounds stay identical — skipping redraw then drops annotations.
        const bounds = this._currentImageViewportBounds(0) || this._lastMapBounds;
        return `${this._mapBoundsSignature(bounds) || 'bounds'}:${w}x${h}`;
    }

    _mapBoundsSignature(bounds) {
        if (!bounds) return null;
        const flat = summarizeBounds(bounds);
        if (!flat) return null;
        return [flat.minX, flat.minY, flat.maxX, flat.maxY].join(':');
    }

    _applyMapBounds(bounds) {
        if (this._usesSharedGeoJSMap && !this._usesDisplayCoordinates()) {
            return;
        }
        const signature = this._mapBoundsSignature({
            minX: bounds?.left,
            minY: bounds?.top,
            maxX: bounds?.right,
            maxY: bounds?.bottom,
        });
        if (signature && signature === this._lastAppliedMapBoundsSignature) return;
        this._lastAppliedMapBoundsSignature = signature;
        this._map.bounds?.(bounds);
    }

    _isFeatureIdVisible(id) {
        return this._visibleFeatureIds === null || this._visibleFeatureIds?.has?.(id);
    }

    _visibleFeatureCount() {
        return this._visibleFeatureIds === null ? this._featureRows.length : (this._visibleFeatureIds?.size || 0);
    }

    _ensureVisibleFeatureIdSet() {
        if (this._visibleFeatureIds !== null) return;
        this._visibleFeatureIds = new Set(this._featureRows.map((row) => row.id));
    }

    _refreshVisibleFeatureIds() {
        if (!this._featureRows.length || this._featureRows.every((row) => this._rowShouldRenderInGeoJS(row))) {
            this._visibleFeatureIds = null;
            return;
        }
        this._visibleFeatureIds = new Set();
        this._featureRows.forEach((row) => {
            if (this._rowShouldRenderInGeoJS(row)) {
                this._visibleFeatureIds.add(row.id);
            }
        });
    }

    _storeRowsSignatureForRows(rows) {
        if (!rows?.length) return '0';
        let hash = 2166136261;
        for (const row of rows) {
            const text = String(row.collection?.id ?? row.collection?.label ?? '') + ':' + Boolean(row.collection?.properties?.hidden) + ':' + JSON.stringify(row.feature || {});
            for (let i = 0; i < text.length; i += 1) {
                hash ^= text.charCodeAt(i);
                hash = Math.imul(hash, 16777619) >>> 0;
            }
        }
        return String(rows.length) + ':' + String(hash);
    }

    _shouldUseOverviewRender(rows) {
        if (this.options.renderEmbeddingBoundaries) return false;
        const threshold = Math.max(0, finiteNumber(this.options.overviewRenderThreshold, DEFAULT_OVERVIEW_RENDER_THRESHOLD));
        if (!threshold || rows.length <= threshold) return false;
        let directCount = 0;
        let sample = null;
        for (const row of rows) {
            if (row?.directEmbedding && !row.paperItem) {
                directCount += 1;
                sample = sample || row;
            }
        }
        if (directCount <= threshold) return false;
        const samplePixelSize = this._embeddingRowPixelSize(sample);
        const useOverview = !Number.isFinite(samplePixelSize) || samplePixelSize <= EMBEDDING_RECT_POINT_PIXEL_THRESHOLD;
        debugLog('geojs.display', 'overview-decision', {
            rowCount: rows.length,
            directCount,
            threshold,
            samplePixelSize: Number.isFinite(samplePixelSize) ? Number(samplePixelSize.toFixed(2)) : null,
            useOverview,
        });
        return useOverview;
    }

    _prepareRowsForGeoJSRender(rows, options = {}) {
        if (this.options.renderEmbeddingBoundaries) return { rows, mode: 'full-boundaries' };
        const threshold = Math.max(0, finiteNumber(this.options.overviewRenderThreshold, DEFAULT_OVERVIEW_RENDER_THRESHOLD));
        if (!options.forceOverview && (!threshold || rows.length <= threshold)) {
            return { rows, mode: 'full' };
        }

        const directRows = [];
        const passthroughRows = [];
        for (const row of rows) {
            if (row?.directEmbedding && !row.paperItem) {
                directRows.push(row);
            } else {
                passthroughRows.push(row);
            }
        }
        if (!options.forceOverview && directRows.length <= threshold) {
            return { rows, mode: 'full' };
        }

        const overviewRows = this._embeddingOverviewRows(directRows);
        if (!overviewRows.length || overviewRows.length >= directRows.length) {
            return { rows, mode: 'full' };
        }

        return {
            rows: passthroughRows.length ? [...passthroughRows, ...overviewRows] : overviewRows,
            mode: 'overview-aggregate',
            aggregatedRows: overviewRows.length,
            aggregatedSourceRows: directRows.length,
        };
    }

    _embeddingOverviewRows(rows) {
        const configuredGrid = finiteNumber(this.options.overviewGridSize, DEFAULT_OVERVIEW_GRID_SIZE);
        const pixelDerivedGrid = Math.round(320 / Math.max(2, finiteNumber(this.options.overviewBinPixels, DEFAULT_OVERVIEW_BIN_PIXELS)));
        const gridSize = Math.max(8, Math.min(64, Math.round(configuredGrid || pixelDerivedGrid || DEFAULT_OVERVIEW_GRID_SIZE)));
        const cacheKey = this._overviewRowsCacheKey(rows, gridSize);
        if (this._overviewRowsCache?.key === cacheKey) {
            debugLog('geojs.display', 'overview-bins-cache-hit', {
                sourceRows: rows.length,
                binCount: this._overviewRowsCache.rows.length,
                gridSize,
                extentFlat: this._overviewRowsCache.extentFlat,
                firstSampleX: this._overviewRowsCache.firstSampleX,
                firstSampleY: this._overviewRowsCache.firstSampleY,
                firstSampleCount: this._overviewRowsCache.firstSampleCount,
            });
            return this._overviewRowsCache.rows;
        }

        const fileExtents = new Map();
        const rowInfos = [];
        let skippedRows = 0;

        for (const row of rows) {
            const bounds = this._embeddingRowBounds(row);
            if (!bounds) {
                skippedRows += 1;
                continue;
            }
            const minX = Number(bounds.minX ?? bounds.left ?? bounds.x);
            const minY = Number(bounds.minY ?? bounds.top ?? bounds.y);
            const maxX = Number(bounds.maxX ?? (Number(bounds.left ?? bounds.x) + Number(bounds.width)));
            const maxY = Number(bounds.maxY ?? (Number(bounds.top ?? bounds.y) + Number(bounds.height)));
            if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
                skippedRows += 1;
                continue;
            }

            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const props = row?.feature?.properties || {};
            const fileId = finiteNumber(props.wsifileId ?? props.wsifile_id ?? row?.paperItem?.data?.wsifileId, null);
            const fileKey = fileId !== null ? String(fileId) : 'unfiled';
            rowInfos.push({ row, fileKey, fileId, minX, minY, maxX, maxY, centerX, centerY });

            let extent = fileExtents.get(fileKey);
            if (!extent) {
                const layout = fileId !== null ? this.viewer?.__wsvvTileLayoutsByFileId?.get?.(fileId) : null;
                extent = layout && finiteRect(layout)
                    ? {
                        minX: Number(layout.x),
                        minY: Number(layout.y),
                        maxX: Number(layout.x) + Number(layout.width),
                        maxY: Number(layout.y) + Number(layout.height),
                    }
                    : { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
                fileExtents.set(fileKey, extent);
            }
            if (!Number.isFinite(extent.minX) || !Number.isFinite(extent.minY) || !Number.isFinite(extent.maxX) || !Number.isFinite(extent.maxY)) {
                extent.minX = Math.min(extent.minX, minX);
                extent.minY = Math.min(extent.minY, minY);
                extent.maxX = Math.max(extent.maxX, maxX);
                extent.maxY = Math.max(extent.maxY, maxY);
            }
        }

        const bins = new Map();

        for (const info of rowInfos) {
            const extent = fileExtents.get(info.fileKey);
            const width = Number(extent?.maxX) - Number(extent?.minX);
            const height = Number(extent?.maxY) - Number(extent?.minY);
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
                skippedRows += 1;
                continue;
            }
            const ix = Math.max(0, Math.min(gridSize - 1, Math.floor((info.centerX - extent.minX) / width * gridSize)));
            const iy = Math.max(0, Math.min(gridSize - 1, Math.floor((info.centerY - extent.minY) / height * gridSize)));
            const strokeColor = geojsFeatureStyle(info.row, 'strokeColor', '#1f2937');
            const key = info.fileKey + ':' + ix + ':' + iy + ':' + String(strokeColor);
            let bin = bins.get(key);
            if (!bin) {
                bin = {
                    key,
                    fileKey: info.fileKey,
                    fileId: info.fileId,
                    ix,
                    iy,
                    count: 0,
                    sumX: 0,
                    sumY: 0,
                    minX: Infinity,
                    minY: Infinity,
                    maxX: -Infinity,
                    maxY: -Infinity,
                    sample: info.row,
                    strokeColor,
                };
                bins.set(key, bin);
            }
            bin.count += 1;
            bin.sumX += info.centerX;
            bin.sumY += info.centerY;
            bin.minX = Math.min(bin.minX, info.minX);
            bin.minY = Math.min(bin.minY, info.minY);
            bin.maxX = Math.max(bin.maxX, info.maxX);
            bin.maxY = Math.max(bin.maxY, info.maxY);
        }

        const binValues = Array.from(bins.values());
        const extentSummary = binValues.reduce((extent, bin) => ({
            minX: Math.min(extent.minX, bin.minX),
            minY: Math.min(extent.minY, bin.minY),
            maxX: Math.max(extent.maxX, bin.maxX),
            maxY: Math.max(extent.maxY, bin.maxY),
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        const finiteExtentSummary = [extentSummary.minX, extentSummary.minY, extentSummary.maxX, extentSummary.maxY].every(Number.isFinite)
            ? extentSummary
            : null;
        const extentFlat = summarizeBounds(finiteExtentSummary);
        const firstSample = binValues[0];
        debugLog('geojs.display', 'overview-bins-built', {
            sourceRows: rows.length,
            rowInfos: rowInfos.length,
            skippedRows,
            fileCount: fileExtents.size,
            gridSize,
            binCount: bins.size,
            extent: finiteExtentSummary,
            extentFlat,
            firstSampleKey: firstSample?.key || null,
            firstSampleCount: firstSample?.count || null,
            firstSampleX: firstSample ? Number((firstSample.sumX / Math.max(1, firstSample.count)).toFixed(2)) : null,
            firstSampleY: firstSample ? Number((firstSample.sumY / Math.max(1, firstSample.count)).toFixed(2)) : null,
            samples: binValues.slice(0, 3).map((bin) => ({
                key: bin.key,
                count: bin.count,
                x: Number((bin.sumX / Math.max(1, bin.count)).toFixed(2)),
                y: Number((bin.sumY / Math.max(1, bin.count)).toFixed(2)),
            })),
        });

        const overviewRows = binValues.map((bin) => {
            const x = bin.sumX / Math.max(1, bin.count);
            const y = bin.sumY / Math.max(1, bin.count);
            const radius = Math.min(12, Math.max(4, 3 + Math.log2(bin.count + 1) * 0.65));
            const fillOpacity = finiteNumber(this.options.overviewFillOpacity, 0.95);
            const bounds = { minX: x, minY: y, maxX: x, maxY: y };
            const id = 'embedding-overview:' + bin.key + ':' + bin.count + ':' + Math.round(x) + ':' + Math.round(y);
            return {
                id,
                directEmbeddingOverview: true,
                overviewCount: bin.count,
                feature: {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [x, y] },
                    properties: {
                        id,
                        label: 'embedding overview',
                        coordinateSpace: 'image',
                        wsifileId: bin.fileId,
                        fillColor: this.options.overviewFillColor || bin.strokeColor,
                        fillOpacity,
                        strokeColor: this.options.overviewStrokeColor || bin.strokeColor,
                        strokeOpacity: finiteNumber(this.options.overviewStrokeOpacity, 1),
                        strokeWidth: finiteNumber(this.options.overviewStrokeWidth, 1.1),
                        radius,
                        wsvvEmbeddingOverview: true,
                    },
                },
                collection: bin.sample.collection,
                _geojsDisplaySourceRow: bin.sample,
                _geojsDisplayCullingBounds: bounds,
            };
        });
        this._overviewRowsCache = {
            key: cacheKey,
            rows: overviewRows,
            extentFlat,
            firstSampleX: firstSample ? Number((firstSample.sumX / Math.max(1, firstSample.count)).toFixed(2)) : null,
            firstSampleY: firstSample ? Number((firstSample.sumY / Math.max(1, firstSample.count)).toFixed(2)) : null,
            firstSampleCount: firstSample?.count || null,
        };
        return overviewRows;
    }

    _overviewRowsCacheKey(rows, gridSize) {
        const layouts = Array.isArray(this.viewer?.__wsvvTileLayouts) ? this.viewer.__wsvvTileLayouts : [];
        const layoutKey = layouts.map((layout) => [
            finiteNumber(layout?.x, 0),
            finiteNumber(layout?.y, 0),
            finiteNumber(layout?.width, 0),
            finiteNumber(layout?.height, 0),
        ].join(',')).join('|');
        const firstId = rows[0]?.id ?? '';
        const middleId = rows[Math.floor(rows.length / 2)]?.id ?? '';
        const lastId = rows[rows.length - 1]?.id ?? '';
        return [
            this._renderDataVersion,
            rows.length,
            gridSize,
            firstId,
            middleId,
            lastId,
            layoutKey,
        ].join(':');
    }

    _pointRowsBounds(pointRows) {
        if (!pointRows.length) return null;
        const bounds = pointRows.reduce((extent, row) => {
            const x = finiteNumber(row?.position?.x, null);
            const y = finiteNumber(row?.position?.y, null);
            if (x === null || y === null) return extent;
            return {
                minX: Math.min(extent.minX, x),
                minY: Math.min(extent.minY, y),
                maxX: Math.max(extent.maxX, x),
                maxY: Math.max(extent.maxY, y),
            };
        }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
            ? summarizeBounds(bounds)
            : null;
    }

    _renderRowsSignature(rows) {
        if (this._rowsSignatureCache?.rows === rows && this._rowsSignatureCache.version === this._renderDataVersion) {
            return this._rowsSignatureCache.signature;
        }
        if (rows.length > 50000) {
            return String(this._renderDataVersion) + ':' + String(rows.length) + ':' + String(this._visibleFeatureCount());
        }
        let hash = 2166136261;
        for (const row of rows) {
            const id = String(row.id);
            for (let i = 0; i < id.length; i += 1) {
                hash ^= id.charCodeAt(i);
                hash = Math.imul(hash, 16777619) >>> 0;
            }
        }
        const signature = String(this._renderDataVersion) + ':' + String(rows.length) + ':' + String(this._visibleFeatureCount()) + ':' + String(hash);
        this._rowsSignatureCache = {rows, version: this._renderDataVersion, signature};
        return signature;
    }

    _layoutUnionBounds() {
        const layouts = Array.isArray(this.viewer?.__wsvvTileLayouts) ? this.viewer.__wsvvTileLayouts : [];
        const finiteLayouts = layouts.filter(finiteRect);
        if (!finiteLayouts.length) {
            const raw = this.viewer?._layoutBounds;
            const left = finiteNumber(raw?.left, null);
            const top = finiteNumber(raw?.top, null);
            const right = finiteNumber(raw?.right, null);
            const bottom = finiteNumber(raw?.bottom, null);
            if ([left, top, right, bottom].every((value) => value !== null) && right > left && bottom > top) {
                return { minX: left, minY: top, maxX: right, maxY: bottom };
            }
            return null;
        }
        return finiteLayouts.reduce((bounds, layout) => ({
            minX: Math.min(bounds.minX, Number(layout.x)),
            minY: Math.min(bounds.minY, Number(layout.y)),
            maxX: Math.max(bounds.maxX, Number(layout.x) + Number(layout.width)),
            maxY: Math.max(bounds.maxY, Number(layout.y) + Number(layout.height)),
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    }

    _mapContentSize(fallbackWidth = this._width, fallbackHeight = this._height) {
        if (this._usesDisplayCoordinates()) {
            return {
                width: Math.max(1, finiteNumber(fallbackWidth, 1)),
                height: Math.max(1, finiteNumber(fallbackHeight, 1)),
            };
        }
        const union = this._layoutUnionBounds();
        const viewport = this.viewer?.viewport;
        const viewportWidth = finiteNumber(viewport?.imageWidth, null);
        const viewportHeight = finiteNumber(viewport?.imageHeight, null);
        const unionWidth = union ? finiteNumber(union.maxX - union.minX, null) : null;
        const unionHeight = union ? finiteNumber(union.maxY - union.minY, null) : null;
        const firstContentSize = this.viewer?.world?.getItemAt?.(0)?.getContentSize?.();
        const width = Math.max(
            1,
            unionWidth || 0,
            viewportWidth || 0,
            finiteNumber(firstContentSize?.x, 0),
            finiteNumber(fallbackWidth, 1),
        );
        const height = Math.max(
            1,
            unionHeight || 0,
            viewportHeight || 0,
            finiteNumber(firstContentSize?.y, 0),
            finiteNumber(fallbackHeight, 1),
        );
        return { width, height };
    }

    _layoutScaleBase() {
        const explicit = finiteNumber(this.viewer?.__wsvvLayoutScaleBase, null);
        if (!this.viewer?.geoMap && explicit && explicit > 0) return explicit;

        const viewport = this.viewer?.viewport;
        const viewportWidth = finiteNumber(viewport?.imageWidth, null);
        if (viewportWidth && viewportWidth > 0) return viewportWidth;

        if (explicit && explicit > 0) return explicit;

        const firstLayout = this.viewer?.__wsvvTileLayouts?.[0];
        const layoutBase = finiteNumber(firstLayout?.scaleBase, null);
        if (layoutBase && layoutBase > 0) return layoutBase;

        const firstContentSize = this.viewer?.world?.getItemAt?.(0)?.getContentSize?.();
        return finiteNumber(firstContentSize?.x, null);
    }

    _imageWidthForViewport() {
        return this._layoutScaleBase();
    }

    _currentSharedMapBounds(margin = 0) {
        const flat = summarizeBounds(this._map?.bounds?.());
        if (!flat || flat.width <= 0 || flat.height <= 0) return null;
        const mapMargin = Math.max(0, finiteNumber(margin, 0));
        return {
            minX: flat.minX - mapMargin,
            minY: flat.minY - mapMargin,
            maxX: flat.maxX + mapMargin,
            maxY: flat.maxY + mapMargin,
        };
    }

    _currentImageViewportBounds(margin = 0) {
        if (this._usesSharedGeoJSMap && !this._usesDisplayCoordinates()) {
            return this._currentSharedMapBounds(margin);
        }
        const viewport = this.viewer?.viewport;
        const bounds = viewport?.getBounds?.(true);
        if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
            return null;
        }

        const imageWidth = this._imageWidthForViewport();
        if (!imageWidth || imageWidth <= 0) return null;

        const viewportZoom = finiteNumber(viewport.getZoom?.(true), null);
        const containerWidth = finiteNumber(
            viewport._containerInnerSize?.x || this.viewer?.container?.clientWidth || this.viewer?.canvas?.clientWidth,
            null,
        );
        const imageUnitsPerPixel = viewportZoom && containerWidth
            ? imageWidth / (viewportZoom * containerWidth)
            : bounds.width * imageWidth / Math.max(1, this._width);
        const imageMargin = Math.max(0, finiteNumber(margin, 0)) * imageUnitsPerPixel;

        return {
            minX: bounds.x * imageWidth - imageMargin,
            minY: bounds.y * imageWidth - imageMargin,
            maxX: (bounds.x + bounds.width) * imageWidth + imageMargin,
            maxY: (bounds.y + bounds.height) * imageWidth + imageMargin,
        };
    }


    _boundsIntersect(a, b) {
        return a.maxX >= b.minX
            && a.minX <= b.maxX
            && a.maxY >= b.minY
            && a.minY <= b.maxY;
    }

    _spatialBinSize() {
        const explicit = finiteNumber(this.options.spatialBinSize, null);
        if (explicit && explicit > 0) return explicit;
        const base = this._layoutScaleBase();
        return Math.max(1024, (base || 32768) / 32);
    }

    _spatialKey(ix, iy) {
        return String(ix) + ':' + String(iy);
    }

    _rebuildSpatialIndex() {
        const started = debugNow();
        if (this._usesDisplayCoordinates() || !this._featureRows.length) {
            this._spatialIndex = null;
            debugDuration('geojs.display', 'rebuild-spatial-index', started, {
                skipped: true,
                reason: this._usesDisplayCoordinates() ? 'display-coordinates' : 'empty',
                rowCount: this._featureRows.length,
            });
            return;
        }

        const binSize = this._spatialBinSize();
        const bins = new Map();
        const uncullable = [];
        let binReferences = 0;
        this._spatialIndexSpace = 'layout-annotations';
        this._featureRows.forEach((row) => {
            if (!this._rowUsesViewportCulling(row)) {
                uncullable.push(row);
                return;
            }
            const bounds = this._rowCullingBounds(row);
            if (!bounds) {
                uncullable.push(row);
                return;
            }
            const minX = Math.floor(bounds.minX / binSize);
            const maxX = Math.floor(bounds.maxX / binSize);
            const minY = Math.floor(bounds.minY / binSize);
            const maxY = Math.floor(bounds.maxY / binSize);
            for (let ix = minX; ix <= maxX; ix += 1) {
                for (let iy = minY; iy <= maxY; iy += 1) {
                    const key = this._spatialKey(ix, iy);
                    if (!bins.has(key)) bins.set(key, []);
                    bins.get(key).push(row);
                    binReferences += 1;
                }
            }
        });
        this._spatialIndex = { binSize, bins, uncullable };
        debugDuration('geojs.display', 'rebuild-spatial-index', started, {
            rowCount: this._featureRows.length,
            binSize,
            binCount: bins.size,
            binReferences,
            uncullableCount: uncullable.length,
        });
    }


    _querySpatialIndex(viewport) {
        const index = this._spatialIndex;
        if (!index) return this._featureRows;

        const minX = Math.floor(viewport.minX / index.binSize);
        const maxX = Math.floor(viewport.maxX / index.binSize);
        const minY = Math.floor(viewport.minY / index.binSize);
        const maxY = Math.floor(viewport.maxY / index.binSize);
        const binSpanX = maxX - minX + 1;
        const binSpanY = maxY - minY + 1;
        const binVisits = binSpanX * binSpanY;
        const binLimit = Math.max(1, finiteNumber(this.options.spatialQueryBinLimit, DEFAULT_SPATIAL_QUERY_BIN_LIMIT));
        if (![minX, minY, maxX, maxY, binVisits].every(Number.isFinite) || binSpanX <= 0 || binSpanY <= 0 || binVisits > binLimit) {
            debugLog('geojs.display', 'spatial-query-fallback', {
                reason: !Number.isFinite(binVisits) ? 'invalid-bin-span' : 'bin-limit',
                binSpanX,
                binSpanY,
                binVisits: Number.isFinite(binVisits) ? binVisits : null,
                binLimit,
                rowCount: this._featureRows.length,
            });
            return this._featureRows.filter((row) => {
                if (!this._isFeatureIdVisible(row.id)) return false;
                const bounds = this._rowCullingBounds(row);
                return !bounds || this._boundsIntersect(bounds, viewport);
            });
        }
        const seen = new Set();
        const rows = [];
        const addRow = (row) => {
            if (!row || seen.has(row.id) || !this._isFeatureIdVisible(row.id)) return;
            seen.add(row.id);
            const bounds = this._rowCullingBounds(row);
            if (!bounds || this._boundsIntersect(bounds, viewport)) rows.push(row);
        };

        index.uncullable.forEach(addRow);
        for (let ix = minX; ix <= maxX; ix += 1) {
            for (let iy = minY; iy <= maxY; iy += 1) {
                (index.bins.get(this._spatialKey(ix, iy)) || []).forEach(addRow);
            }
        }
        return rows;
    }

    _rowCullingBounds(row) {
        if (row._geojsDisplayCullingBounds !== undefined && row._geojsCullingSpace === 'layout') {
            return row._geojsDisplayCullingBounds;
        }

        const layoutBounds = row.feature?.properties?.geojsLayoutBounds;
        if (layoutBounds) {
            const bounds = {
                minX: Number(layoutBounds.minX ?? layoutBounds.left ?? layoutBounds.x),
                minY: Number(layoutBounds.minY ?? layoutBounds.top ?? layoutBounds.y),
                maxX: Number(layoutBounds.maxX ?? (Number(layoutBounds.left ?? layoutBounds.x) + Number(layoutBounds.width))),
                maxY: Number(layoutBounds.maxY ?? (Number(layoutBounds.top ?? layoutBounds.y) + Number(layoutBounds.height))),
            };
            if (Number.isFinite(bounds.minX) && Number.isFinite(bounds.minY) && Number.isFinite(bounds.maxX) && Number.isFinite(bounds.maxY)) {
                row._geojsCullingSpace = 'layout';
                row._geojsDisplayCullingBounds = bounds;
                return bounds;
            }
        }

        const geom = row.feature.geometry || {};
        let coords = [];
        if (geom.type === 'Point' && pointSubtypePolygon(geom)) {
            coords = pointSubtypePolygon(geom);
        } else {
            coords = geom.coordinates || [];
        }
        const sourcePoints = [];
        const collect = (value) => {
            if (!Array.isArray(value)) return;
            if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
                sourcePoints.push({ x: value[0], y: value[1] });
                return;
            }
            value.forEach(collect);
        };
        collect(coords);
        if (!sourcePoints.length) {
            row._geojsDisplayCullingBounds = null;
            return null;
        }

        const imagePoints = sourcePoints
            .map((point) => this._featureCoordinateToImage(row, point))
            .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
        if (!imagePoints.length) {
            row._geojsDisplayCullingBounds = null;
            return null;
        }

        row._geojsCullingSpace = 'layout';
        row._geojsDisplayCullingBounds = imagePoints.reduce((bounds, point) => ({
            minX: Math.min(bounds.minX, point.x),
            minY: Math.min(bounds.minY, point.y),
            maxX: Math.max(bounds.maxX, point.x),
            maxY: Math.max(bounds.maxY, point.y),
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        return row._geojsDisplayCullingBounds;
    }

    _rowDisplayBounds(row) {
        if (row?.directEmbedding) {
            const bounds = this._embeddingRowBounds(row);
            if (!bounds) return null;
            return displayBoundsFromBounds(
                bounds,
                (point) => this._featureCoordinateToDisplay(row, point),
            );
        }

        const geom = row.feature.geometry || {};
        let coords = [];
        if (geom.type === 'Point' && pointSubtypePolygon(geom)) {
            coords = pointSubtypePolygon(geom);
        } else {
            coords = geom.coordinates || [];
        }
        const sourcePoints = [];
        const collect = (value) => {
            if (!Array.isArray(value)) return;
            if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
                sourcePoints.push({ x: value[0], y: value[1] });
                return;
            }
            value.forEach(collect);
        };
        collect(coords);
        if (!sourcePoints.length) return null;

        const displayPoints = sourcePoints
            .map((point) => this._featureCoordinateToDisplay(row, point))
            .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
        if (!displayPoints.length) return null;

        return displayPoints.reduce((bounds, point) => ({
            minX: Math.min(bounds.minX, point.x),
            minY: Math.min(bounds.minY, point.y),
            maxX: Math.max(bounds.maxX, point.x),
            maxY: Math.max(bounds.maxY, point.y),
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    }


    _embeddingRowBounds(row) {
        return row?._geojsDisplayCullingBounds || row?.feature?.properties?.geojsLayoutBounds || row?.feature?.properties?.geojsImageBounds || null;
    }

    _embeddingRowPixelSize(row) {
        const bounds = this._embeddingRowBounds(row);
        if (!bounds) return NaN;
        const minX = Number(bounds.minX ?? bounds.left ?? bounds.x);
        const minY = Number(bounds.minY ?? bounds.top ?? bounds.y);
        const maxX = Number(bounds.maxX ?? (Number(bounds.left ?? bounds.x) + Number(bounds.width)));
        const maxY = Number(bounds.maxY ?? (Number(bounds.top ?? bounds.y) + Number(bounds.height)));
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) return NaN;
        const viewport = this._lastMapBounds || this._currentImageViewportBounds(0);
        if (!viewport || viewport.maxX <= viewport.minX || viewport.maxY <= viewport.minY) return NaN;
        const pixelWidth = Math.abs(maxX - minX) * this._width / Math.max(1, viewport.maxX - viewport.minX);
        const pixelHeight = Math.abs(maxY - minY) * this._height / Math.max(1, viewport.maxY - viewport.minY);
        return Math.max(pixelWidth, pixelHeight);
    }

    _embeddingRowShouldRenderAsPoint(row) {
        if (!row?.directEmbedding) return false;
        const pixelSize = this._embeddingRowPixelSize(row);
        return !Number.isFinite(pixelSize) || pixelSize <= EMBEDDING_RECT_POINT_PIXEL_THRESHOLD;
    }

    _pointRows(rows) {
        return rows.flatMap((row) => {
            if (row.directEmbeddingOverview) {
                const bounds = this._embeddingRowBounds(row);
                if (!bounds) return [];
                const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
                return [{
                    sourceRow: row,
                    position: this._featureCoordinateToMapGcs(row, center),
                    radius: geojsFeatureStyle(row, 'radius', this.options.pointRadius),
                    ...this._commonStyle(row),
                }];
            }
            if (row.directEmbedding) {
                if (this.options.renderEmbeddingBoundaries || !this._embeddingRowShouldRenderAsPoint(row)) return [];
                const bounds = this._embeddingRowBounds(row);
                if (!bounds) return [];
                const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
                return [{
                    sourceRow: row,
                    position: this._featureCoordinateToMapGcs(row, center),
                    radius: this._rowIsSelected(row) ? this.options.selectedPointRadius : geojsFeatureStyle(row, 'radius', this.options.pointRadius),
                    ...this._commonStyle(row),
                }];
            }
            const geom = row.feature.geometry || {};
            const pointText = geom.properties?.subtype?.toLowerCase() === 'pointtext';
            if (geom.type !== 'Point' || (geom.properties?.subtype && !pointText) || !Array.isArray(geom.coordinates) || geom.coordinates.length < 2) return [];
            const common = this._commonStyle(row);
            // `properties.radius` is Paper's path radius in CSS pixels (stroke centered).
            // GeoJS draws stroke outside the fill radius, so shrink fill radius by
            // stroke/2 so the outer edge matches Paper/controller expectations.
            const paperPathRadius = finiteNumber(
                pointText ? POINT_TEXT_MARKER_RADIUS : geojsFeatureStyle(row, 'radius', this.options.pointRadius),
                this.options.pointRadius,
            );
            const strokeW = finiteNumber(common.strokeWidth, 0);
            const radius = Math.max(0.5, paperPathRadius - strokeW * 0.5);
            return [{
                sourceRow: row,
                position: this._featureCoordinateToMapGcs(row, coordinateToPoint(geom.coordinates)),
                radius,
                ...common,
            }];
        });
    }

    _textRows(rows) {
        return rows.flatMap(row => {
            const geometry = row.feature?.geometry;
            if (geometry?.type !== 'Point' || geometry.properties?.subtype?.toLowerCase() !== 'pointtext'
                || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) return [];
            return [{sourceRow: row,
                position: this._featureCoordinateToMapGcs(row, coordinateToPoint(geometry.coordinates)),
                text: geometry.properties.content || 'PointText',
                ...normalizePointTextStyle(row.feature.properties), ...this._commonStyle(row)}];
        });
    }

    _pointTextOffset(row) {
        const [x, y] = row.feature.geometry.coordinates;
        const display = point => this._map.gcsToDisplay(this._featureCoordinateToMapGcs(row, point));
        const origin = display({x, y}), right = display({x: x + 1, y}), down = display({x, y: y + 1});
        return pointTextOffsetForMatrix({a: right.x - origin.x, b: right.y - origin.y,
            c: down.x - origin.x, d: down.y - origin.y});
    }

    _lineRows(rows) {
        return rows.flatMap((row) => {
            if (row.directEmbeddingOverview) return [];
            if (row.directEmbedding) {
                if (!this.options.renderEmbeddingBoundaries && this._embeddingRowShouldRenderAsPoint(row)) return [];
                const bounds = this._embeddingRowBounds(row);
                if (!bounds) return [];
                return [{
                    sourceRow: row,
                    line: [
                        { x: bounds.minX, y: bounds.minY },
                        { x: bounds.maxX, y: bounds.minY },
                        { x: bounds.maxX, y: bounds.maxY },
                        { x: bounds.minX, y: bounds.maxY },
                        { x: bounds.minX, y: bounds.minY },
                    ].map((point) => this._featureCoordinateToMapGcs(row, point)),
                    ...this._commonStyle(row),
                }];
            }
            const geom = row.feature.geometry || {};
            let lines = geom.type === 'LineString'
                ? [geom.coordinates]
                : (geom.type === 'MultiLineString' ? geom.coordinates : []);

            if (['paper', 'tiledImage'].includes(row.feature.properties?.coordinateSpace)) {
                const polygons = geom.type === 'Polygon'
                    ? [geom.coordinates]
                    : (geom.type === 'MultiPolygon' ? geom.coordinates : []);
                lines = [
                    ...lines,
                    ...polygons.flatMap((polygon) => Array.isArray(polygon) ? polygon.map((ring) => closeRing(ring)) : []),
                ];
            }

            return lines
                .filter((line) => Array.isArray(line) && line.length > 1)
                .map((line) => ({
                    sourceRow: row,
                    line: line.map((coord) => this._featureCoordinateToMapGcs(row, coordinateToPoint(coord))),
                    ...this._commonStyle(row),
                }));
        });
    }

    _polygonRows(rows) {
        return rows.flatMap((row) => {
            if (row.directEmbedding) {
                if (!this._rowIsSelected(row)) return [];
                const bounds = this._embeddingRowBounds(row);
                if (!bounds) return [];
                return [{
                    sourceRow: row,
                    outer: closeRing([
                        [bounds.minX, bounds.minY],
                        [bounds.maxX, bounds.minY],
                        [bounds.maxX, bounds.maxY],
                        [bounds.minX, bounds.maxY],
                    ]).map((coord) => this._featureCoordinateToMapGcs(row, coordinateToPoint(coord))),
                    inner: [],
                    ...this._commonStyle(row),
                    fillColor: colorToGeoJS(geojsFeatureStyle(row, 'selectedColor', this.options.selectedStrokeColor), '#60a5fa'),
                    fillOpacity: Math.max(this.options.selectedFillOpacity, 0.08),
                }];
            }
            if (['paper', 'tiledImage'].includes(row.feature.properties?.coordinateSpace)) return [];
            const geom = row.feature.geometry || {};
            const polygons = geom.type === 'Polygon'
                ? [geom.coordinates]
                : (geom.type === 'MultiPolygon' ? geom.coordinates : (pointSubtypePolygon(geom) ? [pointSubtypePolygon(geom)] : []));
            return polygons
                .filter((polygon) => Array.isArray(polygon) && polygon[0]?.length > 2)
                .map((polygon) => ({
                    sourceRow: row,
                    outer: closeRing(polygon[0]).map((coord) => this._featureCoordinateToMapGcs(row, coordinateToPoint(coord))),
                    inner: polygon.slice(1).map((ring) => closeRing(ring).map((coord) => this._featureCoordinateToMapGcs(row, coordinateToPoint(coord)))),
                    ...this._commonStyle(row),
                }));
        });
    }

    _commonStyle(row) {
        const selected = this._rowIsSelected(row);
        const peerColor = row?.directEmbedding && this._peerSelectionColors?.get(String(this._embeddingRowId(row)));
        const presenceColor = selected && row?.directEmbedding ? this._embeddingOwnColor : peerColor;
        const directEmbedding = Boolean(row?.directEmbedding && !row?.directEmbeddingOverview);
        const fillOpacity = finiteNumber(geojsFeatureStyle(row, 'fillOpacity', this.options.fillOpacity), this.options.fillOpacity);
        const styleStrokeOpacity = directEmbedding && this._embeddingGridLineStyle.strokeOpacity !== null
            ? this._embeddingGridLineStyle.strokeOpacity
            : geojsFeatureStyle(row, 'strokeOpacity', this.options.strokeOpacity);
        const strokeOpacity = finiteNumber(styleStrokeOpacity, this.options.strokeOpacity);
        const styleStrokeWidth = directEmbedding && this._embeddingGridLineStyle.strokeWidth !== null
            ? this._embeddingGridLineStyle.strokeWidth
            : geojsFeatureStyle(row, 'strokeWidth', this.options.lineWidth);
        const rawStrokeWidth = finiteNumber(styleStrokeWidth, this.options.lineWidth);
        const markerCircle = row?.feature?.properties?.marker === 'circle'
            || (row?.feature?.geometry?.type === 'Point' && !row?.feature?.geometry?.properties?.subtype);
        // Use the feature's logical stroke width for live-session parity. Previously
        // non-marker annotations were capped at options.lineWidth (0.75), so joiners
        // saw much thinner/smaller objects than the controller.
        const pointText = row?.feature?.geometry?.properties?.subtype?.toLowerCase() === 'pointtext';
        const strokeWidth = pointText ? Math.max(0, rawStrokeWidth) : row?.directEmbeddingOverview || directEmbedding
            ? rawStrokeWidth
            : markerCircle
                ? Math.min(Math.max(rawStrokeWidth, 0.5), 8)
                : Math.min(Math.max(rawStrokeWidth, 0.35), 12);
        const selectedDirectEmbedding = (selected || Boolean(peerColor)) && directEmbedding;
        const liveAnnotation = this._rowIsLiveSessionAnnotation(row);
        // Live annotations keep the synced stroke width even when selected so
        // controller/follower sizes stay identical.
        const selectedPaperFeature = selected && !directEmbedding && !liveAnnotation;
        const selectedFeature = selectedPaperFeature || selectedDirectEmbedding;
        return {
            fillColor: colorToGeoJS(geojsFeatureStyle(row, 'fillColor', '#3b82f6'), '#3b82f6'),
            fillOpacity: selected && !liveAnnotation ? Math.max(fillOpacity, this.options.selectedFillOpacity) : fillOpacity,
            strokeColor: selectedFeature ? colorToGeoJS(presenceColor || geojsFeatureStyle(row, 'selectedColor', this.options.selectedStrokeColor), '#60a5fa') : colorToGeoJS(geojsFeatureStyle(row, 'strokeColor', '#1f2937'), '#1f2937'),
            strokeOpacity: selectedFeature ? Math.max(strokeOpacity, this.options.selectedStrokeOpacity) : strokeOpacity,
            strokeWidth: selectedFeature ? Math.max(strokeWidth, this.options.selectedLineWidth) : strokeWidth,
        };
    }

    _featureCoordinateToMapGcs(row, point) {
        if (this._usesDisplayCoordinates()) {
            return this._featureCoordinateToDisplay(row, point) || { x: NaN, y: NaN };
        }

        const mapped = this._featureCoordinateToImage(row, point);
        if (mapped) return mapped;
        return ['paper', 'tiledImage'].includes(row?.feature?.properties?.coordinateSpace)
            ? { x: NaN, y: NaN }
            : point;
    }

    _featureCoordinateToDisplay(row, point) {
        const key = Number(point.x) + ',' + Number(point.y);
        const cache = this._displayPointCache(row);
        if (cache.has(key)) return cache.get(key);

        const coordinateSpace = row?.feature?.properties?.coordinateSpace;
        let displayPoint;
        if (row?.directEmbedding || row?.directEmbeddingOverview) {
            displayPoint = !this._usesDisplayCoordinates() && this._map?.gcsToDisplay
                ? this._map.gcsToDisplay(point)
                : this._layoutPointToDisplay(row, point);
        } else if (coordinateSpace === 'tiledImage') {
            displayPoint = this._tiledImagePointToDisplay(row, point);
        } else if (coordinateSpace === 'paper') {
            displayPoint = this._paperPointToDisplay(point);
        } else {
            displayPoint = this._imagePixelPointToDisplay(row, point);
        }
        cache.set(key, displayPoint);
        return displayPoint;
    }

    _featureCoordinateToImage(row, point) {
        const coordinateSpace = row?.feature?.properties?.coordinateSpace;
        if (coordinateSpace === 'tiledImage') {
            return this._tiledImagePointToImage(row, point);
        }
        if (coordinateSpace === 'paper') {
            return this._paperPointToImage(point);
        }
        // Embeddings already store layout-space coordinates. Slide annotations are
        // level-0 pixels of one image, while the map origin includes the label gap.
        if (coordinateSpace === 'image' || row?.directEmbedding || row?.directEmbeddingOverview) {
            return point;
        }
        return this._tiledImagePointToImage(row, point) || point;
    }

    _refreshTiledImageCache() {
        const world = this.viewer?.world;
        const count = Number(world?.getItemCount?.() ?? world?._items?.length ?? 0);
        if (count === this._worldItemCount && this._tiledImageByFileId?.size) {
            return;
        }
        this._worldItemCount = count;
        this._tiledImageByFileId = new Map();
        for (let i = 0; i < count; i += 1) {
            const item = world.getItemAt?.(i) ?? world._items?.[i];
            const itemFileId = finiteNumber(
                item?.wsvvFileId
                ?? item?.file?.id
                ?? item?.source?.file?.id
                ?? item?.source?.file_id
                ?? item?.source?.fileId
                ?? item?.tileSource?.file_id,
                null,
            );
            if (itemFileId !== null) {
                this._tiledImageByFileId.set(itemFileId, item);
            }
        }
    }

    _tiledImageForRow(row) {
        const existing = row?.paperItem?.data?.tiledImage;
        if (existing) return existing;

        const props = row?.feature?.properties || {};
        const fileId = finiteNumber(
            props.wsifileId
            ?? props.wsifile_id
            ?? row?.paperItem?.data?.wsifileId,
            null,
        );
        return this._tiledImageForFileId(fileId) || row?.paperItem?.layer?.tiledImage || this._soleTiledImage();
    }

    _layoutBoundsForTiledImage(row, tiledImage) {
        const explicit = tiledImage?.layoutBounds;
        if (finiteRect(explicit)) return explicit;

        const props = row?.feature?.properties || {};
        const fileId = finiteNumber(
            row?.paperItem?.data?.wsifileId
            ?? props.wsifileId
            ?? props.wsifile_id
            ?? tiledImage?.file?.id
            ?? tiledImage?.source?.file?.id
            ?? tiledImage?.source?.file_id
            ?? tiledImage?.source?.fileId,
            null,
        );
        const layout = fileId !== null
            ? this.viewer?.__wsvvTileLayoutsByFileId?.get?.(fileId)
            : null;
        if (finiteRect(layout)) return layout;

        const index = finiteNumber(tiledImage?.index, null);
        const indexedLayout = index !== null ? this.viewer?.__wsvvTileLayouts?.[index] : null;
        return finiteRect(indexedLayout) ? indexedLayout : null;
    }

    _tiledImagePointToImage(row, point) {
        const tiledImage = this._tiledImageForRow(row);
        const layoutBounds = this._layoutBoundsForTiledImage(row, tiledImage);
        const sourceSize = tiledImage?.getContentSize?.();
        const sourceWidth = finiteNumber(sourceSize?.x || tiledImage?.source?.width || layoutBounds?.width, null);
        const sourceHeight = finiteNumber(sourceSize?.y || tiledImage?.source?.height || layoutBounds?.height, null);
        if (layoutBounds && sourceWidth && sourceHeight) {
            return {
                x: Number(layoutBounds.x || 0) + Number(point.x || 0) * Number(layoutBounds.width || sourceWidth) / sourceWidth,
                y: Number(layoutBounds.y || 0) + Number(point.y || 0) * Number(layoutBounds.height || sourceHeight) / sourceHeight,
            };
        }

        const viewportPoint = tiledImage?.imageToViewportCoordinates?.(Number(point.x || 0), Number(point.y || 0), true);
        const scaleBase = this._layoutScaleBase();
        if (viewportPoint && scaleBase) {
            return {
                x: viewportPoint.x * scaleBase,
                y: viewportPoint.y * scaleBase,
            };
        }

        return null;
    }

    _paperPointToImage(point) {
        const scaleFactor = finiteNumber(this.toolkit?.overlay?.scaleFactor, 1);
        if (!scaleFactor || scaleFactor <= 0) return null;
        return {
            x: Number(point.x || 0) / scaleFactor,
            y: Number(point.y || 0) / scaleFactor,
        };
    }

    _layoutPointToImagePoint(row, point) {
        const sourceRow = row?._geojsDisplaySourceRow || row;
        const tiledImage = this._tiledImageForRow(sourceRow) || this._tiledImageForRow(row);
        const layoutBounds = this._layoutBoundsForTiledImage(sourceRow, tiledImage) || this._layoutBoundsForTiledImage(row, tiledImage);
        const sourceSize = tiledImage?.getContentSize?.();
        const sourceWidth = finiteNumber(sourceSize?.x || tiledImage?.source?.width || layoutBounds?.width, null);
        const sourceHeight = finiteNumber(sourceSize?.y || tiledImage?.source?.height || layoutBounds?.height, null);
        if (!layoutBounds || !sourceWidth || !sourceHeight || !layoutBounds.width || !layoutBounds.height) {
            return null;
        }
        return {
            x: (Number(point.x || 0) - Number(layoutBounds.x || 0)) * sourceWidth / Number(layoutBounds.width),
            y: (Number(point.y || 0) - Number(layoutBounds.y || 0)) * sourceHeight / Number(layoutBounds.height),
        };
    }

    _layoutPointToDisplay(row, point) {
        const sourceRow = row?._geojsDisplaySourceRow || row;
        const tiledImage = this._tiledImageForRow(sourceRow) || this._tiledImageForRow(row);
        const imagePoint = this._layoutPointToImagePoint(row, point);
        if (tiledImage && imagePoint) {
            return this._tiledImagePointToDisplay(sourceRow, imagePoint);
        }
        return this._imagePointToDisplay(point);
    }

    _tiledImagePointToDisplay(row, point) {
        const paperPoint = new this.toolkit.paperScope.Point(point.x, point.y);
        const tiledImage = this._tiledImageForRow(row);
        const layer = tiledImage?._paperLayerMap?.get?.(this.toolkit.paperScope)
            || row?.paperItem?.layer
            || row?.paperItem?.parent;
        if (layer?.matrix?.transform) {
            return this._projectPointToDisplay(layer.matrix.transform(paperPoint));
        }

        const viewportPoint = tiledImage?.imageToViewportCoordinates?.(Number(point.x || 0), Number(point.y || 0), true);
        let windowPoint = null;
        if (viewportPoint && this.viewer.viewport.viewportToWindowCoordinates) {
            windowPoint = this.viewer.viewport.viewportToWindowCoordinates(viewportPoint, true);
        } else if (viewportPoint && this.viewer.viewport.pixelFromPoint) {
            const pixelPoint = this.viewer.viewport.pixelFromPoint(viewportPoint, true);
            const viewerRect = this.viewer.canvas.getBoundingClientRect();
            windowPoint = {
                x: viewerRect.left + pixelPoint.x,
                y: viewerRect.top + pixelPoint.y,
            };
        } else if (tiledImage?.imageToWindowCoordinates) {
            windowPoint = tiledImage.imageToWindowCoordinates(Number(point.x || 0), Number(point.y || 0));
        }
        if (!windowPoint) return null;
        const overlayRect = this.element.getBoundingClientRect();
        return {
            x: windowPoint.x - overlayRect.left,
            y: windowPoint.y - overlayRect.top,
        };
    }

    _paperPointToDisplay(point) {
        const paperPoint = new this.toolkit.paperScope.Point(point.x, point.y);
        return this._projectPointToDisplay(paperPoint);
    }

    _projectPointToDisplay(projectPoint) {
        const viewPoint = this.toolkit.paperScope.view.projectToView(projectPoint);
        const {paperRect, overlayRect} = this._frameRects();
        return {
            x: viewPoint.x + paperRect.left - overlayRect.left,
            y: viewPoint.y + paperRect.top - overlayRect.top,
        };
    }

    _soleTiledImage() {
        const world = this.viewer?.world;
        const count = Number(world?.getItemCount?.() ?? 0);
        if (count !== 1) return null;
        return world.getItemAt?.(0) || null;
    }

    _imagePixelPointToDisplay(row, point) {
        const x = Number(point?.x);
        const y = Number(point?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return this._imagePointToDisplay(point);

        const tiledImage = this._tiledImageForRow(row)
            || row?.paperItem?.layer?.tiledImage
            || this._soleTiledImage();
        const viewportPoint = tiledImage?.imageToViewportCoordinates?.(x, y, true);
        const overlayPoint = this._viewportPointToOverlay(viewportPoint);
        if (overlayPoint) return overlayPoint;

        const layout = this._layoutBoundsForTiledImage(row, tiledImage);
        const sourceSize = tiledImage?.getContentSize?.();
        const sourceWidth = finiteNumber(sourceSize?.x || tiledImage?.source?.width || layout?.width, null);
        const sourceHeight = finiteNumber(sourceSize?.y || tiledImage?.source?.height || layout?.height, null);
        if (layout && sourceWidth && sourceHeight) {
            return this._imagePointToDisplay({
                x: Number(layout.x || 0) + x * Number(layout.width || sourceWidth) / sourceWidth,
                y: Number(layout.y || 0) + y * Number(layout.height || sourceHeight) / sourceHeight,
            });
        }
        return this._imagePointToDisplay(point);
    }

    _viewportPointToOverlay(viewportPoint) {
        if (!viewportPoint || !Number.isFinite(viewportPoint.x) || !Number.isFinite(viewportPoint.y)) return null;
        let windowPoint = null;
        if (this.viewer?.viewport?.viewportToWindowCoordinates) {
            windowPoint = this.viewer.viewport.viewportToWindowCoordinates(viewportPoint, true);
        } else if (this.viewer?.viewport?.pixelFromPoint) {
            const pixelPoint = this.viewer.viewport.pixelFromPoint(viewportPoint, true);
            const viewerRect = this.viewer.canvas.getBoundingClientRect();
            windowPoint = {
                x: viewerRect.left + pixelPoint.x,
                y: viewerRect.top + pixelPoint.y,
            };
        }
        if (!windowPoint || !Number.isFinite(windowPoint.x) || !Number.isFinite(windowPoint.y)) return null;
        const overlayRect = this.element.getBoundingClientRect();
        return {
            x: windowPoint.x - overlayRect.left,
            y: windowPoint.y - overlayRect.top,
        };
    }

    _imagePointToDisplay(point) {
        const scaleBase = this._layoutScaleBase();
        const viewportPoint = scaleBase
            ? new OpenSeadragon.Point(point.x / scaleBase, point.y / scaleBase)
            : new OpenSeadragon.Point(point.x, point.y);
        let windowPoint = null;
        if (scaleBase && this.viewer.viewport.viewportToWindowCoordinates) {
            windowPoint = this.viewer.viewport.viewportToWindowCoordinates(viewportPoint, true);
        } else if (scaleBase && this.viewer.viewport.pixelFromPoint) {
            const pixelPoint = this.viewer.viewport.pixelFromPoint(viewportPoint, true);
            const viewerRect = this.viewer.canvas.getBoundingClientRect();
            windowPoint = {
                x: viewerRect.left + pixelPoint.x,
                y: viewerRect.top + pixelPoint.y,
            };
        } else {
            windowPoint = this.viewer.viewport.imageToWindowCoordinates(viewportPoint);
        }
        const overlayRect = this.element.getBoundingClientRect();
        return {
            x: windowPoint.x - overlayRect.left,
            y: windowPoint.y - overlayRect.top,
        };
    }

    _refreshPaperItemCache() {
        this._paperItems = this.toolkit.getFeatures();
        return this._paperItems;
    }

    _indexFeatureRows() {
        this._rowByPaperItem = new Map();
        this._rowById = new Map();
        this._featureRows.forEach((row) => {
            this._rowById.set(row.id, row);
            if (row.paperItem) {
                this._rowByPaperItem.set(row.paperItem, row);
            }
        });
    }

    _findPaperItem(row) {
        if (row?.paperItem && !row.paperItem.removed) return row.paperItem;
        if (row?.directEmbedding) return null;
        const items = this._paperItems.length ? this._paperItems : this._refreshPaperItemCache();
        const targetKey = row?.feature?.id ?? row?.feature?.properties?.id ?? row?.feature?.properties?.label;
        if (targetKey == null) return null;
        return items.find((item, index) => paperFeatureKey(item, index) === targetKey) || null;
    }

    _tiledImageForFileId(fileId) {
        const target = finiteNumber(fileId, null);
        if (target === null) return null;
        this._refreshTiledImageCache();
        return this._tiledImageByFileId.get(target) || null;
    }

    _createPaperItemForRow(row) {
        if (!row || row.paperItem) return row?.paperItem || null;
        const props = row.feature?.properties || {};
        if (!props.wsvvEmbeddingGrid) return null;
        const bounds = props.geojsImageBounds;
        const values = [bounds?.left, bounds?.top, bounds?.width, bounds?.height].map(Number);
        if (!values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) return null;

        const tiledImage = this._tiledImageForFileId(props.wsifileId);
        if (!tiledImage) return null;

        const [left, top, width, height] = values;
        const paperItem = new this.toolkit.paperScope.Path.Rectangle({
            point: [left, top],
            size: [width, height],
            strokeWidth: finiteNumber(props.strokeWidth, this.options.lineWidth),
            embedding_id: props.embedding_id ?? row.id,
        });
        paperItem.data = paperItem.data || {};
        paperItem.data.wsvvEmbeddingGrid = true;
        paperItem.data.wsvvLazyGeoJSPaperItem = true;
        paperItem.data.embeddingRenderKey = props.embedding_id ?? row.id;
        paperItem.data.wsifileId = finiteNumber(props.wsifileId, null);
        paperItem.data.geojsImageBounds = { left, top, width, height };
        paperItem.data.tiledImage = tiledImage;
        paperItem.style.strokeColor = styleValueToCSS(props.strokeColor, '#1f2937');
        paperItem.style.strokeWidth = finiteNumber(props.strokeWidth, this.options.lineWidth);
        if (paperItem.style.strokeColor) {
            paperItem.style.strokeColor.alpha = finiteNumber(props.strokeOpacity, this.options.strokeOpacity);
        }
        paperItem.selectedColor = styleValueToCSS(props.selectedColor, this.options.selectedStrokeColor);
        if (props.group !== undefined) paperItem.group = props.group;
        if (props.label !== undefined) paperItem.label = props.label;
        paperItem.isGeoJSONFeature = true;

        tiledImage.addPaperItem?.(paperItem);
        if (!paperItem.parent && tiledImage.paperLayer) {
            tiledImage.paperLayer.addChild(paperItem);
        }
        row.paperItem = paperItem;
        this._rowByPaperItem.set(paperItem, row);
        this._paperItems = this._refreshPaperItemCache();
        this.toolkit.overlay?.__wsvvVisibleEmbeddingItems?.set?.(paperItem.data.embeddingRenderKey, paperItem);
        return paperItem;
    }

    _removeLazyPaperItem(item, row = null) {
        if (!item?.data?.wsvvLazyGeoJSPaperItem || item.selected || item === this._activePaperItem) return;
        const key = item.data.embeddingRenderKey ?? item.embedding_id;
        if (row) row.paperItem = null;
        this._rowByPaperItem.delete(item);
        this.toolkit.overlay?.__wsvvVisibleEmbeddingItems?.delete?.(key);
        item.remove();
        this._paperItems = this._refreshPaperItemCache();
    }

    _rowMatchesPaperItem(row, item) {
        if (!item) return false;
        const features = this._paperItems.length ? this._paperItems : this._refreshPaperItemCache();
        const index = features.indexOf(item);
        const targetKey = row.feature.id ?? row.feature.properties?.id ?? row.feature.properties?.label;
        return targetKey != null && paperFeatureKey(item, index) === targetKey;
    }

    _attachPaperItemsToRows(rows = this._featureRows, items = this._paperItems.length ? this._paperItems : this._refreshPaperItemCache()) {
        const keyedItems = new Map();
        items.forEach((item, index) => {
            const key = paperFeatureKey(item, index);
            if (key != null && !keyedItems.has(key)) keyedItems.set(key, item);
        });
        rows.forEach((row) => {
            const key = row.id
                ?? row.feature?.id
                ?? row.feature?.properties?.userdata?.object_id
                ?? row.feature?.properties?.id
                ?? row.feature?.properties?.userdata?.id;
            const paperItem = (key != null ? keyedItems.get(key) : null) || null;
            row.paperItem = paperItem;
            if (!paperItem) return;
            // Redux geometry and styles are authoritative. Paper may still be
            // catching up with a remote update and must not overwrite the row.
            if (this.toolkit.dataStore?.reduxEnabled) return;
            // Keep GeoJS style/geometry aligned with live Paper (source of truth).
            try {
                const live = paperItemToFeature(paperItem, key);
                if (!live?.geometry) return;
                row.feature = {
                    ...row.feature,
                    id: row.feature?.id ?? live.id ?? key,
                    geometry: live.geometry,
                    properties: {
                        ...(row.feature?.properties || {}),
                        ...(live.properties || {}),
                        id: row.feature?.properties?.id ?? live.properties?.id ?? key,
                        userdata: {
                            ...(row.feature?.properties?.userdata || {}),
                            ...(live.properties?.userdata || {}),
                            object_id: row.feature?.properties?.userdata?.object_id
                                || live.properties?.userdata?.object_id
                                || key,
                        },
                    },
                };
            } catch {
                // Leave store feature if Paper export fails.
            }
        });
    }

    _appendLivePaperRows(rows, items = this._paperItems.length ? this._paperItems : this._refreshPaperItemCache()) {
        const nextRows = [...rows];
        const representedItems = new Set(nextRows.map((row) => row.paperItem).filter(Boolean));
        const collection = {
            type: 'FeatureCollection',
            label: 'Live Paper items',
            properties: { defaultStyle: {} },
            features: [],
        };
        const collectionIndex = rows.length ? Math.max(...rows.map((row) => row.collectionIndex)) + 1 : 0;

        items.forEach((item, index) => {
            if (representedItems.has(item) || item?.data?.wsvvLazyGeoJSPaperItem) return;
            const id = paperFeatureKey(item, 'paper:' + index);
            const feature = paperItemToFeature(item, id);
            if (!feature) return;
            collection.features.push(feature);
            nextRows.push({
                id: feature.id ?? id,
                collectionIndex,
                featureIndex: collection.features.length - 1,
                globalFeatureIndex: index,
                collection,
                feature,
                paperItem: item,
            });
            representedItems.add(item);
        });

        return nextRows;
    }

    _embeddingRowId(row) {
        return normalizeEmbeddingId(row?.id ?? row?.feature?.properties?.embedding_id ?? row?.feature?.properties?.id);
    }

    _isSelectableRow(row) {
        return Boolean(row?.directEmbedding && !row?.directEmbeddingOverview && this._embeddingRowId(row) !== null);
    }

    _rowIsSelected(row) {
        if (row?.directEmbedding && !row.paperItem) {
            const id = this._embeddingRowId(row);
            return id !== null && this._selectedEmbeddingIds.has(id);
        }
        return !!this._findPaperItem(row)?.selected;
    }

    _paperItemShouldRender(item) {
        return !!item && (item === this._activePaperItem || item.selected);
    }

    _rowIsLiveSessionAnnotation(row, item = null) {
        const paperItem = item || this._findPaperItem(row);
        if (row?.directEmbedding || paperItem?.data?.wsvvEmbeddingGrid) return false;
        return Boolean(
            paperItem?.data?.userdata?.object_id
            || row?.feature?.properties?.userdata?.object_id,
        );
    }

    _rowShouldRenderInGeoJS(row) {
        if (row?.collection?.properties?.hidden || row?.feature?.properties?.hidden) return false;
        if (!this._supportsGeoJSGeometry(row.feature)) return false;
        if (row?.directEmbedding) {
            return !this._embeddingGridLineStyle.hide_unselected || this._rowIsSelected(row)
                || Boolean(this._peerSelectionColors?.has(String(this._embeddingRowId(row))));
        }
        // Every annotation uses the same selection handoff on every client.
        return !this._paperItemShouldRender(this._findPaperItem(row));
    }

    _syncPaperSelectionState(item = null) {
        const activeItem = this._activePaperItem;
        if (activeItem && !activeItem.selected) {
            this._activePaperItem = null;
        }

        if (!item && !activeItem) {
            this._visibleFeatureIds = new Set(
                this._featureRows
                    .filter((row) => this._rowShouldRenderInGeoJS(row))
                    .map((row) => row.id),
            );
            this._syncPaperVisibilityForSelection();
            this._markRenderDataDirty();
            this.scheduleUpdate();
            return;
        }

        Array.from(new Set([item, activeItem].filter(Boolean))).forEach((paperItem) => {
            let row = this._rowByPaperItem.get(paperItem);
            if (!row) {
                row = this._featureRows.find((candidate) => this._rowMatchesPaperItem(candidate, paperItem)) || null;
                if (row) {
                    row.paperItem = paperItem;
                    this._rowByPaperItem.set(paperItem, row);
                }
            }
            if (row) {
                this._ensureVisibleFeatureIdSet();
                if (this._rowShouldRenderInGeoJS(row)) {
                    this._visibleFeatureIds.add(row.id);
                } else {
                    this._visibleFeatureIds.delete(row.id);
                }
            } else if (!this._paperItemShouldRender(paperItem)) {
                this._visibleFeatureIds = new Set(
                    this._featureRows
                        .filter((candidate) => this._rowShouldRenderInGeoJS(candidate))
                        .map((candidate) => candidate.id),
                );
            }
            this._removeLazyPaperItem(paperItem, row);
        });
        this._syncPaperVisibilityForSelection();
        this._markRenderDataDirty();
        this.scheduleUpdate();
    }

    _hasGeoJSRowForPaperItem(item) {
        if (!item) return false;
        const matched = this._rowByPaperItem.get(item);
        if (matched) return this._supportsGeoJSGeometry(matched.feature);
        return this._featureRows.some((row) => (
            this._supportsGeoJSGeometry(row.feature) && (row?.paperItem === item || this._rowMatchesPaperItem(row, item))
        ));
    }

    _supportsGeoJSGeometry(feature) {
        const geometry = feature?.geometry;
        return geometry?.type !== 'GeometryCollection' && geometry?.properties?.subtype !== 'Measurement';
    }

    _setLivePaperPaintHidden(item, hidden) {
        if (!item) return;
        item.data = item.data || {};
        const applyHidden = (target) => {
            if (!target) return;
            if (hidden) {
                if (target.data?._wsvvLivePaintStyle == null) {
                    target.data = target.data || {};
                    target.data._wsvvLivePaintStyle = {
                        opacity: target.opacity == null ? 1 : target.opacity,
                        strokeOpacity: target.strokeOpacity,
                        fillOpacity: target.fillOpacity,
                    };
                }
                target.opacity = 0;
                target.strokeOpacity = 0;
                target.fillOpacity = 0;
                if (target.style) {
                    target.style.strokeOpacity = 0;
                    target.style.fillOpacity = 0;
                }
            } else if (target.data?._wsvvLivePaintStyle) {
                const saved = target.data._wsvvLivePaintStyle;
                target.opacity = saved.opacity;
                if (saved.strokeOpacity != null) target.strokeOpacity = saved.strokeOpacity;
                if (saved.fillOpacity != null) target.fillOpacity = saved.fillOpacity;
                if (target.style) {
                    if (saved.strokeOpacity != null) target.style.strokeOpacity = saved.strokeOpacity;
                    if (saved.fillOpacity != null) target.style.fillOpacity = saved.fillOpacity;
                }
                delete target.data._wsvvLivePaintStyle;
            }
        };
        applyHidden(item);
        (item.children || []).forEach((child) => applyHidden(child));
    }

    /**
     * Hand a Paper annotation off to GeoJS immediately so the controller and
     * followers both paint the same screen-pixel sized feature.
     */
    promoteLivePaperItem(item) {
        if (!item?.data?.userdata?.object_id) return false;
        this._paperItems = this._refreshPaperItemCache();
        this._refreshFeatureRows();
        this._setLivePaperPaintHidden(item, false);
        this._setPaperItemVisible(item, this._paperItemShouldRender(item));
        this._syncPaperVisibilityForSelection();
        this.requestViewportUpdate({force: true});
        this.paperScope?.view?.update?.();
        return true;
    }

    _syncPaperVisibilityForSelection() {
        if (!this.options.hidePaperItems) return;
        const items = this._paperItems.length ? this._paperItems : this._refreshPaperItemCache();
        if (!items.length) return;
        items.forEach((item) => {
            if (item?.data?.wsvvEmbeddingGrid || item?.data?.wsvvLazyGeoJSPaperItem) {
                this._setPaperItemVisible(item, false);
                return;
            }
            const selected = this._paperItemShouldRender(item);
            const handedOffToGeoJS = this._hasGeoJSRowForPaperItem(item);
            // Visibility is renderer state. Mutating opacity here leaked zero
            // stroke opacity into exported GeoJSON, Redux, and other clients.
            this._setLivePaperPaintHidden(item, false);
            if (selected) {
                this._setPaperItemVisible(item, true);
                return;
            }
            // Keep Paper only when GeoJS has no row yet (brief window mid-create).
            this._setPaperItemVisible(item, !handedOffToGeoJS);
        });
    }

    _rowImageBounds(row) {
        const geom = row.feature.geometry || {};
        let coords = [];
        if (geom.type === 'Point' && pointSubtypePolygon(geom)) {
            coords = pointSubtypePolygon(geom);
        } else {
            coords = geom.coordinates || [];
        }
        const points = [];
        const collect = (value) => {
            if (!Array.isArray(value)) return;
            if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
                points.push({ x: value[0], y: value[1] });
                return;
            }
            value.forEach(collect);
        };
        collect(coords);
        if (!points.length) return null;
        return points.reduce((bounds, point) => ({
            minX: Math.min(bounds.minX, point.x),
            minY: Math.min(bounds.minY, point.y),
            maxX: Math.max(bounds.maxX, point.x),
            maxY: Math.max(bounds.maxY, point.y),
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    }

    _boundsMatchRectangle(bounds, rect, onlyFullyContained) {
        if (onlyFullyContained) {
            return bounds.minX >= rect.minX && bounds.maxX <= rect.maxX && bounds.minY >= rect.minY && bounds.maxY <= rect.maxY;
        }
        return bounds.maxX >= rect.minX && bounds.minX <= rect.maxX && bounds.maxY >= rect.minY && bounds.minY <= rect.maxY;
    }

    _activeToolUsesGeoJSSelection() {
        return !!this.toolkit?.paperScope?.getActiveTool?.()?.usesGeoJSDisplaySelection;
    }

    _hideInactivePaperItems() {
        this._syncPaperVisibilityForSelection();
    }

    _setPaperItemVisible(item, visible) {
        if (!item) return;
        if (!this._paperVisibility.has(item)) {
            this._paperVisibility.set(item, item.visible);
        }
        if (item.visible !== visible) {
            item.visible = visible;
        }
    }

    _restorePaperVisibility() {
        this._paperVisibility.forEach((visible, item) => {
            item.visible = visible;
        });
        this._paperVisibility.clear();
    }
}

export {
    DEFAULT_DISPLAY_OPTIONS,
    GeoJSDisplay,
    closeRing,
    flattenFeatureCollections,
};
