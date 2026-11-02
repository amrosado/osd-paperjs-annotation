import { OpenSeadragon } from './osd-loader.mjs';
import { paper } from './paperjs.mjs';
import { PaperOverlay } from './paper-overlay.mjs';
import { map as GeoMap, util as geoUtil, event as geoEvent } from './geojs-loader.mjs';

const DEFAULT_PREFIX_URL = 'https://openseadragon.github.io/openseadragon/images/';

function finitePositive(value, fallback = 1) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function paperLayerMapDef(target) {
    if (!target.__paperLayerMap) {
        target.__paperLayerMap = new Map();
    }
    return target.__paperLayerMap;
}

function createPaperLayer(owner, paperScope) {
    const layer = new paper.Layer({ applyMatrix: false });
    paperScope.project.addLayer(layer);
    owner._paperLayerMap.set(paperScope, layer);
    return layer;
}

function addPaperItem(owner, item) {
    if (owner.paperLayer) {
        owner.paperLayer.addChild(item);
        item.applyRescale?.();
    } else {
        console.error('No layer has been set up in the active paper scope for this object.');
    }
}

function consumeNavigationEvent(event) {
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
}

function wheelZoomDelta(event) {
    const modeScale = event.deltaMode === 1 ? 0.08 : (event.deltaMode === 2 ? 0.6 : 0.002);
    return -Number(event.deltaY || 0) * modeScale;
}

function maxLevelForFile(file) {
    const info = file?.file_tile_info || {};
    return Math.max(0, Number(info.levels || 1) - 1);
}

function maxLevelForFiles(files) {
    return Math.max(0, ...(files || []).map(maxLevelForFile));
}

function tileLayerParamsForFile(file, mapMaxLevel = null) {
    const info = file?.file_tile_info || {};
    const width = finitePositive(info.sizeX);
    const height = finitePositive(info.sizeY);
    const tileWidth = finitePositive(info.tileWidth, 256);
    const tileHeight = finitePositive(info.tileHeight, tileWidth);
    const sourceMaxLevel = maxLevelForFile(file);
    const virtualMaxLevel = Math.max(sourceMaxLevel, Number.isFinite(Number(mapMaxLevel)) ? Number(mapMaxLevel) : sourceMaxLevel);
    const sourceLevelOffset = virtualMaxLevel - sourceMaxLevel;
    const params = geoUtil.pixelCoordinateParams(null, width, height, tileWidth, tileHeight);
    const sourceLevelForMapLevel = (level) => Math.max(
        0,
        Math.min(sourceMaxLevel, Math.floor(Number(level || 0) - sourceLevelOffset)),
    );

    params.map.max = virtualMaxLevel;
    params.map.unitsPerPixel = Math.pow(2, virtualMaxLevel);
    params.layer.minLevel = sourceLevelOffset;
    params.layer.maxLevel = virtualMaxLevel;
    params.layer.tileWidth = tileWidth;
    params.layer.tileHeight = tileHeight;
    params.layer.tilesAtZoom = (level) => {
        const sourceLevel = sourceLevelForMapLevel(level);
        const scale = Math.pow(2, sourceMaxLevel - sourceLevel);
        return {
            x: Math.ceil(width / tileWidth / scale),
            y: Math.ceil(height / tileHeight / scale),
        };
    };
    params.layer.tilesMaxBounds = (level) => {
        const sourceLevel = sourceLevelForMapLevel(level);
        const scale = Math.pow(2, sourceMaxLevel - sourceLevel);
        return {
            x: Math.floor(width / scale),
            y: Math.floor(height / scale),
        };
    };

    return {
        params,
        width,
        height,
        tileWidth,
        tileHeight,
        maxLevel: virtualMaxLevel,
        mapMaxLevel: virtualMaxLevel,
        sourceMaxLevel,
        sourceLevelOffset,
        sourceLevelForMapLevel,
    };
}

function levelScale(maxLevel, level) {
    return Math.pow(2, Math.max(0, Number(maxLevel) - Number(level || 0)));
}

function normalizeLayerBounds(file, fallback = {}) {
    const info = file?.file_tile_info || {};
    const width = finitePositive(fallback.width ?? info.sizeX);
    const height = finitePositive(fallback.height ?? info.sizeY);
    return {
        x: Number.isFinite(Number(fallback.x)) ? Number(fallback.x) : 0,
        y: Number.isFinite(Number(fallback.y)) ? Number(fallback.y) : 0,
        width,
        height,
    };
}

function unionBounds(bounds) {
    if (!bounds.length) {
        return { left: 0, top: 0, right: 1, bottom: 1 };
    }
    return bounds.reduce((union, bound) => ({
        left: Math.min(union.left, bound.x),
        top: Math.min(union.top, bound.y),
        right: Math.max(union.right, bound.x + bound.width),
        bottom: Math.max(union.bottom, bound.y + bound.height),
    }), {
        left: bounds[0].x,
        top: bounds[0].y,
        right: bounds[0].x + bounds[0].width,
        bottom: bounds[0].y + bounds[0].height,
    });
}

function copyGeoBounds(bounds, fallback = null) {
    const source = bounds || fallback;
    if (!source) return null;
    const left = Number(source.left);
    const top = Number(source.top);
    const right = Number(source.right);
    const bottom = Number(source.bottom);
    if (![left, top, right, bottom].every(Number.isFinite)) {
        return fallback ? copyGeoBounds(fallback) : null;
    }
    return { left, top, right, bottom };
}

function centerFromGeoBounds(bounds) {
    return {
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2,
    };
}


class GeoJSPaperWorld extends OpenSeadragon.EventSource {
    constructor(viewer) {
        super();
        this.viewer = viewer;
        this._items = [];
    }

    addItem(item, options = {}) {
        const index = Number.isInteger(options.index)
            ? Math.max(0, Math.min(options.index, this._items.length))
            : this._items.length;
        this._items.splice(index, 0, item);
        this.raiseEvent('add-item', { item });
        this.raiseEvent('metrics-change', {});
    }

    removeItem(item) {
        const index = this._items.indexOf(item);
        if (index < 0) return;
        this._items.splice(index, 1);
        item.destroy?.();
        this.raiseEvent('remove-item', { item });
        this.raiseEvent('metrics-change', {});
    }

    removeAll() {
        [...this._items].forEach((item) => this.removeItem(item));
    }

    getItemAt(index) {
        return this._items[index] || null;
    }

    getItemCount() {
        return this._items.length;
    }

    getIndexOfItem(item) {
        return this._items.indexOf(item);
    }

    getHomeBounds() {
        if (!this._items.length) {
            return new OpenSeadragon.Rect(0, 0, 1, 1);
        }
        const imageWidth = finitePositive(this.viewer.viewport?.imageWidth);
        const union = unionBounds(this._items.map((item) => item.layoutBounds));
        return new OpenSeadragon.Rect(
            union.left / imageWidth,
            union.top / imageWidth,
            (union.right - union.left) / imageWidth,
            (union.bottom - union.top) / imageWidth,
        );
    }
}

class GeoJSPaperViewport extends OpenSeadragon.EventSource {
    constructor(viewer, imageWidth, imageHeight) {
        super();
        this.viewer = viewer;
        this.imageWidth = finitePositive(imageWidth);
        this.imageHeight = finitePositive(imageHeight);
        this._containerInnerSize = new OpenSeadragon.Point(
            viewer.container.clientWidth || 1,
            viewer.container.clientHeight || 1,
        );
    }

    get _paperLayerMap() {
        return paperLayerMapDef(this);
    }

    get paperLayer() {
        return this._paperLayerMap.values().next().value || null;
    }

    get paperItems() {
        return this.paperLayer?.children || [];
    }

    _setupPaper(overlay) {
        const layer = createPaperLayer(this, overlay.paperScope);
        layer.viewport = this;
        const updateMatrix = () => {
            const scaleFactor = overlay.scaleFactor;
            if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return;
            layer.matrix.reset();
            layer.matrix.scale(scaleFactor);
        };
        overlay.addHandler('update-scale', updateMatrix);
        updateMatrix();
        return layer;
    }

    addPaperItem(item) {
        addPaperItem(this, item);
    }

    refreshSize() {
        this._containerInnerSize = new OpenSeadragon.Point(
            this.viewer.container.clientWidth || 1,
            this.viewer.container.clientHeight || 1,
        );
    }

    _imagePointFromViewport(point) {
        return {
            x: Number(point?.x || 0) * this.imageWidth,
            y: Number(point?.y || 0) * this.imageWidth,
        };
    }

    _viewportPointFromImage(point) {
        return new OpenSeadragon.Point(
            Number(point?.x || 0) / this.imageWidth,
            Number(point?.y || 0) / this.imageWidth,
        );
    }

    getCenter(current = false) {
        return this._viewportPointFromImage(centerFromGeoBounds(this.viewer._geoBoundsForViewport(current)));
    }

    getBounds(current = false) {
        const bounds = this.viewer._geoBoundsForViewport(current);
        return new OpenSeadragon.Rect(
            bounds.left / this.imageWidth,
            bounds.top / this.imageWidth,
            (bounds.right - bounds.left) / this.imageWidth,
            (bounds.bottom - bounds.top) / this.imageWidth,
        );
    }

    getZoom(current = false) {
        const bounds = this.viewer._geoBoundsForViewport(current);
        const visibleWidth = finitePositive(bounds.right - bounds.left, this.imageWidth);
        return this.imageWidth / visibleWidth;
    }

    imageToViewportCoordinates(x, y) {
        if (typeof x === 'object') {
            return this._viewportPointFromImage(x);
        }
        return this._viewportPointFromImage({ x, y });
    }

    viewportToImageCoordinates(point) {
        const imagePoint = this._imagePointFromViewport(point);
        return new OpenSeadragon.Point(imagePoint.x, imagePoint.y);
    }

    imageToViewportRectangle(rect) {
        return new OpenSeadragon.Rect(
            rect.x / this.imageWidth,
            rect.y / this.imageWidth,
            rect.width / this.imageWidth,
            rect.height / this.imageWidth,
        );
    }

    viewportToImageRectangle(rect) {
        const topLeft = this.viewportToImageCoordinates({ x: rect.x, y: rect.y });
        const bottomRight = this.viewportToImageCoordinates({
            x: rect.x + rect.width,
            y: rect.y + rect.height,
        });
        return new OpenSeadragon.Rect(
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y,
        );
    }

    imageToViewportZoom(zoom) {
        const width = this._containerInnerSize?.x || this.viewer.container.clientWidth || 1;
        return Number(zoom) * this.imageWidth / width || this.getZoom();
    }

    viewportToImageZoom(zoom) {
        const width = this._containerInnerSize?.x || this.viewer.container.clientWidth || 1;
        // Shared zoom is CSS pixels per image pixel, independent of panel width.
        return Number(zoom) * width / this.imageWidth;
    }

    viewportToViewerElementCoordinates(point) {
        return this.viewer.geoMap.gcsToDisplay(this._imagePointFromViewport(point));
    }

    imageToWindowCoordinates(point) {
        const display = this.viewer.geoMap.gcsToDisplay({ x: point.x, y: point.y });
        const rect = this.viewer.canvas.getBoundingClientRect();
        return new OpenSeadragon.Point(rect.left + display.x, rect.top + display.y);
    }

    pointFromPixel(point) {
        const imagePoint = this.viewer.geoMap.displayToGcs({ x: point.x, y: point.y });
        return this._viewportPointFromImage(imagePoint);
    }

    pixelFromPoint(point) {
        const display = this.viewer.geoMap.gcsToDisplay(this._imagePointFromViewport(point));
        return new OpenSeadragon.Point(display.x, display.y);
    }

    panTo(point) {
        this.viewer.geoMap.center(this._imagePointFromViewport(point));
        this.viewer._notifyViewportChanged({ finish: true });
        return this;
    }

    zoomTo(zoom, refPoint) {
        const currentCenter = refPoint ? this._imagePointFromViewport(refPoint) : this.viewer.geoMap.center();
        const targetZoom = finitePositive(zoom, this.getZoom());
        const visibleWidth = this.imageWidth / targetZoom;
        const aspect = finitePositive(this.viewer.container.clientHeight, 1) / finitePositive(this.viewer.container.clientWidth, 1);
        const visibleHeight = visibleWidth * aspect;
        this.viewer.geoMap.bounds({
            left: currentCenter.x - visibleWidth / 2,
            top: currentCenter.y - visibleHeight / 2,
            right: currentCenter.x + visibleWidth / 2,
            bottom: currentCenter.y + visibleHeight / 2,
        });
        this.viewer._notifyViewportChanged({ finish: true });
        return this;
    }

    fitBounds(rect) {
        this.viewer.geoMap.bounds({
            left: rect.x * this.imageWidth,
            top: rect.y * this.imageWidth,
            right: (rect.x + rect.width) * this.imageWidth,
            bottom: (rect.y + rect.height) * this.imageWidth,
        });
        this.viewer._notifyViewportChanged({ finish: true });
        return this;
    }

    goHome() {
        const bounds = copyGeoBounds(this.viewer._layoutBounds) || {
            left: 0,
            top: 0,
            right: this.imageWidth,
            bottom: this.imageHeight,
        };
        this.viewer.geoMap.bounds(bounds);
        this.viewer._notifyViewportChanged({ finish: true });
        return this;
    }

    getRotation(current = true) {
        void current;
        const degrees = Number(this.viewer?._viewportRotation);
        return Number.isFinite(degrees) ? degrees : 0;
    }

    rotateTo(degrees) {
        const next = Number(degrees);
        if (!Number.isFinite(next)) return this;
        this.viewer?._setViewportRotation?.(next);
        return this;
    }
}

class GeoJSPaperTiledImage extends OpenSeadragon.EventSource {
    constructor(viewer, file, layer, index, layoutBounds = null) {
        super();
        this.viewer = viewer;
        this.file = file;
        this.layer = layer;
        this.index = index;
        this.layoutBounds = normalizeLayerBounds(file, layoutBounds || {});
        this.source = {
            name: file?.name,
            width: finitePositive(file?.file_tile_info?.sizeX),
            height: finitePositive(file?.file_tile_info?.sizeY),
            dimensions: new OpenSeadragon.Point(
                finitePositive(file?.file_tile_info?.sizeX),
                finitePositive(file?.file_tile_info?.sizeY),
            ),
        };
    }

    get _paperLayerMap() {
        return paperLayerMapDef(this);
    }

    get paperLayer() {
        return this._paperLayerMap.values().next().value || null;
    }

    get paperItems() {
        return this.paperLayer?.children || [];
    }

    _setupPaper(overlay) {
        const layer = createPaperLayer(this, overlay.paperScope);
        layer.tiledImage = this;
        const updateMatrix = () => {
            const scaleFactor = overlay.scaleFactor;
            const bounds = this.getBoundsNoRotate();
            const sourceWidth = this.getContentSize().x;
            if (!Number.isFinite(scaleFactor) || scaleFactor <= 0 || !sourceWidth) return;
            const matrix = new paper.Matrix();
            matrix.translate({ x: bounds.x * scaleFactor, y: bounds.y * scaleFactor });
            matrix.scale(bounds.width * scaleFactor / sourceWidth);
            layer.matrix.set(matrix);
        };
        this.addHandler('bounds-change', updateMatrix);
        overlay.addHandler('update-scale', updateMatrix);
        updateMatrix();
        return layer;
    }

    addPaperItem(item) {
        addPaperItem(this, item);
    }

    getBoundsNoRotate() {
        const imageWidth = finitePositive(this.viewer.viewport?.imageWidth);
        return new OpenSeadragon.Rect(
            this.layoutBounds.x / imageWidth,
            this.layoutBounds.y / imageWidth,
            this.layoutBounds.width / imageWidth,
            this.layoutBounds.height / imageWidth,
        );
    }

    getBounds() {
        return this.getBoundsNoRotate();
    }

    getClippedBounds() {
        return this.getBoundsNoRotate();
    }

    getContentSize() {
        return new OpenSeadragon.Point(this.source.width, this.source.height);
    }

    imageToViewportCoordinates(x, y) {
        const point = typeof x === 'object' ? x : { x, y };
        const imageWidth = finitePositive(this.viewer.viewport?.imageWidth);
        return new OpenSeadragon.Point(
            (this.layoutBounds.x + Number(point?.x || 0)) / imageWidth,
            (this.layoutBounds.y + Number(point?.y || 0)) / imageWidth,
        );
    }

    viewportToImageCoordinates(point) {
        const imageWidth = finitePositive(this.viewer.viewport?.imageWidth);
        return new OpenSeadragon.Point(
            Number(point?.x || 0) * imageWidth - this.layoutBounds.x,
            Number(point?.y || 0) * imageWidth - this.layoutBounds.y,
        );
    }

    imageToViewportRectangle(rect) {
        const imageWidth = finitePositive(this.viewer.viewport?.imageWidth);
        return new OpenSeadragon.Rect(
            (this.layoutBounds.x + Number(rect?.x || 0)) / imageWidth,
            (this.layoutBounds.y + Number(rect?.y || 0)) / imageWidth,
            Number(rect?.width || 0) / imageWidth,
            Number(rect?.height || 0) / imageWidth,
        );
    }

    viewportToImageRectangle(rect) {
        const topLeft = this.viewportToImageCoordinates({ x: rect.x, y: rect.y });
        const bottomRight = this.viewportToImageCoordinates({
            x: rect.x + rect.width,
            y: rect.y + rect.height,
        });
        return new OpenSeadragon.Rect(
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y,
        );
    }

    getRotation() {
        const degrees = Number(this.viewer?._viewportRotation);
        return Number.isFinite(degrees) ? degrees : 0;
    }

    getFlip() {
        return false;
    }

    setOpacity(opacity) {
        this.layer?.opacity?.(opacity);
        this.layer?.draw?.();
    }

    destroy() {
        if (this.layer) {
            this.viewer.geoMap.deleteLayer(this.layer);
            this.layer = null;
        }
        this._paperLayerMap.forEach((layer) => layer.remove());
        this._paperLayerMap.clear();
    }
}

class GeoJSPaperViewer extends OpenSeadragon.EventSource {
    constructor({ id = 'osd', firstFile = null, files = [], prefixUrl = DEFAULT_PREFIX_URL } = {}) {
        super();
        const info = firstFile?.file_tile_info || {};
        const sourceFiles = Array.isArray(files) && files.length ? files : (firstFile ? [firstFile] : []);
        this._mapMaxLevel = maxLevelForFiles(sourceFiles);
        const firstParams = tileLayerParamsForFile(
            firstFile || { file_tile_info: { sizeX: 1, sizeY: 1, tileWidth: 256, levels: 1 } },
            this._mapMaxLevel,
        );

        this.isGeoJSTileViewer = true;
        this.prefixUrl = prefixUrl;
        this.tileSources = [];
        this.PaperOverlays = [];
        this._layerBounds = [];
        this._layoutBounds = { left: 0, top: 0, right: firstParams.width, bottom: firstParams.height };
        this._mouseNavEnabled = true;
        this._destroyed = false;
        this._initialSizeApplied = false;
        this._currentGeoBounds = copyGeoBounds(this._layoutBounds);
        this._viewportChangeFrame = null;
        this._viewportChangeFrameActive = false;
        this._pendingViewportFinish = false;
        this._viewportRotation = 0;

        this.element = document.getElementById(id);
        if (!this.element) {
            throw new Error(`GeoJS tile viewer container #${id} was not found.`);
        }
        this.element.innerHTML = '';
        this.element.classList.add('geojs-tile-viewer-root');

        this.container = document.createElement('div');
        this.container.className = 'geojs-tile-viewer-container';
        this.canvas = document.createElement('div');
        this.canvas.className = 'geojs-tile-viewer-canvas';
        this.canvas.style.transformOrigin = '50% 50%';
        this.geoNode = document.createElement('div');
        this.geoNode.className = 'geojs-tile-layer-node';
        this.buttonGroup = {
            buttons: [],
            element: document.createElement('div'),
        };
        this.buttonGroup.element.className = 'geojs-tile-viewer-buttons';
        this.canvas.appendChild(this.geoNode);
        this.canvas.appendChild(this.buttonGroup.element);
        this.container.appendChild(this.canvas);
        this.element.appendChild(this.container);

        this.drawer = { canvas: this.geoNode };
        this.world = new GeoJSPaperWorld(this);
        this.viewport = new GeoJSPaperViewport(
            this,
            finitePositive(info.sizeX, firstParams.width),
            finitePositive(info.sizeY, firstParams.height),
        );

        this.geoMap = GeoMap({
            ...firstParams.params.map,
            node: this.geoNode,
            clampZoom: true,
            discreteZoom: false,
        });
        this._bindGeoMapEvents();
        this._bindNavigationFallback();
        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(this.container);
        this._resize();
    }

    get isDestroyed() {
        return this._destroyed;
    }

    createPaperOverlay(options) {
        const overlay = new PaperOverlay(this, options);
        const pointerEvents = this._mouseNavEnabled ? 'none' : 'auto';
        if (overlay?._canvasdiv) {
            overlay._canvasdiv.style.pointerEvents = pointerEvents;
        }
        if (overlay?._canvas) {
            overlay._canvas.style.pointerEvents = pointerEvents;
        }
        return overlay;
    }

    _setupPaper(overlay) {
        return createPaperLayer(this, overlay.paperScope);
    }

    get _paperLayerMap() {
        return paperLayerMapDef(this);
    }

    get paperLayer() {
        return this._paperLayerMap.values().next().value || null;
    }

    get paperItems() {
        return this.paperLayer?.children || [];
    }

    addPaperItem(item) {
        addPaperItem(this, item);
    }

    addTiledImage(options = {}) {
        const tileSource = options.tileSource || {};
        const file = tileSource.file || {
            id: tileSource.file_id,
            name: tileSource.name,
            file_tile_info: {
                sizeX: tileSource.width,
                sizeY: tileSource.height,
                tileWidth: tileSource.tileSize,
                tileHeight: tileSource.tileSize,
                levels: (tileSource.maxLevel ?? 0) + 1,
            },
        };
        const {
            params,
            maxLevel,
            mapMaxLevel,
            sourceMaxLevel,
            sourceLevelOffset,
            sourceLevelForMapLevel,
        } = tileLayerParamsForFile(file, this._mapMaxLevel);
        const layoutBounds = this._resolveLayerBounds(file, options.geojsBounds);
        const url = (x, y, level) => tileSource.getTileUrl
            ? tileSource.getTileUrl(sourceLevelForMapLevel(level), x, y)
            : '';
        const layer = this.geoMap.createLayer('osm', {
            ...params.layer,
            renderer: 'webgl',
            url,
            keepLower: true,
            tileOffset: (level) => {
                const scale = this.geoMap?.unitsPerPixel?.(level) || levelScale(maxLevel, level);
                return {
                    x: -layoutBounds.x / scale,
                    y: -layoutBounds.y / scale,
                };
            },
            crossDomain: tileSource.crossOriginPolicy === false ? null : (tileSource.crossOriginPolicy || 'anonymous'),
            attribution: '',
            opacity: 1,
        });
        const tiledImage = new GeoJSPaperTiledImage(this, file, layer, options.index ?? this.world.getItemCount(), layoutBounds);
        tiledImage.source.mapMaxLevel = mapMaxLevel;
        tiledImage.source.sourceMaxLevel = sourceMaxLevel;
        tiledImage.source.sourceLevelOffset = sourceLevelOffset;
        this.tileSources.push(tileSource);
        this._layerBounds.push(layoutBounds);
        this._applyLayoutBounds();
        this.world.addItem(tiledImage, { index: options.index });
        this.raiseEvent('open', { item: tiledImage, source: tileSource });
        options.success?.({ item: tiledImage });
        this._scheduleDraw();
        return tiledImage;
    }


    _resolveLayerBounds(file, explicitBounds = null) {
        if (explicitBounds) {
            return normalizeLayerBounds(file, explicitBounds);
        }
        const info = file?.file_tile_info || {};
        const width = finitePositive(info.sizeX);
        const height = finitePositive(info.sizeY);
        const gap = Math.max(128, width * 0.08);
        const x = this._layerBounds.length
            ? Math.max(...this._layerBounds.map((bounds) => bounds.x + bounds.width)) + gap
            : 0;
        return normalizeLayerBounds(file, { x, y: 0, width, height });
    }

    _applyLayoutBounds() {
        const union = unionBounds(this._layerBounds);
        this._layoutBounds = union;
        this.viewport.imageWidth = finitePositive(union.right - union.left);
        this.viewport.imageHeight = finitePositive(union.bottom - union.top);
        this.geoMap.maxBounds?.({
            left: union.left,
            top: union.top,
            right: union.right,
            bottom: union.bottom,
        });
    }

    _scheduleDraw() {
        if (this._drawFrame || this._destroyed) return;
        const schedule = typeof window !== 'undefined' && window.requestAnimationFrame
            ? window.requestAnimationFrame
            : (callback) => setTimeout(callback, 0);
        this._drawFrame = schedule(() => {
            this._drawFrame = null;
            if (!this._destroyed) {
                this.geoMap.draw();
            }
        });
    }

    _captureCurrentViewportState() {
        const bounds = copyGeoBounds(this.geoMap?.bounds?.(), this._currentGeoBounds || this._layoutBounds);
        if (bounds) {
            this._currentGeoBounds = bounds;
        }
        return copyGeoBounds(bounds, this._layoutBounds);
    }

    _geoBoundsForViewport(current = false) {
        if (current && this._currentGeoBounds) {
            return copyGeoBounds(this._currentGeoBounds);
        }
        return this._captureCurrentViewportState()
            || copyGeoBounds(this._currentGeoBounds)
            || copyGeoBounds(this._layoutBounds)
            || { left: 0, top: 0, right: 1, bottom: 1 };
    }

    _scheduleViewportChanged({ finish = false } = {}) {
        if (this._destroyed) return;
        this._captureCurrentViewportState();
        this._pendingViewportFinish = this._pendingViewportFinish || Boolean(finish);
        if (!this._viewportChangeFrameActive) {
            this._viewportChangeFrameActive = true;
            this._notifyViewportChanged({ finish: false });
        }
        if (this._viewportChangeFrame) return;
        const schedule = typeof window !== 'undefined' && window.requestAnimationFrame
            ? window.requestAnimationFrame
            : (callback) => setTimeout(callback, 0);
        this._viewportChangeFrame = schedule(() => {
            this._viewportChangeFrame = null;
            this._viewportChangeFrameActive = false;
            const shouldFinish = this._pendingViewportFinish;
            this._pendingViewportFinish = false;
            this._notifyViewportChanged({ finish: shouldFinish });
        });
    }


    currentPage() {
        return 0;
    }

    isMouseNavEnabled() {
        return this._mouseNavEnabled;
    }

    setMouseNavEnabled(enabled = true) {
        this._mouseNavEnabled = Boolean(enabled);
        const pointerEvents = this._mouseNavEnabled ? 'none' : 'auto';
        this.PaperOverlays.forEach((overlay) => {
            if (overlay?._canvasdiv) {
                overlay._canvasdiv.style.pointerEvents = pointerEvents;
            }
            // pointer-events is not inherited — the canvas must match or it steals zoom/pan.
            if (overlay?._canvas) {
                overlay._canvas.style.pointerEvents = pointerEvents;
            }
        });
        return this;
    }

    _bindGeoMapEvents() {
        [geoEvent?.pan, geoEvent?.zoom].filter(Boolean).forEach((name) => {
            this.geoMap.geoOn(name, () => this._scheduleViewportChanged({ finish: false }));
        });
        [geoEvent?.resize].filter(Boolean).forEach((name) => {
            this.geoMap.geoOn(name, () => this._scheduleViewportChanged({ finish: true }));
        });
        [geoEvent?.transitionstart].filter(Boolean).forEach((name) => {
            this.geoMap.geoOn(name, () => this._scheduleViewportChanged({ finish: false }));
        });
        [geoEvent?.transitionend, geoEvent?.transitioncancel].filter(Boolean).forEach((name) => {
            this.geoMap.geoOn(name, () => this._notifyViewportChanged({ finish: true }));
        });
    }

    _setViewportRotation(degrees) {
        const next = ((Number(degrees) % 360) + 360) % 360;
        const previous = Number(this._viewportRotation) || 0;
        if (Math.abs(previous - next) < 0.001) return this;
        this._viewportRotation = next;
        if (this.canvas) {
            this.canvas.style.transform = next ? `rotate(${next}deg)` : '';
        }
        this.raiseEvent('rotate', { degrees: next, pivot: this.viewport?.getCenter?.(true) });
        this._notifyViewportChanged({ finish: true });
        return this;
    }

    _rotationRadians() {
        return -((Number(this._viewportRotation) || 0) * Math.PI) / 180;
    }

    /**
     * Map screen-space motion into the (unrotated) geoMap display axes.
     * Required because rotation is applied as a CSS transform on the canvas.
     */
    _screenDeltaToMapPan(dx, dy) {
        const rad = this._rotationRadians();
        if (!rad) return { x: dx, y: dy };
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        return {
            x: dx * cos - dy * sin,
            y: dx * sin + dy * cos,
        };
    }

    /**
     * Convert a window/client point into local canvas coordinates, undoing CSS rotation.
     * Uses the AABB center (stable under rotate-around-center) and layout clientWidth/Height.
     */
    clientToCanvasLocal(eventOrPoint) {
        const el = this.canvas || this.container || this.geoNode;
        if (!el) return { x: 0, y: 0 };
        const width = Number(el.clientWidth || 0);
        const height = Number(el.clientHeight || 0);
        const rect = el.getBoundingClientRect?.() || { left: 0, top: 0, width, height };
        // AABB center == element center when transform-origin is 50% 50%.
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const clientX = Number(eventOrPoint?.clientX ?? eventOrPoint?.x ?? 0);
        const clientY = Number(eventOrPoint?.clientY ?? eventOrPoint?.y ?? 0);
        const mapped = this._screenDeltaToMapPan(clientX - cx, clientY - cy);
        return {
            x: mapped.x + width / 2,
            y: mapped.y + height / 2,
        };
    }

    _eventDisplayPoint(event) {
        return this.clientToCanvasLocal(event);
    }

    _handleNavigationWheel(event) {
        if (!this._mouseNavEnabled || this._destroyed) return;
        const delta = wheelZoomDelta(event);
        if (!Number.isFinite(delta) || delta === 0) return;
        const display = this._eventDisplayPoint(event);
        const geo = this.geoMap.displayToGcs(display);
        const currentZoom = Number(this.geoMap.zoom());
        if (!Number.isFinite(currentZoom)) return;

        consumeNavigationEvent(event);
        this.geoMap.zoom(currentZoom + delta, { map: display, geo }, true, false);
        this._scheduleDraw();
        this._scheduleViewportChanged({ finish: true });
    }

    _pointerDistance(a, b) {
        const dx = Number(a.clientX) - Number(b.clientX);
        const dy = Number(a.clientY) - Number(b.clientY);
        return Math.hypot(dx, dy);
    }

    _pointerMidpoint(a, b) {
        return {
            clientX: (Number(a.clientX) + Number(b.clientX)) / 2,
            clientY: (Number(a.clientY) + Number(b.clientY)) / 2,
        };
    }

    _navigationPointers() {
        if (!this._navigationPointersMap) this._navigationPointersMap = new Map();
        return this._navigationPointersMap;
    }

    _syncNavigationGestureFromPointers() {
        const pointers = [...this._navigationPointers().values()];
        if (pointers.length >= 2) {
            const [a, b] = pointers;
            const distance = this._pointerDistance(a, b);
            const mid = this._pointerMidpoint(a, b);
            this._navigationDrag = null;
            this._navigationPinch = {
                lastDistance: distance,
                lastMidX: mid.clientX,
                lastMidY: mid.clientY,
            };
            return;
        }
        this._navigationPinch = null;
        if (pointers.length === 1) {
            const only = pointers[0];
            this._navigationDrag = {
                pointerId: only.pointerId,
                lastX: only.clientX,
                lastY: only.clientY,
            };
            return;
        }
        this._navigationDrag = null;
    }

    _handleNavigationPointerDown(event) {
        if (!this._mouseNavEnabled || this._destroyed) return;
        // Accept primary mouse button or any touch/pen contact.
        const isTouchLike = event.pointerType === 'touch' || event.pointerType === 'pen';
        if (!isTouchLike && event.button !== 0) return;

        const pointers = this._navigationPointers();
        pointers.set(event.pointerId, {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            pointerType: event.pointerType,
        });
        this.canvas.setPointerCapture?.(event.pointerId);
        this._syncNavigationGestureFromPointers();
        consumeNavigationEvent(event);
    }

    _handleNavigationPointerMove(event) {
        if (!this._mouseNavEnabled || this._destroyed) return;
        const pointers = this._navigationPointers();
        if (!pointers.has(event.pointerId)) return;

        pointers.set(event.pointerId, {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            pointerType: event.pointerType,
        });

        if (pointers.size >= 2 && this._navigationPinch) {
            const [a, b] = [...pointers.values()];
            const distance = this._pointerDistance(a, b);
            const mid = this._pointerMidpoint(a, b);
            const pinch = this._navigationPinch;
            const lastDistance = Number(pinch.lastDistance) || distance;
            const scale = lastDistance > 0 ? distance / lastDistance : 1;
            const dx = mid.clientX - Number(pinch.lastMidX);
            const dy = mid.clientY - Number(pinch.lastMidY);
            pinch.lastDistance = distance;
            pinch.lastMidX = mid.clientX;
            pinch.lastMidY = mid.clientY;

            consumeNavigationEvent(event);

            if (Number.isFinite(scale) && Math.abs(scale - 1) > 0.001) {
                const display = this._eventDisplayPoint(mid);
                const geo = this.geoMap.displayToGcs(display);
                const currentZoom = Number(this.geoMap.zoom());
                if (Number.isFinite(currentZoom)) {
                    // geoJS zoom is roughly log2 scale; convert pinch scale → zoom delta.
                    const zoomDelta = Math.log2(scale);
                    if (Number.isFinite(zoomDelta) && zoomDelta !== 0) {
                        this.geoMap.zoom(currentZoom + zoomDelta, { map: display, geo }, true, false);
                    }
                }
            }

            if (Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0)) {
                const pan = this._screenDeltaToMapPan(dx, dy);
                this.geoMap.pan(pan, true, 'limited');
            }

            this._scheduleDraw();
            this._scheduleViewportChanged({ finish: false });
            return;
        }

        const drag = this._navigationDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const dx = Number(event.clientX) - Number(drag.lastX);
        const dy = Number(event.clientY) - Number(drag.lastY);
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return;

        consumeNavigationEvent(event);
        const pan = this._screenDeltaToMapPan(dx, dy);
        this.geoMap.pan(pan, true, 'limited');
        this._scheduleDraw();
        this._scheduleViewportChanged({ finish: false });
    }

    _handleNavigationPointerUp(event) {
        const pointers = this._navigationPointers();
        if (!pointers.has(event.pointerId)) return;
        pointers.delete(event.pointerId);
        this.canvas.releasePointerCapture?.(event.pointerId);
        this._syncNavigationGestureFromPointers();
        consumeNavigationEvent(event);
        if (pointers.size === 0) {
            this._notifyViewportChanged({ finish: true });
        }
    }

    _bindNavigationFallback() {
        this._navigationPointersMap = new Map();
        this._navigationPinch = null;
        this._navigationHandlers = [
            { element: this.canvas, name: 'wheel', handler: (event) => this._handleNavigationWheel(event), options: { capture: true, passive: false } },
            { element: this.canvas, name: 'pointerdown', handler: (event) => this._handleNavigationPointerDown(event), options: { capture: true } },
            { element: this.canvas, name: 'pointermove', handler: (event) => this._handleNavigationPointerMove(event), options: { capture: true } },
            { element: this.canvas, name: 'pointerup', handler: (event) => this._handleNavigationPointerUp(event), options: { capture: true } },
            { element: this.canvas, name: 'pointercancel', handler: (event) => this._handleNavigationPointerUp(event), options: { capture: true } },
            { element: this.canvas, name: 'lostpointercapture', handler: (event) => this._handleNavigationPointerUp(event), options: { capture: true } },
        ];
        this._navigationHandlers.forEach(({ element, name, handler, options }) => {
            element.addEventListener(name, handler, options);
        });
    }

    _unbindNavigationFallback() {
        this._navigationHandlers?.forEach(({ element, name, handler, options }) => {
            element.removeEventListener(name, handler, options);
        });
        this._navigationHandlers = [];
        this._navigationDrag = null;
        this._navigationPinch = null;
        this._navigationPointersMap?.clear();
    }

    _notifyViewportChanged({ finish = true } = {}) {
        if (this._destroyed) return;
        this._captureCurrentViewportState();
        this.viewport.refreshSize();
        this.raiseEvent('viewport-change', {});
        this.raiseEvent('animation', {});
        if (finish) {
            this.raiseEvent('animation-finish', {});
        }
    }

    _resize() {
        if (this._destroyed) return;
        const width = Math.max(1, this.container.clientWidth || this.element.clientWidth || 1);
        const height = Math.max(1, this.container.clientHeight || this.element.clientHeight || 1);
        // geoMap.size() keeps GeoJS camera zoom, which changes visible image bounds
        // (and therefore our getZoom = imageWidth/visibleWidth) when the aspect/size
        // changes. Snapshot image-space center/zoom and restore after the size update
        // so sidebar chrome toggles do not drift live-session sync.
        let preservedCenter = null;
        let preservedZoom = null;
        if (this._initialSizeApplied && this.viewport) {
            try {
                const center = this.viewport.getCenter(true);
                const zoom = this.viewport.getZoom(true);
                if (center && Number.isFinite(zoom) && zoom > 0) {
                    preservedCenter = center;
                    preservedZoom = zoom;
                }
            } catch {
                preservedCenter = null;
                preservedZoom = null;
            }
        }
        this.geoMap.size({ width, height });
        this.viewport.refreshSize();
        if (!this._initialSizeApplied) {
            this._initialSizeApplied = true;
            this.viewport.goHome();
        } else if (preservedCenter && preservedZoom) {
            const imageCenter = this.viewport._imagePointFromViewport(preservedCenter);
            const visibleWidth = this.viewport.imageWidth / preservedZoom;
            const aspect = height / Math.max(width, 1);
            const visibleHeight = visibleWidth * aspect;
            this.geoMap.bounds({
                left: imageCenter.x - visibleWidth / 2,
                top: imageCenter.y - visibleHeight / 2,
                right: imageCenter.x + visibleWidth / 2,
                bottom: imageCenter.y + visibleHeight / 2,
            });
            this._captureCurrentViewportState();
        }
        this.raiseEvent('resize', { width, height });
        this.raiseEvent('reset-size', { width, height });
        this._notifyViewportChanged({ finish: true });
        this._scheduleDraw();
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this.raiseEvent('close', {});
        this._resizeObserver?.disconnect?.();
        this._unbindNavigationFallback();
        this.world.removeAll();
        this.PaperOverlays = [];
        this.geoMap?.exit?.();
        this.container?.remove?.();
        this.raiseEvent('destroy', {});
    }
}

function createGeoJSTileViewer(options = {}) {
    if (!GeoMap || !geoUtil) {
        throw new Error('GeoJS tile viewer requires the geojs package to be available.');
    }
    return new GeoJSPaperViewer(options);
}

export {
    GeoJSPaperViewer,
    createGeoJSTileViewer,
};
