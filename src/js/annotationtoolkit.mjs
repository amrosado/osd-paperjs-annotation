/**
 * OpenSeadragon annotation plugin based on paper.js
 * @version 0.5.0
 * 
 * Includes additional open source libraries which are subject to copyright notices
 * as indicated accompanying those segments of code.
 * 
 * Original code:
 * Copyright (c) 2022-2023, Thomas Pearce
 * All rights reserved.
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 * 
 * * Redistributions of source code must retain the above copyright notice, this
 *   list of conditions and the following disclaimer.
 * 
 * * Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 * 
 * * Neither the name of this project nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 * 
 */


import './setup.mjs';
import { OpenSeadragon } from './osd-loader.mjs';
import { paper } from './paperjs.mjs';
import { AnnotationUI } from './annotationui.mjs';
import { AnnotationLayout } from './annotationlayout.mjs';
import { AnnotationToolbar } from './annotationtoolbar.mjs';
import { AnnotationToolset } from './annotationtoolset.mjs';
import { PaperOverlay } from './paper-overlay.mjs';
import { AnnotationDataStore, annotationDataActionTypes } from './annotationdatastore.mjs';
import { GeoJSDisplay } from './geojsdisplay.mjs';
import { LayerUI } from './layerui.mjs';
import { AnnotationItemFactory } from './paperitems/annotationitem.mjs';
import { MultiPolygon } from './paperitems/multipolygon.mjs';
import { Placeholder } from './paperitems/placeholder.mjs';
import { Linestring } from './paperitems/linestring.mjs';
import { MultiLinestring } from './paperitems/multilinestring.mjs';
import { RulerMeasurement } from './paperitems/rulermeasurement.mjs';
import { Raster } from './paperitems/raster.mjs';
import { Point } from './paperitems/point.mjs';
import { PointText } from './paperitems/pointtext.mjs';
import {refreshMeasurementDisplay} from './utils/measurementDisplay.mjs';
import {newAnnotationId} from './utils/annotationIdentity.mjs';
import { Rectangle } from './paperitems/rectangle.mjs';
import { Ellipse } from './paperitems/ellipse.mjs';
import { cyrb53 } from './utils/hash.mjs';
import {isCompleteAnnotationGeometry} from './utils/shapeGeometry.mjs';

//extend paper prototypes to add functionality
//property definitions

definePaperPrototypeProperty(paper.Item.prototype, 'displayName', displayNamePropertyDef());
definePaperPrototypeProperty(paper.Item.prototype, 'featureCollection', featureCollectionPropertyDef());
definePaperPrototypeProperty(paper.TextItem.prototype, 'content', textItemContentPropertyDef());
definePaperPrototypeProperty(paper.Project.prototype, 'descendants', descendantsDefProject());

//extend remove function to emit events for GeoJSON type annotation objects
const annotationRemoveWrapped = Symbol.for('osd-paperjs-annotation.removeWrapped');
if (!paper.Item.prototype.remove?.[annotationRemoveWrapped]) {
    let origRemove=paper.Item.prototype.remove;
    let annotationRemove = function(){
        const childrenToFireRemove = this.getItems({match: item=>item.isGeoJSONFeatureCollection});
        (this.isGeoJSONFeature || this.isGeoJSONFeatureCollection) && this.project.emit('item-removed',{item: this});
        childrenToFireRemove.forEach(fc => this.project.emit('item-removed', {item: fc}));
        origRemove.call(this);
        (this.isGeoJSONFeature || this.isGeoJSONFeatureCollection) && this.emit('removed',{item: this});
        childrenToFireRemove.forEach(fc => fc.emit('removed', {item: fc}));
    };
    annotationRemove[annotationRemoveWrapped] = true;
    annotationRemove.original = origRemove.original || origRemove;
    paper.Item.prototype.remove = annotationRemove;
}
//function definitions
paper.Group.prototype.insertChildren=getInsertChildrenDef();
paper.Color.prototype.toJSON = paper.Color.prototype.toCSS;//for saving/restoring colors as JSON
paper.Style.prototype.toJSON = styleToJSON;
paper.View.prototype.getImageData = paperViewGetImageData;
paper.PathItem.prototype.toCompoundPath = toCompoundPath;
paper.PathItem.prototype.applyBounds = applyBounds;
paper.Item.prototype.select = paperItemSelect;
paper.Item.prototype.deselect = paperItemDeselect;
paper.Item.prototype.toggle = paperItemToggle;
//to do: should these all be installed on project instead of scope?
paper.PaperScope.prototype.findSelectedNewItem = findSelectedNewItem;
paper.PaperScope.prototype.findSelectedItems = findSelectedItems;
paper.PaperScope.prototype.findSelectedItem = findSelectedItem;
paper.PaperScope.prototype.scaleByCurrentZoom = function (v) { return v / this.view.getZoom(); };
paper.PaperScope.prototype.getActiveTool = function(){ return this.tool ? this.tool._toolObject : null; }        


/**
 * A class for creating and managing annotation tools on an OpenSeadragon viewer.
 * @class 
 * @memberof OSDPaperjsAnnotation
 * @extends OpenSeadragon.EventSource
 */
class AnnotationToolkit extends OpenSeadragon.EventSource{
    /**
     * Create a new AnnotationToolkit instance.
     * @constructor
     * @param {OpenSeadragon.Viewer} openSeadragonViewer - The OpenSeadragon viewer object.
     * @param {object} [opts]
     * @param {object|boolean} [opts.addUI] - Deprecated. If set, annotation UI is created via addAnnotationUI. Prefer toolbar/layerUI/layout for new code.
     * @param {object|boolean} [opts.toolbar] - If set, toolbar is created at construction (same as getToolbar after). Value: true or { tools?: string[] }.
     * @param {object|boolean} [opts.layerUI] - If set, layer UI is created at construction (same as getLayerUI after). Value: true or { addFileButton?: boolean }.
     * @param {object|boolean} [opts.layout] - If set, AnnotationLayout (grid + optional toggle) is created at construction (same as addAnnotationLayout after). Value: true or { addButton?, initialOpen?, buttonTogglesToolbar?, buttonTogglesLayerUI? }.
     * @param {object} [opts.overlay] a PaperOverlay object to use
     * @param {object} [opts.destroyOnViewerClose] whether to destroy the toolkit and its overlay when the viewer closes
     * @param {object} [opts.cacheAnnotations] whether to keep annotations in memory for images which aren't currently open
     * @param {AnnotationDataStore} [opts.dataStore] optional annotation data source of truth.
     * @param {object|boolean} [opts.geojs_display] true/options to render display annotations with GeoJS and edit selected objects in Paper.js.
     * @param {object|boolean} [opts.redux] pass `{ enabled: true, store }` to store annotation data in a host Redux reducer.
     * @param {object} [opts.initialDataState] optional initial state for the local AnnotationDataStore.
     * @param {boolean} [opts.strictGeometry=false] when true, `convertPaperItemToAnnotation` throws if `toGeoJSONGeometry()`
     *   has coordinates whose array nesting does not match RFC 7946 for the declared `geometry.type` (e.g. Polygon vs MultiPolygon).
     *   When false (default), the same mismatch only logs a console warning. Does not replace a full GeoJSON schema validator.
     * @param {boolean} [opts.strictPaperItemContract=false] when true, `convertPaperItemToAnnotation` throws if `paperItem`
     *   violates `AnnotationItem.constructor.paperItemShapeContract` (e.g. MultiPolygon requires `paper.CompoundPath`).
     *   When false (default), a violation only logs a console warning.
     */
    constructor(openSeadragonViewer, opts = {}) {
        super();

        
        if(!opts){
            opts = {};
        }

        this._defaultOptions = {
            addUI: false,
            toolbar: false,
            layerUI: false,
            layout: false,
            overlay: null,
            destroyOnViewerClose: false,
            cacheAnnotations: false,
            dataStore: null,
            geojs_display: false,
            redux: false,
            initialDataState: null,
            strictGeometry: false,
            strictPaperItemContract: false,
            events: {
                project: true,
                toolkit: false,
            },
        }
        this.options = Object.assign({}, this._defaultOptions, opts);
        // normalize nested options (Object.assign is shallow)
        if (opts && typeof opts.events === 'object') {
            this.options.events = Object.assign({}, this._defaultOptions.events, opts.events);
        }
        
        this._defaultStyle = {
            fillColor: null,
            strokeColor: new paper.Color('black'),
            fillOpacity: 0,
            strokeOpacity:1,
            strokeWidth: 1,
            rescale: {
                strokeWidth: 1
            }
        };
        this.viewer = openSeadragonViewer;
        
        // set up overlay. If one is passed in, use it. Otherwise, create one.

        if(this.options.overlay){
            if(this.options.overlay instanceof PaperOverlay){
                this.overlay = this.options.overlay;
            } else {
                this.overlay = new PaperOverlay(this.viewer, {type: 'image'});
            }
        } else {
            this.overlay = new PaperOverlay(this.viewer, {type: 'image'});
        }
        this.paperScope.project.defaultStyle = new paper.Style();
        this.paperScope.project.defaultStyle.set(this.defaultStyle);
        this.dataStore = this.options.dataStore instanceof AnnotationDataStore
            ? this.options.dataStore
            : new AnnotationDataStore({
                redux: this.options.redux,
                initialState: this.options.initialDataState,
            });
        this._dataStoreProjectionVersion = null;
        this._projectingDataStore = false;
        this._unsubscribeDataStoreProjection = null;
        this._bindDataStoreEvents();

        // set the overlay to auto rescale items
        this.overlay.autoRescaleItems(true);

        // optionally destroy the annotation toolkit when the viewer closes
        if(this.options.destroyOnViewerClose){
            this.viewer.addOnceHandler('close', ()=>this.destroy());
        }

        //bind a reference to this to the viewer and the paperScope, for convenient access
        this.viewer.annotationToolkit = this;
        this.paperScope.annotationToolkit = this;

        this.viewer.world.addHandler('add-item',ev=>{
            if(this.options.cacheAnnotations){
                this._loadCachedAnnotations(ev.item);
            }
            if (this.dataStore?.reduxEnabled) this.projectFromDataStore({force: true});
        })
        this.viewer.world.addHandler('remove-item',ev=>{
            if(this.options.cacheAnnotations){
                this._cacheAnnotations(ev.item);
            }
        }, false, 1);


        //register item constructors
        AnnotationItemFactory.register(MultiPolygon);
        AnnotationItemFactory.register(Placeholder);
        AnnotationItemFactory.register(Linestring);
        AnnotationItemFactory.register(MultiLinestring);
        AnnotationItemFactory.register(RulerMeasurement);
        AnnotationItemFactory.register(Raster);
        AnnotationItemFactory.register(Point);
        AnnotationItemFactory.register(PointText);
        AnnotationItemFactory.register(Rectangle);
        AnnotationItemFactory.register(Ellipse);

        paper.Item.fromGeoJSON = AnnotationItemFactory.itemFromGeoJSON;
        paper.Item.fromAnnotationItem = AnnotationItemFactory.itemFromAnnotationItem;

        this._bindDataStoreProjection();

        if (this.options.addUI) {
            let uiOpts = {};
            if (typeof this.options.addUI === 'object') {
                uiOpts = this.options.addUI;
            }
            this.addAnnotationUI(uiOpts);
        } else {
            if (this.options.toolbar) {
                this.getToolbar(this.options.toolbar === true ? {} : this.options.toolbar);
            }
            if (this.options.layerUI) {
                this.getLayerUI(this.options.layerUI === true ? {} : this.options.layerUI);
            }
            if (this.options.layout) {
                this.addAnnotationLayout(this.options.layout === true ? {} : this.options.layout);
            }
        }

        if (this.options.geojs_display) {
            this.enableGeoJSDisplay(this.options.geojs_display === true ? {} : this.options.geojs_display);
            // Projection may have run before GeoJS existed; paint store rows now.
            this.geojsDisplay?.syncFromStore?.();
            this.geojsDisplay?.requestViewportUpdate?.({force: true});
        }

    }

    /**
     * Emit an integration hook event to the configured targets.
     * This is the single entrypoint for toolkit-owned "public hook" events so we can
     * keep payloads consistent and optionally avoid extra calls.
     * @param {string} name - event name (kebab-case)
     * @param {Object} payload - event payload (will be shallow-cloned and enriched)
     * @param {Object} [ctx]
     * @param {import('./papertools/base.mjs').ToolBase} [ctx.tool] - tool instance associated with the event
     */
    _emitIntegrationEvent(name, payload = {}, ctx = {}) {
        const tool = ctx && ctx.tool ? ctx.tool : null;
        const enriched = Object.assign({}, payload, {
            tool: payload.tool ?? tool ?? undefined,
            toolName: payload.toolName ?? tool?.toolName ?? undefined,
        });

        const ev = this.options?.events || this._defaultOptions.events;
        if (ev?.project !== false) {
            this.paperScope?.project?.emit?.(name, enriched);
        }
        if (ev?.toolkit) {
            this.raiseEvent(name, enriched);
        }
    }

    /**
     * Subscribe to Paper.js project events without reaching into paperScope internals.
     * Equivalent to: `tk.paperScope.project.on(name, fn)`.
     * @param {string} name
     * @param {Function} fn
     * @returns {this}
     */
    on(name, fn) {
        this.paperScope?.project?.on?.(name, fn);
        return this;
    }

    /**
     * Unsubscribe from Paper.js project events.
     * Equivalent to: `tk.paperScope.project.off(name, fn)`.
     * @param {string} name
     * @param {Function} fn
     * @returns {this}
     */
    off(name, fn) {
        this.paperScope?.project?.off?.(name, fn);
        return this;
    }

    /**
     * Get the default style for the annotation items.
     * 
     * @returns {object} The default style object.
     */
    get defaultStyle(){
        return this._defaultStyle;
    }
    
    /**
     * Get the default style for the annotation items.
     * 
     * @returns {object} The default style object.
     */
    get annotationUI(){
        return this._annotationUI;
    }


    /**
     * Get the paperScope associated with this toolkit
     * 
     * @returns {object} The paperScope object for this toolkit's PaperOverlay.
     */
    get paperScope(){
        return this.overlay.paperScope;
    }

    /**
     * Empty any cached annotations
     */
    clearCache(){
        this.dataStore.clearCache(null, { source: 'clearCache' });
    }

    /**
     * save the current feature collections to the cache
     * @param {TiledImage} tiledImage 
     * @private
     */
    _cacheAnnotations(tiledImage){
        try{
            const key = cyrb53(JSON.stringify(tiledImage.source));
            const featureCollections = this.snapshotGeoJSON({ layer: tiledImage.paperLayer });
            this.dataStore.setCache(key, featureCollections, { source: 'cacheAnnotations' });
        } catch(e){
            console.error('Error with caching', e);
        }
    }

    _loadCachedAnnotations(tiledImage){
        try{
            const key = cyrb53(JSON.stringify(tiledImage.source));
            const featureCollections = this.dataStore.getCache(key);
            if (featureCollections.length) this.loadGeoJSON(featureCollections, false, tiledImage);
        } catch(e){
            console.error('Error with fetching from cache', e);
        }
    }

    /**
     * Setup the annotation UI using previously stored GeoJSON objects
     * A default group is setup and selected so that the user can begin using
     * shape tools immediately.
     * @param {object} options - The options for the annotation UI.
     */
    setupEmptyAnnotationUI(options) {
        let default_group = this._createFeatureCollectionGroup();
        // this.addFeatureCollections([default_group], false, this.viewer.world.getItemAt(0));
        default_group.select();
    }

    /**
     * Add an annotation UI to the toolkit.
     * 
     * @param {object} [opts={}] - The options for the annotation UI.
     * @returns {AnnotationUI} The annotation UI object.
     */
    addAnnotationUI(opts = {}){
        if (!this._annotationUI) {
            console.warn('[osd-paperjs-annotation] addAnnotationUI is deprecated. Use getToolbar(), getLayerUI(), and addAnnotationLayout() (or place the returned .element nodes in your own layout). See the layout configuration demo.');
            this._toolset = this._toolset || new AnnotationToolset(this.paperScope, opts.tools);
            if (opts.addToolbar !== false) this.getToolbar({ tools: opts.tools });
            if (opts.addLayerUI !== false) this.getLayerUI({ addFileButton: opts.addFileButton });
            this._annotationUI = new AnnotationUI(this, this._toolset, opts);
        }
        return this._annotationUI;
    }

    /**
     * Get the toolkit's toolbar, creating it on first call with the given opts. Use .element to get the root DOM node (official API; do not look up by CSS class or id).
     * @param {Object} [opts] - Used only when creating: opts.tools - optional array of tool names.
     * @returns {AnnotationToolbar|null} The toolbar instance, or null if addAnnotationUI exists but did not create a toolbar.
     */
    getToolbar(opts = {}) {
        if (this._toolbar) return this._toolbar;
        if (this._annotationUI) return this._toolbar ?? null;
        this._toolset = this._toolset || new AnnotationToolset(this.paperScope, opts.tools ?? null);
        this._toolbar = new AnnotationToolbar(this._toolset);
        return this._toolbar;
    }

    /**
     * Get the toolkit's layer UI, creating it on first call with the given opts. Use .element to get the root DOM node (official API; do not look up by CSS class or id).
     * @param {Object} [opts] - Used only when creating: opts.addFileButton - optional boolean.
     * @returns {LayerUI|null} The layer UI instance, or null if addAnnotationUI exists but did not create a layer UI.
     */
    getLayerUI(opts = {}) {
        if (this._layerUI) return this._layerUI;
        if (this._annotationUI) return this._layerUI ?? null;
        this._layerUI = new LayerUI(this, opts.addFileButton);
        return this._layerUI;
    }

    /**
     * Get the root DOM element for the toolbar (official API). Returns null if no toolbar exists.
     * @param {Object} [opts] - Passed to getToolbar(opts) when lazy-creating.
     * @returns {HTMLElement|null}
     */
    getToolbarElement(opts = {}) {
        return this.getToolbar(opts)?.element ?? null;
    }

    /**
     * Get the root DOM element for the layer UI (official API). Returns null if no layer UI exists.
     * @param {Object} [opts] - Passed to getLayerUI(opts) when lazy-creating.
     * @returns {HTMLElement|null}
     */
    getLayerUIElement(opts = {}) {
        return this.getLayerUI(opts)?.element ?? null;
    }

    /**
     * Build the annotation layout (grid, resize, toggle button) using AnnotationLayout.
     * Uses getToolbar() and getLayerUI() (lazy-creating with default opts if needed). Mutually exclusive with addAnnotationUI.
     * @param {Object} [opts] - addButton, buttonTogglesToolbar, buttonTogglesLayerUI, initialOpen (all optional).
     * @returns {AnnotationLayout|null} The layout, or null if addAnnotationUI already exists.
     */
    addAnnotationLayout(opts = {}) {
        if (this._annotationUI) return null;
        if (this._annotationLayout) return this._annotationLayout;
        const toolbar = this.getToolbar();
        const layerUI = this.getLayerUI();
        const toolbarRef = toolbar ? {
            element: toolbar.element,
            show: () => toolbar.show(),
            hide: () => toolbar.hide(),
        } : null;
        const layerUIRef = layerUI ? {
            element: layerUI.element,
            show: () => layerUI.show(),
            hide: () => layerUI.hide(),
        } : null;
        this._annotationLayout = new AnnotationLayout(this.viewer, {
            toolbar: toolbarRef,
            layerUI: layerUIRef,
            addButton: opts.addButton !== false,
            addViewerButton: (config) => this.overlay.addViewerButton(config),
            buttonTogglesToolbar: opts.buttonTogglesToolbar !== false,
            buttonTogglesLayerUI: opts.buttonTogglesLayerUI !== false,
            initialOpen: opts.initialOpen !== false,
        });
        if (opts.initialOpen !== false) {
            toolbar && toolbar.show();
            layerUI && layerUI.show();
        } else {
            toolbar && toolbar.hide();
            layerUI && layerUI.hide();
        }
        return this._annotationLayout;
    }

    /**
     * Add a set of tools without the full UI (toolbar). Use when addUI is false.
     * Creates a toolset (tool layer + tool instances) so getTool(name) and activation work.
     * @param {string[]} [toolNames] - Array of tool names (e.g. ['default', 'ruler']). Default tool is always included.
     */
    addTools(toolNames) {
        if (!this._toolset) this._toolset = new AnnotationToolset(this.paperScope, toolNames);
    }
    /**
     * Get a tool instance by name (e.g. 'ruler', 'default'). Works with full UI or headless addTools().
     * @param {string} name - Tool name.
     * @returns {import('./papertools/base.mjs').ToolBase|null}
     */
    getTool(name) {
        return this._toolset ? this._toolset.getTool(name) : null;
    }
    /**
     * Destroy the toolkit and its components.
     */
    destroy() {
        this.raiseEvent('before-destroy');
        let tool=this.paperScope && this.paperScope.getActiveTool();
        if(tool) tool.deactivate(true);

        this.viewer.annotationToolkit = null;
        if (this._annotationLayout) {
            this._annotationLayout.destroy();
            this._annotationLayout = null;
        }
        this._annotationUI && this._annotationUI.destroy();
        this._annotationUI = null;
        if (this._toolbar) {
            this._toolbar.destroy();
            this._toolbar = null;
        }
        if (this._layerUI) {
            this._layerUI.destroy();
            this._layerUI = null;
        }
        if (this._toolset) this._toolset.destroy();
        this._toolset = null;
        this.disableGeoJSDisplay();
        this._unsubscribeDataStoreProjection?.();
        this._unsubscribeDataStoreProjection = null;
        this.dataStore?.destroy?.();
        this.overlay.destroy();
        this.raiseEvent('destroy');
    }
    /**
     * Close the toolkit and remove its feature collections.
     */
    close() {
        this.raiseEvent('before-close');
        let tool=this.paperScope && this.paperScope.getActiveTool();
        if(tool) tool.deactivate(true);

        this.addFeatureCollections([],true);
    }
    /**
     * Set the global visibility of the toolkit.
     * @param {boolean} [show=false] - Whether to show or hide the toolkit.
     */
    setGlobalVisibility(show = false){
        this.paperScope.view._element.setAttribute('style', 'visibility:' + (show ? 'visible;' : 'hidden;'));
    }

    /**
     * Enable the GeoJS display layer. GeoJS renders normal display objects while Paper.js stays available
     * for rich editing when a rendered object is clicked.
     * @param {Object|boolean} [opts={}]
     * @returns {GeoJSDisplay}
     */
    enableGeoJSDisplay(opts = {}) {
        if (this.geojsDisplay) return this.geojsDisplay;
        this.geojsDisplay = new GeoJSDisplay(this, opts === true ? {} : opts);
        return this.geojsDisplay;
    }

    /**
     * Disable the GeoJS display layer and restore Paper.js item visibility.
     */
    disableGeoJSDisplay() {
        this.geojsDisplay?.destroy();
        this.geojsDisplay = null;
    }

    /**
     * Finish the currently active Paper.js edit and return that object to GeoJS display mode.
     */
    finishGeoJSDisplayEdit() {
        this.geojsDisplay?.finishPaperEdit();
    }

    /**
     * Add feature collections to the toolkit from GeoJSON objects.
     * @param {object[]} featureCollections - The array of GeoJSON objects representing feature collections.
     * @param {boolean} replaceCurrent - Whether to replace the current feature collections or not.
     * @param {OpenSeadragon.TiledImage | OpenSeadragon.Viewport | false} [parentImage] - which image to add the feature collections to
     */
    addFeatureCollections(featureCollections,replaceCurrent, parentImage){
        this.loadGeoJSON(featureCollections,replaceCurrent, parentImage);
        this.overlay.rescaleItems();
        this.paperScope.project.emit('items-changed');
    }
    /**
     * Get the feature collection groups that the toolkit is managing.
     * @param {paper.Layer} [parentLayer]  The layer to find feature collections within. If not specified, finds across all layers.
     * @returns {paper.Group[]} The array of paper groups representing feature collections.
     */
    getFeatureCollectionGroups(parentLayer){
        // return this.overlay.paperScope.project.layers.filter(l=>l.isGeoJSONFeatureCollection);
        return this.paperScope.project.getItems({match: item=>item.isGeoJSONFeatureCollection && (parentLayer ? item.layer === parentLayer : true)});
    }
    /**
     * Get the features in the toolkit.
     * @returns {paper.Item[]} The array of paper item objects representing features.
     */
    getFeatures(){
        return this.paperScope.project.getItems({match:i=>i.isGeoJSONFeature});
    }
     /**
     * Register an item as a GeoJSONFeature that the toolkit should track
     * @param {paper.Item} item - The item to track as a geoJSONFeature
     */
    static registerFeature(item){
        item.isGeoJSONFeature = true;
    }
     /**
     * Register a group as a GeoJSONFeatureCollection that the toolkit should track
     * @param {paper.Group} group - The group to track as a geoJSONFeatureCollection
     */
    static registerFeatureCollection(group){
        group.isGeoJSONFeatureCollection = true;
    }

    /**
     * Convert the feature collections in the toolkit to GeoJSON objects.
     * @param {Object} [options] 
     * @param {Layer} [options.layer] The specific layer to use
     * @returns {Object[]} The array of GeoJSON objects representing feature collections.
     */
    toGeoJSON(options){
        if (!options?.layer) {
            return this.dataStore.toGeoJSON();
        }
        return this.snapshotGeoJSON(options);
    }

    /**
     * Snapshot the live Paper.js project to GeoJSON. This is the bridge used by the data store
     * to stay synchronized with tool-driven edits.
     * @param {Object} [options]
     * @param {Layer} [options.layer] The specific layer to use
     * @returns {Object[]} The array of GeoJSON objects representing feature collections.
     */
    snapshotGeoJSON(options){
        const defaults = {
            layer:null,
        }
        options = Object.assign(defaults, options);

        const parent = options.layer || this.paperScope.project;
        //find all featureCollection items and convert to GeoJSON compatible structures
        return parent.getItems({match:i=>i.isGeoJSONFeatureCollection}).map(grp=>{
            const image = grp.layer?.tiledImage;
            const fileId = image?.wsvvFileId ?? image?.file?.id ?? image?.source?.file_id;
            grp.data.userdata = grp.data.userdata || {};
            grp.data.userdata.layer_id ||= newAnnotationId();
            const userdata = {...(grp.data?.userdata || {})};
            const layerId = userdata.layer_id || null;
            if (layerId) userdata.layer_id = layerId;
            if (!userdata.layer_label) {
                userdata.layer_label = grp.displayName || grp.name || 'Annotation Group';
            }
            let geoJSON = {
                type:'FeatureCollection',
                id: layerId || undefined,
                features: grp.descendants.filter(d => d.annotationItem && d.annotationItem.type !== null
                    && !(this.paperScope.getActiveTool?.()?._pointerDown && this.paperScope.getActiveTool().item === d)).map(d=>{
                    d.data.userdata = d.data.userdata || {};
                    d.data.userdata.object_id ||= newAnnotationId();
                    const feature = d.annotationItem.toGeoJSONFeature();
                    delete feature.properties.selected;
                    feature.properties.coordinateSpace = 'image-pixels';
                    if (fileId != null) feature.properties.wsifileId = fileId;
                    const objectId = d.data?.userdata?.object_id;
                    if (objectId) {
                        feature.id = objectId;
                        feature.properties = {
                            ...(feature.properties || {}),
                            userdata: {
                                ...((feature.properties && feature.properties.userdata) || {}),
                                ...(d.data?.userdata || {}),
                                object_id: objectId,
                                layer_id: layerId || d.data?.userdata?.layer_id,
                                layer_label: userdata.layer_label,
                            },
                        };
                    }
                    return feature;
                }).filter(feature => isCompleteAnnotationGeometry(feature.geometry)),
                properties:{
                    ...grp.data.annotationProperties,
                    ...(fileId != null ? {wsifileId: fileId} : {}),
                    defaultStyle: grp.defaultStyle.toJSON(),
                    userdata,
                },
                label:grp.displayName,
            }
            
            return geoJSON;
        })
    }
    
    /**
     * Convert the feature collections in the project to a JSON string.
     * @param {function} [replacer] - The replacer function for JSON.stringify().
     * @param {number|string} [space] - The space argument for JSON.stringify().
     * @returns {string} The JSON string representing the feature collections.
     */
    toGeoJSONString(replacer,space){
        return this.dataStore.toGeoJSONString(replacer,space);
    }
    /**
     * Load feature collections from GeoJSON objects and add them to the project.
     * @param {object[]} geoJSON - The array of GeoJSON objects representing feature collections.
     * @param {boolean} replaceCurrent - Whether to replace the current feature collections or not.
     * @param {OpenSeadragon.TiledImage | OpenSeadragon.Viewport | false} [parentImage] - Which image (or viewport) to add the object to
     * @param {boolean} [pixelCoordinates]
     */
    loadGeoJSON(geoJSON, replaceCurrent, parentImage, internalOptions = {}){
        if (!internalOptions.skipDataStore) {
            if (replaceCurrent) {
                this.dataStore.replaceFeatureCollections(geoJSON, { source: 'loadGeoJSON' });
            } else {
                this.dataStore.addFeatureCollections(geoJSON, { source: 'loadGeoJSON' });
            }
            if (this.dataStore?.reduxEnabled) {
                return;
            }
        }
        let parentLayer = parentImage ? parentImage.paperLayer : false;
        if(replaceCurrent){
            this.getFeatureCollectionGroups(parentLayer).forEach(grp=>grp.remove());
        }
        if(!Array.isArray(geoJSON)){
            geoJSON = [geoJSON];
        }
        
        geoJSON.forEach(obj=>{
            if(obj.type=='FeatureCollection'){
                let group = this._createFeatureCollectionGroup({label: obj.label, parent: parentLayer});
                if (!group) return;
                let props = (obj.properties || {});
                group.data.userdata = Object.assign({}, props.userdata);
                group.data.userdata.layer_id ||= obj.id;
                group.data.userdata.layer_label = obj.label || group.data.userdata.layer_label || 'Annotation Group';
                try {
                    group.defaultStyle.set(props.defaultStyle || {});
                } catch {
                    // Keep group even if style payload is incomplete.
                }
                (obj.features || []).forEach((feature) => {
                    try {
                        const item = paper.Item.fromGeoJSON(feature);
                        if (!item) return;
                        if (!item.data) item.data = {};
                        if (feature?.properties?.userdata) {
                            item.data.userdata = {
                                ...(item.data.userdata || {}),
                                ...feature.properties.userdata,
                            };
                        }
                        item.data.userdata = {
                            ...(item.data.userdata || {}),
                            object_id: item.data.userdata?.object_id || feature.id || feature.properties?.id,
                            layer_id: group.data.userdata.layer_id,
                            layer_label: group.data.userdata.layer_label,
                        };
                        // Remote/live features must stay unselected so GeoJS paints them.
                        try {
                            item.selected = false;
                            item.deselect?.();
                        } catch {
                            // Optional.
                        }
                        group.addChild(item);
                    } catch (error) {
                        console.warn('GeoJSON feature not loaded:', error);
                    }
                });
            }
            else{
                console.warn('GeoJSON object not loaded: wrong type. Only FeatureCollection objects are currently supported');
            }
        })
        if (!internalOptions.skipDataStoreSync) {
            this._scheduleDataStoreSync('loadGeoJSON');
        }
    }

    /**
     * Add a new, empty FeatureCollection with default label and parent
     * @returns {paper.Group} The paper group object representing the feature collection.
     */
    addEmptyFeatureCollectionGroup(){
        return this._createFeatureCollectionGroup();
    }
    
    /**
     * Create a new feature collection group in the project scope.
     * @private
     * @param {Object} [opts] - Object with fields label and parent
     * @returns {paper.Group} The paper group object representing the feature collection.
     */
    _createFeatureCollectionGroup(opts = {}) {
        let defaultOpts = {
            label:null,
            parent:null
        }
        opts = Object.assign({}, defaultOpts, opts);

        let displayLabel = opts.label;
        
        let parent = opts.parent;
        const fileId = this.options?.annotationCollection?.fileId;
        const collectionImage = fileId == null ? null : this.viewer.world._items.find(image =>
            String(image.wsvvFileId ?? image.source?.file_id) === String(fileId));
        if (!parent && collectionImage) parent = collectionImage._paperLayerMap?.get(this.paperScope) || collectionImage.paperLayer;
        if(!parent) {
            let numItems = this.viewer.world._items.length;
            
            if( numItems == 1){
                parent = this.viewer.world.getItemAt(0).paperLayer;
            } else if (numItems == 0){
                parent = this.viewer.viewport.paperLayer;
            } else {
                //TODO: Update the UI and associated APIs to allow selecting specific tiled images for multi-image use
                console.warn('Use of AnnotationToolkit with multi-image is not yet fully supported. All annotations will be added to the top-level tiled image.');
                parent = this.viewer.world.getItemAt(numItems - 1).paperLayer;
            }
        }
        if(!parent){
            console.error('Failed to create feature collection group: no parent could be found');
            return;
        }

        let grp = new paper.Group();
        let grpNum = this.getFeatureCollectionGroups().length + 1;
        grp.name = grp.displayName = displayLabel!==null ? displayLabel : `Annotation Group ${grpNum}`;
        grp.defaultStyle = new paper.Style(this.paperScope.project.defaultStyle);
        grp.data.userdata = {layer_id: newAnnotationId(), layer_label: String(grp.displayName)};
        const collection = this.options?.annotationCollection;
        if (collection) grp.data.annotationProperties = {annotation_set_id: collection.id, annotation_set_name: collection.name,
            ...(collection.fileId != null ? {wsifileId: collection.fileId} : {})};
        this._addFeatureCollectionGroupToLayer(grp, parent);
        return grp;
    }

    _addFeatureCollectionGroupToLayer(fcGroup, layer){
        layer.addChild(fcGroup);
        AnnotationToolkit.registerFeatureCollection(fcGroup);
        this.paperScope.project.emit('feature-collection-added',{group:fcGroup});
        // re-insert children to trigger events
        if(fcGroup.children){
            fcGroup.insertChildren(0, fcGroup.children);
        }
    }

    /**
     * Ensure there is a selected placeholder in a feature collection so a tool can draw into it (e.g. when activating with createNewItem and no layer UI).
     * @private
     * @param {Object} [style] - Optional style for the placeholder (e.g. strokeColor). If omitted, project default is used.
     */
    _ensureNewItemForTool(style) {
        const groups = this.getFeatureCollectionGroups();
        const collectionId = this.options?.annotationCollection?.id;
        const filter = this.options?.annotationCollectionFilter ?? collectionId;
        const available = filter == null ? groups : groups.filter(group => (group.data?.annotationProperties?.annotation_set_id || '') === filter);
        const fcGroup = available[0] || this._createFeatureCollectionGroup();
        if (!fcGroup) return;
        // Ensure a visible default style for headless use when no explicit style is provided.
        // Use the feature collection's defaultStyle if available; otherwise fall back to toolkit defaultStyle.
        const effectiveStyle = (style != null)
            ? style
            : (fcGroup.defaultStyle?.toJSON ? fcGroup.defaultStyle.toJSON() : this.defaultStyle);
        const placeholder = this.makePlaceholderItem(effectiveStyle);
        fcGroup.addChild(placeholder.paperItem);
        AnnotationToolkit.registerFeature(placeholder.paperItem);
        placeholder.paperItem.select();
    }

    /**
     * Make a placeholder annotation item
     * @param {Object} style - options (e.g strokeColor) to pass to the paper item
     */
    makePlaceholderItem(style){
        const placeholder = new Placeholder(style);
        placeholder.paperItem.data.userdata = {object_id: newAnnotationId()};
        return placeholder;
    }

    isLocalEditingItem(item) {
        if (item && this._dataStoreCompletion?.item === item) return true;
        const tool = this.paperScope?.getActiveTool?.();
        if (!item || !tool?.isActive?.()) return false;
        if (tool.itemToCreate === item) return true;
        return tool.item === item && (tool._pointerDown || tool.mode === 'creating'
            || String(tool.mode || '').endsWith('-drag') || tool.dragging || tool.creating);
    }

    getLocalEditingItems() {
        return (this.getFeatures?.() || []).filter(item => this.isLocalEditingItem(item));
    }

    removeAnnotationCollection(collectionId, layerIds = []) {
        const ids = new Set(layerIds);
        const groups = (this.getFeatureCollectionGroups?.() || []).filter(group =>
            group.data?.annotationProperties?.annotation_set_id === collectionId || ids.has(group.data?.userdata?.layer_id));
        if (!groups.length) return;
        this.suppressDataStoreSync(() => {
            if (groups.some(group => (group.descendants || []).some(item => this.isLocalEditingItem(item) || item.selected))) {
                this.getTool?.('default')?.activate();
                this._dataStoreCompletion = null;
            }
            for (const group of groups) group.remove();
        });
        this.projectFromDataStore({force: true});
    }

    finishDrawingItem(item, tool) {
        if (!this.geojsDisplay || !item?.parent || tool !== this.paperScope.getActiveTool?.()) return;
        this._dataStoreCompletion = {item, tool};
        this._scheduleDataStoreSync('item-created', {item, tool});
    }

    _bindDataStoreProjection() {
        if (!this.dataStore?.reduxEnabled) return;
        this._unsubscribeDataStoreProjection = this.dataStore.subscribe((state) => this._syncProjectFromDataStoreState(state));
        this._syncProjectFromDataStoreState(this.dataStore.state);
    }

    /**
     * Force Paper (+ GeoJS, if enabled) to match the current annotation data store.
     * Used by live-session sagas when a backend session_tree arrives.
     */
    projectFromDataStore({force = false} = {}) {
        if (!this.dataStore) return false;
        if (force) this._dataStoreProjectionVersion = null;
        this._syncProjectFromDataStoreState(this.dataStore.state, {force});
        return true;
    }

    _syncProjectFromDataStoreState(state, {force = false} = {}) {
        if (!this.dataStore?.reduxEnabled || !state) return;
        const version = Number(state.version || 0);
        if (!force && this._dataStoreProjectionVersion === version) return;
        this._dataStoreProjectionVersion = version;

        const storeOnlyActions = new Set([
            annotationDataActionTypes.SYNC_FROM_PROJECT,
            annotationDataActionTypes.SET_CACHE,
            annotationDataActionTypes.CLEAR_CACHE,
        ]);
        // Live-session sagas pass force=true so session_tree loads still paint
        // even if a Paper→store sync was the last Redux action.
        if (!force && storeOnlyActions.has(state.lastAction)) return;
        // Remote live-session Redux updates are painted by the saga projector with
        // soft upserts. A full wipe here races local creates (flash then revert).
        const source = state.lastMeta?.source;
        if (!force && (source === 'liveSessionRemote' || source === 'slideSessionRemote')) return;

        this._replaceProjectFeatureCollectionsFromDataStore(state.featureCollections || []);
    }

    _replaceProjectFeatureCollectionsFromDataStore(featureCollections) {
        this._projectingDataStore = true;
        try {
            this.paperScope.activate();
            const isEmbeddingGroup = (group) => Boolean(
                group?.data?.wsvvEmbeddingGrid
                || group?.displayName === 'wsvv-embedding-grid'
                || group?.name === 'wsvv-embedding-grid',
            );
            const isEmbeddingCollection = (collection) => Boolean(
                collection?.properties?.wsvvEmbeddingGrid
                || collection?.id === 'wsvv-embedding-grid'
                || collection?.label === 'wsvv-embedding-grid',
            );
            const annotations = (featureCollections || []).filter((collection) => !isEmbeddingCollection(collection));
            const groupId = group => String(group.data?.userdata?.layer_id || group.displayName || '');
            const featureId = feature => String(feature?.properties?.userdata?.object_id || feature?.id || feature?.properties?.id || '');
            const itemId = item => String(item.data?.userdata?.object_id || '');
            const groups = (this.getFeatureCollectionGroups?.() || []).filter(group => !isEmbeddingGroup(group));
            const byId = new Map(groups.map(group => [groupId(group), group]));
            const wantedLayers = new Set();
            const imageCount = this.viewer.world?.getItemCount?.() ?? this.viewer.world?._items?.length ?? 0;
            // Never materialize image-pixel geometry into the viewport layer
            // while slide loading is still racing the websocket session tree.
            if (annotations.length && !imageCount) return;
            for (const collection of annotations) {
                const id = String(collection.properties?.userdata?.layer_id || collection.id || collection.label || '');
                wantedLayers.add(id);
                let group = byId.get(id);
                const fileId = collection.properties?.wsifileId ?? collection.features?.[0]?.properties?.wsifileId;
                const image = fileId == null ? null : this.viewer.world?._items?.find(image => String(image.wsvvFileId ?? image.source?.file_id) === String(fileId));
                const imageLayer = image?._paperLayerMap?.get(this.paperScope) || image?.paperLayer;
                if (fileId != null && !imageLayer) continue;
                if (!group) {
                    group = this._createFeatureCollectionGroup({label: collection.label, parent: imageLayer});
                    if (!group) continue;
                }
                if (imageLayer && group.parent !== imageLayer) imageLayer.addChild(group);
                group.data.userdata = {...(collection.properties?.userdata || {}), layer_id: id, layer_label: collection.label};
                group.data.annotationProperties = {...collection.properties};
                group.visible = collection.properties?.hidden !== true;
                if (String(group.displayName) !== String(collection.label)) group.displayName = collection.label;
                group.defaultStyle?.set(collection.properties?.defaultStyle || {});
                const existing = new Map((group.descendants || []).filter(item => item.annotationItem).map(item => [itemId(item), item]));
                const wantedFeatures = new Set();
                for (const feature of collection.features || []) {
                    const objectId = featureId(feature);
                    wantedFeatures.add(objectId);
                    const item = existing.get(objectId);
                    if (item && this.isLocalEditingItem(item)) continue;
                    if (!isCompleteAnnotationGeometry(feature.geometry)) continue;
                    const sameGeometry = item && JSON.stringify(item.annotationItem.toGeoJSONGeometry()) === JSON.stringify(feature.geometry);
                    if (sameGeometry) {
                        item.data.userdata = {...(feature.properties?.userdata || {}), object_id: objectId, layer_id: id};
                        if (String(item.displayName) !== String(feature.properties?.label)) item.displayName = feature.properties?.label;
                        item.annotationItem.setStyle(feature.properties || {});
                    } else {
                        const next = paper.Item.fromGeoJSON(feature);
                        if (!next) continue;
                        next.data.userdata = {...(feature.properties?.userdata || {}), object_id: objectId, layer_id: id};
                        if (item) item.replaceWith(next);
                        else {
                            next.selected = false;
                            group.addChild(next);
                        }
                    }
                }
                for (const [id, item] of existing) {
                    if (!wantedFeatures.has(id) && !this.isLocalEditingItem(item)) item.remove();
                }
            }
            for (const group of groups) {
                if (!wantedLayers.has(groupId(group)) && !(group.descendants || []).some(item => this.isLocalEditingItem(item))) group.remove();
            }
            this.overlay.rescaleItems();
        } catch (error) {
            console.error('Failed projecting annotation store onto Paper:', error);
        } finally {
            try {
                refreshMeasurementDisplay(this);
                this.geojsDisplay?.syncFromStore?.({refreshPaperItems: true});
                this.geojsDisplay?.requestViewportUpdate?.({force: true});
                this.geojsDisplay?.scheduleUpdate?.();
                this.paperScope?.view?.update?.();
            } catch {
                // GeoJS refresh is best-effort after projection.
            }
            this._projectingDataStore = false;
            this.paperScope?.project?.emit('items-changed', {source: 'liveSessionRemote'});
        }
    }

    _bindDataStoreEvents() {
        const project = this.paperScope?.project;
        if (!project) return;
        [
            'feature-collection-added',
            'item-created',
            'item-updated',
            'item-converted',
            'item-removed',
            'items-changed',
        ].forEach((eventName) => {
            project.on(eventName, (event) => this._scheduleDataStoreSync(eventName, event));
        });
    }

    /**
     * Prevent Paper→Redux snapshots while materializing remote live-session trees.
     * Without this, item-created / feature-collection-added from soft upserts replace
     * the Redux SoT with a partial Paper project and GeoJS drops unsynced peers' objects.
     */
    suppressDataStoreSync(fn) {
        this._suppressDataStoreSyncDepth = (this._suppressDataStoreSyncDepth || 0) + 1;
        // Suppress projection events without cancelling a queued local commit.
        try {
            return typeof fn === 'function' ? fn() : undefined;
        } finally {
            this._suppressDataStoreSyncDepth = Math.max(0, (this._suppressDataStoreSyncDepth || 1) - 1);
        }
    }

    _scheduleDataStoreSync(reason, event = {}) {
        const item = event?.item;
        if (
            this._projectingDataStore
            || (this._suppressDataStoreSyncDepth || 0) > 0
            || item?.data?.wsvvEmbeddingGrid
            || item?.data?.wsvvLazyGeoJSPaperItem
            || event?.source === 'render_annotations'
            || event?.source === 'slideSessionRemote'
            || event?.source === 'liveSessionRemote'
            || event?.source === 'update_colors'
            || event?.source === 'update_grid_line_style'
        ) {
            return;
        }
        if (!this.dataStore) return;
        if (reason === 'item-created' && event.tool && !event.tool._pointerDown && this.geojsDisplay) {
            this._dataStoreCompletion = {item: event.item, tool: event.tool};
        }
        if (reason === 'item-removed' && item) {
            const id = item.data?.userdata?.object_id;
            const layerId = item.data?.userdata?.layer_id;
            if (item.isGeoJSONFeatureCollection && layerId) {
                (this._dataStoreRemovedLayerIds ||= new Set()).add(layerId);
            } else if (id) {
                (this._dataStoreRemovedFeatureIds ||= new Set()).add(id);
            }
        }
        // Coalesce bursts (multi-object layer delete) into one Paper→Redux snapshot
        // after the current turn so the top-bar store matches removed items.
        this._dataStoreSyncReason = reason || this._dataStoreSyncReason || 'items-changed';
        if (this._dataStoreSyncPending) return;
        this._dataStoreSyncPending = true;
        const sync = () => {
            this._dataStoreSyncPending = false;
            if (this._projectingDataStore || (this._suppressDataStoreSyncDepth || 0) > 0) {
                this._dataStoreSyncReason = null;
                return;
            }
            const completion = this._dataStoreCompletion;
            this._dataStoreCompletion = null;
            const source = completion ? 'item-created' : (this._dataStoreSyncReason || reason);
            this._dataStoreSyncReason = null;
            const removedFeatureIds = [...(this._dataStoreRemovedFeatureIds || [])];
            const removedLayerIds = [...(this._dataStoreRemovedLayerIds || [])];
            this._dataStoreRemovedFeatureIds = null;
            this._dataStoreRemovedLayerIds = null;
            this.dataStore.syncFromToolkit(this, {source, removedFeatureIds, removedLayerIds});
            if (completion?.item?.parent && completion.tool === this.paperScope.getActiveTool?.()) {
                const {item, tool} = completion;
                tool._createdItemToComplete = null;
                const parent = item.parent;
                this.suppressDataStoreSync(() => {
                    item.deselect?.(true);
                    const placeholder = this.makePlaceholderItem(item.annotationItem.getStyleProperties());
                    if (!isCompleteAnnotationGeometry(item.annotationItem.toGeoJSONGeometry())) item.remove();
                    parent.addChild(placeholder.paperItem);
                    placeholder.paperItem.select();
                    tool.selectionChanged();
                });
                this.geojsDisplay?.syncFromStore();
                this.geojsDisplay?._syncPaperSelectionState();
                this.geojsDisplay?.requestViewportUpdate({force: true});
            }
        };
        if (typeof queueMicrotask === 'function') {
            queueMicrotask(sync);
        } else {
            globalThis.setTimeout(sync, 0);
        }
    }
    
};

export {AnnotationToolkit as AnnotationToolkit};



// private functions

/**
 * Create a compound path from a path item.
 * @private
 * @returns {paper.CompoundPath} The compound path object.
 */
function toCompoundPath() {
    if (this.constructor !== paper.CompoundPath) {
        let np = new paper.CompoundPath({ children: [this], fillRule: 'evenodd' });
        np.selected = this.selected;
        this.selected = false;
        return np;
    }
    return this;
}
/**
 * Apply bounds to a path item.
 * @private
 * @param {paper.Item[]} boundingItems - The array of paper items to use as bounds.
 */
function applyBounds(boundingItems) {
    if (boundingItems.length == 0)
        return;
    let intersection;
    if (boundingItems.length == 1) {
        let bounds = boundingItems[0];
        intersection = bounds.intersect(this, { insert: false });
    }
    else if (boundingItems.length > 1) {
        let bounds = new paper.CompoundPath(boundingItems.map(b => b.clone().children).flat());
        intersection = bounds.intersect(this, { insert: false });
        bounds.remove();
    }
    if (this.children) {
        //compound path
        this.removeChildren();
        this.addChildren(intersection.children ? intersection.children : [intersection]);
    }
    else {
        //simple path
        this.segments = intersection.segments ? intersection.segments : intersection.firstChild.segments;
    }

}

function emitSelectionChangedFromItem(item) {
    const tk = item.project?._scope?.annotationToolkit;
    if (!tk || !tk._emitIntegrationEvent) return;

    tk._selectedFeatureItems ||= new Set();
    if (item.selected) {
        tk._selectedFeatureItems.add(item);
    } else {
        tk._selectedFeatureItems.delete(item);
    }

    const primary = tk._selectedFeatureItems.values().next().value || null;
    tk._emitIntegrationEvent('selection-changed', {
        selectedCount: tk._selectedFeatureItems.size,
        primary,
    });
}

/**
 * Select a paper item and emit events.
 * @private
 * @param {boolean} [keepOtherSelectedItems=false] - Whether to keep other selected items or not.
 */
function paperItemSelect(keepOtherSelectedItems) {
    if(!keepOtherSelectedItems){
        this.project._scope.findSelectedItems().forEach(item => item.deselect());
    }
    this.selected = true;
    this.emit('selected');
    this.project.emit('item-selected', { item: this });
    emitSelectionChangedFromItem(this);
}
/**
 * Deselect a paper item and emit events.
 * @private
 * @param {boolean} [keepOtherSelectedItems=false] - Whether to keep other selected items or not.
 */
function paperItemDeselect(keepOtherSelectedItems) {
    if(!keepOtherSelectedItems){
        this.project._scope.findSelectedItems().forEach(item => item.deselect(true));
        return;
    }
    this.selected = false;
    this.emit('deselected');
    this.project.emit('item-deselected', { item: this });
    emitSelectionChangedFromItem(this);
}
/**
 * Toggle the selection of a paper item and emit events.
 * @private
 * @param {boolean} [keepOtherSelectedItems=false] - Whether to keep other selected items or not.
 */
function paperItemToggle(keepOtherSelectedItems) {
    this.selected ? this.deselect(keepOtherSelectedItems) : this.select(keepOtherSelectedItems);
}

/**
 * Find the selected new item in the project scope.
 * @private
 * @returns {paper.Item} The selected new item, or null if none exists.
 */
function findSelectedNewItem() {
    //to do: change this to use type=='Feature' and geometry==null to match GeoJSON spec and AnnotationItemPlaceholder definition
    return this.project.getItems({ selected:true, match: function (i) { return i.isGeoJSONFeature && i.initializeGeoJSONFeature; } })[0];
}
/**
 * Find the selected items in the project scope.
 * @private
 * @returns {paper.Item[]} The array of selected items, or an empty array if none exists.
 */
function findSelectedItems() {
    return this.project.getItems({ selected: true, match: function (i) { return i.isGeoJSONFeature; } });
}
/**
 * Find the first selected item in the project scope.
 * @private
 * @returns {paper.Item} The first selected item, or null if none exists.
 */
function findSelectedItem() {
    return this.findSelectedItems()[0];
}



/**
 * Define the display name property for a paper item object.
 * The display name property defines the name used to identify a paper item object.
 * @private
 * @returns {object} The property descriptor object.
 * @property {function} set - The setter function for the display name property.
 *   @param {string} input - The display name value.
 * @property {function} get - The getter function for the display name property.
 *   @returns {string} The display name value.
 */
function definePaperPrototypeProperty(proto, name, descriptor){
    const existing = Object.getOwnPropertyDescriptor(proto, name);
    if (existing && existing.configurable === false) return;
    Object.defineProperty(proto, name, {
        configurable: true,
        ...descriptor,
    });
}

function displayNamePropertyDef(){
    return {
        set: function displayName(input){
            if(Array.isArray(input)){
                this._displayName = new String(input[0]);
                this._displayName.source=input[1];
            }
            else{
                this._displayName = input;
            }
            this.name = this._displayName;
            this.emit('display-name-changed',{displayName:this._displayName});
            this.project?._scope?.annotationToolkit?._scheduleDataStoreSync?.('display-name-changed');
        },
        get: function displayName(){
            return this._displayName;
        }
    }
}

/**
 * Define the featureCollection property for a paper item object.
 * @private
 */
function featureCollectionPropertyDef(){
    return {
        get: function fc(){
            return this.hierarchy.filter(i=>i.isGeoJSONFeatureCollection)[0];
        }
    }
}


/**
 * Define the descendants property for a paper project object.
 * The descendants property represents all the descendants (layers and their children) of a paper project object.
 * @private
 * @returns {object} The property descriptor object.
 * @property {function} get - The getter function for the descendants property.
 *   @returns {paper.Item[]} The array of paper item objects representing the descendants.
 */
function descendantsDefProject(){
    return {
        get: function descendants(){
            // return this.layers ? this.layers.filter(layer=>layer.isGeoJSONFeatureCollection).map(child=>child.descendants).flat() : [this];
            return this.layers ? this.getItems({match: item=>item.isGeoJSONFeatureCollection}).map(child=>child.descendants).flat() : [this];
        }
    }
}

/**
 * Convert a paper style object to a JSON object.
 * @private
 * @returns {object} The JSON object representing the style.
 */
function styleToJSON(){
    let output={};
    Object.keys(this._values).forEach(key=>{
        output[key] = this[key];//invoke getter
    })
    return output;
}
/**
 * Get the image data of a paper view element.
 * @private
 * @returns {ImageData} The image data object of the view element.
 */
function paperViewGetImageData(){
    return this.element.getContext('2d').getImageData(0,0,this.element.width, this.element.height);
}

/**
 * Get the insert children method definition for a paper group object.
 * The insert children method emits events when children are added to the paper group object.
 * @private
 * @returns {function} The insert children method that emits events when children are added.
 */
function getInsertChildrenDef(){
    let origInsertChildren = paper.Group.prototype.insertChildren.original || paper.Group.prototype.insertChildren;
    function insertChildren(){ 
        let output = origInsertChildren.apply(this,arguments); 
        let index = arguments[0], children=Array.from(arguments[1]);
        children&&children.forEach((child,i)=>{
            if(child.isGeoJSONFeature){
                let idx = typeof index !== 'undefined' ? index+1 : -1; 
                this.emit('child-added',{item:child,index:idx});
            } 
        });
        return output;
    }
    insertChildren.original = origInsertChildren;
    return insertChildren;
}

/**
 * Define the fill opacity property for a paper style object.
 *  @private
 *  @returns {object} The property descriptor object with the following properties:
 * - get: A function that returns the text of the item.
 * - set: A function that sets the text of the item and causes the 'content-changed' event to be fired.
 */
function textItemContentPropertyDef(){
    let _set = paper.TextItem.prototype._setContent || Object.getOwnPropertyDescriptor(paper.TextItem.prototype, 'content').set;
    paper.TextItem.prototype._setContent = _set;
    return{
        get: function() {
            return this._content;
        },
        set: function(content) {
            _set.call(this, content);
            this.emit('content-changed');
        },
    }
}
