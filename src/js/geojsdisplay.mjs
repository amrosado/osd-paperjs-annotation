import { OpenSeadragon } from './osd-loader.mjs';
import { geo, map as GeoMap, util as geoUtil } from './geojs-loader.mjs';

const GEOJS_DISPLAY_Z_INDEX = '1';
const PAPER_OVERLAY_Z_INDEX = '2';

const DEFAULT_DISPLAY_OPTIONS = Object.freeze({
    enabled: false,
    renderer: 'webgl',
    hidePaperItems: true,
    editOn: 'click',
    pointRadius: 5,
    lineWidth: 0.75,
    fillOpacity: 0,
    strokeOpacity: 1,
    selectedPointRadius: 7,
    selectedLineWidth: 1.5,
    selectedStrokeColor: '#60a5fa',
    selectedStrokeOpacity: 1,
    selectedFillOpacity: 0,
    renderMargin: 256,
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
            const id = feature.id
                ?? feature.properties?.id
                ?? `${collection.label || collectionIndex}:${feature.properties?.label || featureIndex}`;
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
    return item?.annotationItem?.toGeoJSONFeature?.()?.id
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
            return {
                ...feature,
                id: feature.id ?? id,
                properties: {
                    ...(feature.properties || {}),
                    id: feature.properties?.id ?? feature.id ?? id,
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
        this._paperItems = [];
        this._rowByPaperItem = new Map();
        this._rowById = new Map();
        this._visibleFeatureIds = new Set();
        this._unsubscribeStore = null;
        this._viewerHandlers = [];
        this._projectHandlers = [];
        this._domHandlers = [];

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
        this._map?.exit?.();
        this.element?.remove();
    }

    setVisible(visible) {
        this.element.style.display = visible ? '' : 'none';
        if (visible) {
            this._hideInactivePaperItems();
            this.scheduleUpdate();
        } else {
            this._restorePaperVisibility();
        }
    }

    syncFromStore() {
        const rows = flattenFeatureCollections(this.toolkit.dataStore.toGeoJSON());
        const paperItems = this._refreshPaperItemCache();
        this._attachPaperItemsToRows(rows, paperItems);
        this._featureRows = this._appendLivePaperRows(rows, paperItems);
        this._indexFeatureRows();
        this._visibleFeatureIds = new Set(
            this._featureRows
                .filter((row) => this._rowShouldRenderInGeoJS(row))
                .map((row) => row.id),
        );
        this._syncPaperVisibilityForSelection();
        this.scheduleUpdate();
    }

    enterPaperEdit(row) {
        const paperItem = this._findPaperItem(row);
        if (!paperItem) return null;
        if (this._activePaperItem && this._activePaperItem !== paperItem) {
            this._setPaperItemVisible(this._activePaperItem, false);
            this._activePaperItem.deselect?.(true);
        }
        this._activePaperItem = paperItem;
        this._visibleFeatureIds.delete(row.id);
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

    requestViewportUpdate() {
        if (this.destroyed) return;
        if (!this.options.immediateViewportUpdates) {
            this.scheduleUpdate();
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
        this._isUpdating = true;
        try {
        const { width, height } = getViewerSize(this.viewer);
        if (this._width !== width || this._height !== height) {
            this._width = width;
            this._height = height;
            this.element.style.width = `${width}px`;
            this.element.style.height = `${height}px`;
            this._map.size?.({ width, height });
            this._map.zoom?.(0);
            this._map.center?.({ x: width / 2, y: height / 2 });
        }

        this._map.zoom?.(0);
        this._map.center?.({ x: width / 2, y: height / 2 });

        const rows = this._visibleRowsForRender(this._featureRows.filter((row) => this._visibleFeatureIds.has(row.id)));
        this._pointFeature.data(this._pointRows(rows));
        this._lineFeature.data(this._lineRows(rows));
        this._polygonFeature.data(this._polygonRows(rows));
        this._map.draw();
        } finally {
            this._isUpdating = false;
        }
    }

    _createOverlay() {
        const { width, height } = getViewerSize(this.viewer);
        this._width = width;
        this._height = height;
        this.element = document.createElement('div');
        this.element.className = 'geojs-display-overlay';
        Object.assign(this.element.style, {
            position: 'absolute',
            left: '0',
            top: '0',
            width: `${width}px`,
            height: `${height}px`,
            pointerEvents: 'none',
            zIndex: GEOJS_DISPLAY_Z_INDEX,
        });
        this.viewer.canvas.appendChild(this.element);
        this._raisePaperOverlaysAboveGeoJS();

        const params = geoUtil.pixelCoordinateParams(this.element, width, height);
        this._map = GeoMap({
            ...params.map,
            node: this.element,
            interactor: null,
            clampZoom: false,
            zoom: 0,
            center: { x: width / 2, y: height / 2 },
        });
        this._layer = this._map.createLayer('feature', {
            renderer: this.options.renderer,
            features: ['point', 'line', 'polygon'],
        });
    }

    _raisePaperOverlaysAboveGeoJS() {
        const overlays = this.viewer.PaperOverlays || [];
        overlays.forEach((overlay) => {
            if (!overlay?._canvasdiv) return;
            overlay._canvasdiv.style.zIndex = PAPER_OVERLAY_Z_INDEX;
            this.viewer.canvas.appendChild(overlay._canvasdiv);
        });
    }

    _createGeoJSFeatures() {
        this._pointFeature = this._layer.createFeature('point', { selectionAPI: true, gcs: null })
            .position((d) => d.position)
            .style({
                radius: featureStyleValue('radius', this.options.pointRadius),
                fillColor: featureStyleValue('fillColor', colorToGeoJS('#3b82f6', '#3b82f6')),
                fillOpacity: featureStyleValue('fillOpacity', this.options.fillOpacity),
                strokeColor: featureStyleValue('strokeColor', colorToGeoJS('#1f2937', '#1f2937')),
                strokeOpacity: featureStyleValue('strokeOpacity', this.options.strokeOpacity),
                strokeWidth: featureStyleValue('strokeWidth', this.options.lineWidth),
            });
        this._lineFeature = this._layer.createFeature('line', { selectionAPI: true, gcs: null })
            .line((d) => d.line)
            .style({
                strokeColor: featureStyleValue('strokeColor', colorToGeoJS('#1f2937', '#1f2937')),
                strokeOpacity: featureStyleValue('strokeOpacity', this.options.strokeOpacity),
                strokeWidth: featureStyleValue('strokeWidth', this.options.lineWidth),
                uniformLine: true,
            });
        this._polygonFeature = this._layer.createFeature('polygon', { selectionAPI: true, gcs: null })
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

        if (this.options.editOn === 'click') this._bindClickHitTesting();
    }

    _bindEvents() {
        this._unsubscribeStore = this.toolkit.dataStore.subscribe(() => this.syncFromStore());
        ['viewport-change', 'animation', 'animation-finish', 'resize', 'rotate', 'flip'].forEach((name) => {
            const handler = () => this.requestViewportUpdate();
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
            if (this._activeToolUsesGeoJSSelection()) return;
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
        const rect = this.viewer.canvas.getBoundingClientRect();
        const display = {
            x: nativeEvent.clientX - rect.left,
            y: nativeEvent.clientY - rect.top,
        };
        return this.hitTestRowsAtDisplayPoint(display);
    }

    hitTestRowsAtDisplayPoint(display, tolerance = this.options.hitTolerance) {
        const pointTolerance = finiteNumber(tolerance, 6);
        const rows = this._featureRows.filter((row) => this._visibleFeatureIds.has(row.id));
        return this._rowsAtDisplayPoint(rows, display, pointTolerance);
    }

    hitTestPaperItemsAtEvent(event) {
        return this.hitTestRowsAtEvent(event)
            .map((row) => this.getPaperItemForRow(row))
            .filter(Boolean);
    }

    getPaperItemForRow(row) {
        return this._findPaperItem(row);
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
            const item = this.getPaperItemForRow(row);
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

    findPaperItemsInDisplayRectangle(pointA, pointB, onlyFullyContained = false) {
        const rect = {
            minX: Math.min(pointA.x, pointB.x),
            minY: Math.min(pointA.y, pointB.y),
            maxX: Math.max(pointA.x, pointB.x),
            maxY: Math.max(pointA.y, pointB.y),
        };
        const items = [];
        const seen = new Set();
        this._featureRows
            .filter((row) => this._visibleFeatureIds.has(row.id))
            .forEach((row) => {
                const bounds = this._rowDisplayBounds(row);
                if (!bounds || !this._boundsMatchRectangle(bounds, rect, onlyFullyContained)) return;
                const item = this.getPaperItemForRow(row);
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

    _displayBoundsContainPoint(bounds, point, tolerance = 0) {
        return point.x >= bounds.minX - tolerance
            && point.x <= bounds.maxX + tolerance
            && point.y >= bounds.minY - tolerance
            && point.y <= bounds.maxY + tolerance;
    }

    _visibleRowsForRender(rows) {
        const margin = finiteNumber(this.options.renderMargin, 0);
        const viewportBounds = {
            minX: -margin,
            minY: -margin,
            maxX: this._width + margin,
            maxY: this._height + margin,
        };
        return rows.filter((row) => {
            const bounds = this._rowDisplayBounds(row);
            return !bounds || this._boundsMatchRectangle(bounds, viewportBounds, false);
        });
    }

    _rowDisplayBounds(row) {
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
            .map((point) => this._featureCoordinateToMapGcs(row, point))
            .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
        if (!displayPoints.length) return null;

        return displayPoints.reduce((bounds, point) => ({
            minX: Math.min(bounds.minX, point.x),
            minY: Math.min(bounds.minY, point.y),
            maxX: Math.max(bounds.maxX, point.x),
            maxY: Math.max(bounds.maxY, point.y),
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    }


    _pointRows(rows) {
        return rows.flatMap((row) => {
            const geom = row.feature.geometry || {};
            if (geom.type !== 'Point' || geom.properties?.subtype || !Array.isArray(geom.coordinates) || geom.coordinates.length < 2) return [];
            return [{
                sourceRow: row,
                position: this._featureCoordinateToMapGcs(row, coordinateToPoint(geom.coordinates)),
                radius: this._rowIsSelected(row) ? this.options.selectedPointRadius : geojsFeatureStyle(row, 'radius', this.options.pointRadius),
                ...this._commonStyle(row),
            }];
        });
    }

    _lineRows(rows) {
        return rows.flatMap((row) => {
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
        const fillOpacity = finiteNumber(geojsFeatureStyle(row, 'fillOpacity', this.options.fillOpacity), this.options.fillOpacity);
        const strokeOpacity = finiteNumber(geojsFeatureStyle(row, 'strokeOpacity', this.options.strokeOpacity), this.options.strokeOpacity);
        const rawStrokeWidth = finiteNumber(geojsFeatureStyle(row, 'strokeWidth', this.options.lineWidth), this.options.lineWidth);
        const strokeWidth = Math.min(rawStrokeWidth, this.options.lineWidth);
        return {
            fillColor: colorToGeoJS(geojsFeatureStyle(row, 'fillColor', '#3b82f6'), '#3b82f6'),
            fillOpacity: selected ? Math.max(fillOpacity, this.options.selectedFillOpacity) : fillOpacity,
            strokeColor: selected ? colorToGeoJS(this.options.selectedStrokeColor, '#60a5fa') : colorToGeoJS(geojsFeatureStyle(row, 'strokeColor', '#1f2937'), '#1f2937'),
            strokeOpacity: selected ? this.options.selectedStrokeOpacity : strokeOpacity,
            strokeWidth: selected ? Math.max(strokeWidth, this.options.selectedLineWidth) : strokeWidth,
        };
    }

    _featureCoordinateToMapGcs(row, point) {
        const coordinateSpace = row?.feature?.properties?.coordinateSpace;
        let displayPoint;
        if (coordinateSpace === 'tiledImage') {
            displayPoint = this._tiledImagePointToDisplay(row, point);
        } else if (coordinateSpace === 'paper') {
            displayPoint = this._paperPointToDisplay(point);
        } else {
            displayPoint = this._imagePointToDisplay(point);
        }
        return displayPoint;
    }

    _tiledImagePointToDisplay(row, point) {
        const paperPoint = new this.toolkit.paperScope.Point(point.x, point.y);
        const tiledImage = row?.paperItem?.data?.tiledImage;
        const layer = tiledImage?._paperLayerMap?.get?.(this.toolkit.paperScope)
            || row?.paperItem?.layer
            || row?.paperItem?.parent;
        const projectPoint = layer?.matrix?.transform
            ? layer.matrix.transform(paperPoint)
            : paperPoint;
        return this._projectPointToDisplay(projectPoint);
    }

    _paperPointToDisplay(point) {
        const paperPoint = new this.toolkit.paperScope.Point(point.x, point.y);
        return this._projectPointToDisplay(paperPoint);
    }

    _projectPointToDisplay(projectPoint) {
        const viewPoint = this.toolkit.paperScope.view.projectToView(projectPoint);
        const paperRect = this.toolkit.overlay._canvas.getBoundingClientRect();
        const overlayRect = this.element.getBoundingClientRect();
        return {
            x: viewPoint.x + paperRect.left - overlayRect.left,
            y: viewPoint.y + paperRect.top - overlayRect.top,
        };
    }

    _imagePointToDisplay(point) {
        const osdPoint = new OpenSeadragon.Point(point.x, point.y);
        const windowPoint = this.viewer.viewport.imageToWindowCoordinates(osdPoint);
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
        if (row?.paperItem) return row.paperItem;
        const items = this._paperItems.length ? this._paperItems : this._refreshPaperItemCache();
        const sameIndex = items[row.globalFeatureIndex];
        if (sameIndex) return sameIndex;
        const targetKey = row.feature.id ?? row.feature.properties?.id ?? row.feature.properties?.label;
        if (targetKey == null) return null;
        return items.find((item, index) => paperFeatureKey(item, index) === targetKey) || null;
    }

    _rowMatchesPaperItem(row, item) {
        if (!item) return false;
        const features = this._paperItems.length ? this._paperItems : this._refreshPaperItemCache();
        const index = features.indexOf(item);
        if (index === row.globalFeatureIndex) return true;
        const targetKey = row.feature.id ?? row.feature.properties?.id ?? row.feature.properties?.label;
        return targetKey != null && paperFeatureKey(item, index) === targetKey;
    }

    _attachPaperItemsToRows(rows = this._featureRows, items = this._paperItems.length ? this._paperItems : this._refreshPaperItemCache()) {
        const keyedItems = new Map();
        items.forEach((item, index) => {
            const key = paperFeatureKey(item, index);
            if (key != null) keyedItems.set(key, item);
        });
        rows.forEach((row) => {
            const key = row.feature.id ?? row.feature.properties?.id ?? row.feature.properties?.label;
            row.paperItem = items[row.globalFeatureIndex] || (key != null ? keyedItems.get(key) : null) || null;
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
            if (representedItems.has(item)) return;
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

    _rowIsSelected(row) {
        return !!this._findPaperItem(row)?.selected;
    }

    _paperItemShouldRender(item) {
        return !!item && (item === this._activePaperItem || item.selected);
    }

    _rowShouldRenderInGeoJS(row) {
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
            this.scheduleUpdate();
            return;
        }

        [item, activeItem].filter(Boolean).forEach((paperItem) => {
            let row = this._rowByPaperItem.get(paperItem);
            if (!row) {
                row = this._featureRows.find((candidate) => this._rowMatchesPaperItem(candidate, paperItem)) || null;
                if (row) {
                    row.paperItem = paperItem;
                    this._rowByPaperItem.set(paperItem, row);
                }
            }
            if (row) {
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
            this._setPaperItemVisible(paperItem, this._paperItemShouldRender(paperItem));
        });
        this.scheduleUpdate();
    }

    _syncPaperVisibilityForSelection() {
        if (!this.options.hidePaperItems || !this._featureRows.length) return;
        const items = this._paperItems.length ? this._paperItems : this._refreshPaperItemCache();
        items.forEach((item) => {
            this._setPaperItemVisible(item, this._paperItemShouldRender(item));
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
