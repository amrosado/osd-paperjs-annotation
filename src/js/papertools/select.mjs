/**
 * OpenSeadragon paperjs overlay plugin based on paper.js
 * @version 0.5.0
 * 
 * Includes additional open source libraries which are subject to copyright notices
 * as indicated accompanying those segments of code.
 * 
 * Original code:
 * Copyright (c) 2022-2026, Thomas Pearce
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
 * * Neither the name of osd-paperjs-annotation nor the names of its
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

import {AnnotationUITool, AnnotationUIToolbarBase, annotationToolPrimaryButtonActiveDrag, annotationToolPrimaryButtonDownOrUp} from './annotationUITool.mjs';
import { chooseDirectSelectionRows } from '../geojs-selection-helpers.mjs';
import { paper } from '../paperjs.mjs';
import { makeFaIcon } from '../utils/faIcon.mjs';
import { debugLog, debugLogJson, isDebugEnabled } from '../../../../helpers/debugLog.js';

/**
 * Represents the SelectTool class that extends the AnnotationUITool.
 * This tool allows users to select and manipulate GeoJSON feature items on the Paper.js project.
 * @class
 */
class SelectTool extends AnnotationUITool{
    /**
     * Creates an instance of SelectTool.
     * @constructor
     * @param {Object} paperScope - The Paper.js paper scope object.
     * @property {Object} ps - Reference to the Paper.js project scope.
     * @property {SelectToolbar} toolbarControl - Sets the toolbar control for the SelectTool.
     * @property {paper.Path.Rectangle} selectionRectangle - The selection rectangle used for area-based selection.
     * @property {paper.Path.Rectangle} sr2 - A second selection rectangle with a dashed border.
     * @description This tool provides the ability to select and manipulate GeoJSON feature items on the canvas. Users can select items by clicking
     * on them or by performing area-based selection through click-and-drag. It also emits selection-related events for interaction and provides
     * functions to retrieve selected items and check for the existence of GeoJSON feature items.
     */
    constructor(paperScope){
        super(paperScope);
        let self=this;
        this.ps = this.project.paperScope;
        this.usesGeoJSDisplaySelection = true;
        this._lastSelectionItems = [];
        this._lastSelectionEmbeddingIds = [];
        this._lastGeojsDirectHitHadRows = false;
        this._replaceSelectionOnSync = false;
        this._selectionPointerActive = false;
        this._viewportChangedDuringSelectionPointer = false;
        this._selectionViewportChangeHandler = null;
        this._selectionDownDisplayPoint = null;
        this.setToolbarControl(new SelectToolbar(this));
        this.registerOverlayCursorOwnedClasses('selectable-layer');

        let selectionRectangle = new paper.Path.Rectangle({
            strokeWidth: 3,
            rescale: {strokeWidth: 3},
            strokeColor: '#111827',
            opacity: 0.95,
        });
        let sr2 = new paper.Path.Rectangle({
            strokeWidth: 1.5,
            dashArray: [6, 4],
            rescale: {strokeWidth: 1.5, dashArray: [6, 4]},
            strokeColor: '#f8fafc',
            opacity: 1,
        });
        this.project.toolLayer.addChild(selectionRectangle);
        this.project.toolLayer.addChild(sr2);
        selectionRectangle.applyRescale();
        sr2.applyRescale();
        selectionRectangle.visible=false;
        sr2.visible=false;

        const selectionMarquee = document.createElement('div');
        selectionMarquee.className = 'annotation-selection-marquee';
        Object.assign(selectionMarquee.style, {
            position: 'absolute',
            display: 'none',
            pointerEvents: 'none',
            boxSizing: 'border-box',
            border: '3px solid #111827',
            outline: '2px dashed #f8fafc',
            outlineOffset: '-5px',
            boxShadow: '0 0 0 1px rgba(15, 23, 42, 0.35)',
            zIndex: '20',
        });
        this.project.overlay?._canvasdiv?.appendChild(selectionMarquee);

        const hideSelectionMarquee = () => {
            selectionMarquee.style.display = 'none';
        };
        const updateSelectionMarquee = (displayPointA, displayPointB) => {
            if (!displayPointA || !displayPointB) {
                hideSelectionMarquee();
                return;
            }
            const geoRect = self.geojsDisplay?.element?.getBoundingClientRect?.();
            const parentRect = selectionMarquee.parentElement?.getBoundingClientRect?.();
            if (!geoRect || !parentRect) {
                hideSelectionMarquee();
                return;
            }
            const pointA = {
                x: geoRect.left + displayPointA.x - parentRect.left,
                y: geoRect.top + displayPointA.y - parentRect.top,
            };
            const pointB = {
                x: geoRect.left + displayPointB.x - parentRect.left,
                y: geoRect.top + displayPointB.y - parentRect.top,
            };
            const left = Math.min(pointA.x, pointB.x);
            const top = Math.min(pointA.y, pointB.y);
            const width = Math.abs(pointA.x - pointB.x);
            const height = Math.abs(pointA.y - pointB.y);
            selectionMarquee.style.display = "block";
            selectionMarquee.style.left = left + "px";
            selectionMarquee.style.top = top + "px";
            selectionMarquee.style.width = Math.max(width, 1) + "px";
            selectionMarquee.style.height = Math.max(height, 1) + "px";
        };
        
        this.extensions.onActivate=function(){ 
            self.geojsDisplay?.finishPaperEdit();
            self.tool.onMouseMove = (ev)=>self.onMouseMove(ev);
            self._bindViewportNavigationGuard();
            self.clearOverlayCursorOwnedClasses();
        }    
        this.extensions.onDeactivate=function(shouldFinish){
            selectionRectangle.visible = false;
            sr2.visible = false;
            selectionRectangle.selected = false;
            sr2.selected = false;
            hideSelectionMarquee();
            self._selectionPointerActive = false;
            self._viewportChangedDuringSelectionPointer = false;
            self._selectionDownDisplayPoint = null;
            self._unbindViewportNavigationGuard();
            self.clearOverlayCursorOwnedClasses();
            self.tool.onMouseMove = null;
        }
        this.tool.extensions.onKeyUp=function(ev){
            if(ev.key=='escape'){
                self.clearSelection();
            }
        }

        this.tool.onMouseDown=function(ev){
            if (!annotationToolPrimaryButtonDownOrUp(ev)) return;
            self._consumeSelectionPointerEvent(ev);
            self._selectionPointerActive = true;
            self._viewportChangedDuringSelectionPointer = false;
            self._selectionDownDisplayPoint = self._eventDisplayPoint(ev);
        }
       
        /**
         * Event handler for mouse up events.
         * @private
         * @param {Event} ev - The mouse up event.
         * @property {boolean} visible - Hide the selection rectangle.
         * @property {HitResult} hitResult - The result of the hit test to find the item under the mouse pointer.
         * @property {boolean} toggleSelection - Indicates whether the 'Control' or 'Meta' key was pressed during the event.
         * @property {HitResult[]} hitResults - An array of hit test results containing items found within the area.
         * @property {boolean} keepExistingSelection - Indicates whether the 'Control' or 'Meta' key was pressed during the event.
         * @property {Item[]} selectedItems - An array of selected items to be deselected.
         */        
        this.tool.onMouseUp=function(ev){
            if (annotationToolPrimaryButtonDownOrUp(ev)) {
                self._consumeSelectionPointerEvent(ev);
            }
            selectionRectangle.visible=false;
            sr2.visible=false;
            selectionRectangle.selected=false;
            sr2.selected=false;
            hideSelectionMarquee();
            const viewportNavigated = self._viewportChangedDuringSelectionPointer;
            const selectionDownDisplayPoint = self._selectionDownDisplayPoint;
            self._selectionPointerActive = false;
            self._viewportChangedDuringSelectionPointer = false;
            self._selectionDownDisplayPoint = null;
            if (!annotationToolPrimaryButtonDownOrUp(ev)) {
                const ignoredDisplayRect = self._pointRectSummary(selectionDownDisplayPoint, self._eventDisplayPoint(ev));
                const ignoredProjectRect = self._pointRectSummary(ev?.downPoint, ev?.point);
                debugLog('geojs.selection', 'pointer-up-ignored', {
                    primaryButton: annotationToolPrimaryButtonDownOrUp(ev),
                    viewportNavigated,
                    displayRect: ignoredDisplayRect,
                    projectRect: ignoredProjectRect,
                    ...self._flatRectSummary('display', ignoredDisplayRect),
                    ...self._flatRectSummary('project', ignoredProjectRect),
                });
                return;
            }
            const keepExistingSelection = (ev.modifiers.control || ev.modifiers.meta);
            const upDisplayPoint = self._eventDisplayPoint(ev);
            const displayRect = self._pointRectSummary(selectionDownDisplayPoint, upDisplayPoint);
            const projectRect = self._pointRectSummary(ev?.downPoint, ev?.point);
            debugLogJson('geojs.selection', 'pointer-up', {
                action: self.selection_action || 'select',
                keepExistingSelection,
                viewportNavigated,
                dragDistance: Number.isFinite(ev?.downPoint?.subtract?.(ev.point)?.length)
                    ? Number(ev.downPoint.subtract(ev.point).length.toFixed(2))
                    : null,
                displayRect,
                projectRect,
                ...self._flatRectSummary('display', displayRect),
                ...self._flatRectSummary('project', projectRect),
                eventSummary: self._eventDebugSummary(ev),
            });
            if(ev.downPoint.subtract(ev.point).length==0){
                //not a click-and-drag, do element selection
                const geojsRows = self._geojsDirectRowsAtEvent(ev);
                if (!geojsRows.length && self.selection_action === 'deselect' && self._lastGeojsDirectHitHadRows) return;
                if (geojsRows.length) {
                    const row = geojsRows[0];
                    debugLog('geojs.selection', 'direct-click-hit', {
                        action: self.selection_action || 'select',
                        rowCount: geojsRows.length,
                        firstId: row?.id,
                        keepExistingSelection,
                    });
                    const paperItem = self.geojsDisplay?.getPaperItemForRow?.(row);
                    if (paperItem) {
                        debugLog('geojs.selection', 'direct-click-materialized', {
                            id: row?.id,
                            selected: Boolean(paperItem.selected),
                        });
                        self._applySelectionAction([paperItem], keepExistingSelection, true);
                    } else {
                        debugLog('geojs.selection', 'direct-click-id-fallback', {
                            rowCount: geojsRows.length,
                            firstIds: geojsRows.slice(0, 5).map((hitRow) => hitRow.id),
                        });
                        self._applyEmbeddingSelectionAction(geojsRows.map((hitRow) => hitRow.id), keepExistingSelection, true);
                    }
                    return;
                }
                let hitResult = self.hitTestPoint(ev);
                const hitItems = hitResult && self._isItemSelectable(hitResult.item) ? [hitResult.item] : [];
                self._applySelectionAction(hitItems, keepExistingSelection, true);
                
            } else{
                //click and drag, do area-based selection
                const geojsRows = self._geojsDirectRowsInArea(ev, false, selectionDownDisplayPoint);
                if (!geojsRows.length && self.selection_action === 'deselect' && self._lastGeojsDirectHitHadRows) return;
                if (geojsRows.length) {
                    debugLog('geojs.selection', 'direct-drag-hit', {
                        action: self.selection_action || 'select',
                        rowCount: geojsRows.length,
                        firstId: geojsRows[0]?.id,
                        lastId: geojsRows[geojsRows.length - 1]?.id,
                        keepExistingSelection,
                    });
                    self._applyEmbeddingSelectionAction(geojsRows.map((row) => row.id), keepExistingSelection, false);
                    return;
                }
                let hitResults = self.hitTestArea(ev);
                self._applySelectionAction(hitResults, keepExistingSelection, false);
                //limit results to a single layer
                // hitResults.filter(item=>item.layer === hitResults[0].layer).forEach(item=>item.select(true))
            }
        }
        /**
         * Event handler for mouse drag events.
         * @private
         * @param {Event} ev - The mouse drag event.
         * @property {boolean} visible - Show the selection rectangle.
         * @property {Rectangle} r - The bounding rectangle of the selection area.
         */
        this.tool.onMouseDrag = function(ev){
            if (!annotationToolPrimaryButtonActiveDrag(ev)) return;
            self._consumeSelectionPointerEvent(ev);
            self.project.toolLayer.bringToFront();
            selectionRectangle.bringToFront();
            sr2.bringToFront();
            selectionRectangle.visible=false;
            sr2.visible=false;
            selectionRectangle.selected=false;
            sr2.selected=false;
            updateSelectionMarquee(self._selectionDownDisplayPoint, self._eventDisplayPoint(ev));
            let r=new paper.Rectangle(ev.downPoint,ev.point);
            selectionRectangle.set({segments:[r.topLeft, r.topRight, r.bottomRight, r.bottomLeft]});
            sr2.set({segments:[r.topLeft, r.topRight, r.bottomRight, r.bottomLeft]});
            // console.log(selectionRectangle.visible, selectionRectangle.segments)
        }
    }
//   /**
//    * Gets the selected items that are GeoJSON features.
//    * This method retrieves all the items in the Paper.js project that are considered as GeoJSON features and are currently selected.
//    * @returns {Array<Object>} An array of selected items that are GeoJSON features.
//    */
//     getSelectedItems(){
//         return this.ps.project.selectedItems.filter(i=>i.isGeoJSONFeature);
//     }
  /**
   * Checks if there are any GeoJSON feature items in the project.
   * This method searches through all the items in the Paper.js project and determines if there are any GeoJSON feature items.
   * @returns {boolean} Returns true if there are GeoJSON feature items, false otherwise.
   */
    doAnnotationItemsExist(){
        if (this.ps.project.getItems({match:i=>i.isGeoJSONFeature}).length > 0) return true;
        return Boolean(this.geojsDisplay?.hasSelectableRows?.());
    }

  /**
   * Handles mouse movement events and emits selection-related events for items under the cursor.
   * When the mouse moves within the Paper.js project area, this method detects if it is over any item and triggers related selection events.
   * It updates the currently hovered item and layer, and applies a CSS class to the project's overlay for highlighting selectable layers.
   * @param {Object} ev - The mouse move event object containing information about the cursor position.
   */
    onMouseMove(ev){
        const hoverItem = this._geojsPaperItemAtEvent(ev) || ev.item;
        if(hoverItem && this._isItemSelectable(hoverItem)){
            if(this.currentItem != hoverItem) (hoverItem.emit('selection:mouseenter')||true) 
            if(this.currentLayer != hoverItem.layer) hoverItem.layer.emit('selection:mouseenter');
            this.currentItem = hoverItem;
            this.currentLayer = this.currentItem.layer;
            this.project.overlay.addClass('selectable-layer')
        }
        else{
            this.currentItem && (this.currentItem.emit('selection:mouseleave',ev)||true) 
            this.currentLayer && this.currentLayer.emit('selection:mouseleave',ev);
            this.project.overlay.removeClass('selectable-layer')
            this.currentItem = null;
            this.currentLayer = null;
        }   
    }
    /**
     * Performs a hit test on a specific point and returns hit results for GeoJSON feature items.
     * This method performs a hit test on the provided point and filters the results to include only GeoJSON feature items.
     * It also adjusts the hit result if the initial hit is not on the GeoJSON feature itself, but on a child item.
     * @param {Object} ev - The mouse event object containing the point to perform the hit test on.
     * @returns {HitResult} The hit result object containing information about the hit test.
     */
    hitTestPoint(ev){
        if (this.selection_action === 'deselect') {
            const selectedPaperItem = this._paperBoundsItemsAtPoint(ev.point).find((item) => item.selected);
            if (selectedPaperItem) return { item: selectedPaperItem, paper: true };
        }

        const geojsItem = this._geojsPaperItemAtEvent(ev);
        if (geojsItem) return { item: geojsItem, geojs: true };
        let hitResult = this.ps.project.hitTest(ev.point,{
            fill:true,
            stroke:true,
            segments:true,
            tolerance:this.getTolerance(5),
            match:i=>i.item.isGeoJSONFeature || i.item.parent.isGeoJSONFeature,
        })
        if(hitResult && !hitResult.item.isGeoJSONFeature){
            hitResult.item = hitResult.item.parent;
        }
        return hitResult;
    }
    /**
     * Performs a hit test within an area and returns hit results for GeoJSON feature items.
     * This method performs a hit test within the provided area and returns hit results that include only GeoJSON feature items.
     * It supports options for testing against fully contained or overlapping items.
     * @param {Object} ev - The mouse event object containing the area for hit testing.
     * @param {boolean} [onlyFullyContained=false] - Flag to indicate if hit test should be performed only on fully contained items.
     * @returns {HitResult[]} An array of hit results containing GeoJSON feature items within the specified area.
     */
    hitTestArea(ev,onlyFullyContained){
        if (this.geojsDisplay?.enabled) {
            const geojsItems = this.geojsDisplay.findPaperItemsInProjectRectangle(ev.point, ev.downPoint, onlyFullyContained);
            const paperItems = this._paperBoundsItemsInRectangle(ev.point, ev.downPoint, onlyFullyContained);
            if (this.selection_action === 'deselect') {
                return this._uniqueItems([
                    ...paperItems.filter((item) => item.selected),
                    ...geojsItems,
                ]);
            }
            return this._uniqueItems([...geojsItems, ...paperItems]);
        }
        let options = {
            match:item=>item.isGeoJSONFeature,
        }
        let testRectangle=new paper.Rectangle(ev.point,ev.downPoint);
        if(onlyFullyContained){
            options.inside=testRectangle;
        }
        else{
            options.overlapping=testRectangle;
        }
        let hitResult = this.ps.project.getItems(options);
        return hitResult;
    }

    get geojsDisplay(){
        return this.project?.paperScope?.annotationToolkit?.geojsDisplay || null;
    }

    _bindViewportNavigationGuard(){
        const viewer = this.project?.overlay?.viewer;
        if (!viewer || this._selectionViewportChangeHandler) return;
        this._selectionViewportChangeHandler = () => {
            if (this._selectionPointerActive) {
                this._viewportChangedDuringSelectionPointer = true;
            }
        };
        viewer.addHandler('viewport-change', this._selectionViewportChangeHandler);
    }

    _unbindViewportNavigationGuard(){
        const viewer = this.project?.overlay?.viewer;
        if (!viewer || !this._selectionViewportChangeHandler) return;
        viewer.removeHandler('viewport-change', this._selectionViewportChangeHandler);
        this._selectionViewportChangeHandler = null;
    }

    _consumeSelectionPointerEvent(ev){
        const nativeEvent = ev?.event || ev?.original?.nativeEvent || ev?.nativeEvent || null;
        nativeEvent?.preventDefault?.();
        nativeEvent?.stopPropagation?.();
        nativeEvent?.stopImmediatePropagation?.();
    }

    _eventDebugSummary(ev){
        const nativeEvent = ev?.event || ev?.original?.nativeEvent || ev?.nativeEvent || null;
        const displayPoint = this._eventDisplayPoint(ev);
        const geoRect = this.geojsDisplay?.element?.getBoundingClientRect?.();
        const canvasRect = this.geojsDisplay?.viewer?.canvas?.getBoundingClientRect?.();
        const summarizeRect = (rect) => rect ? {
            left: Number(Number(rect.left).toFixed(2)),
            top: Number(Number(rect.top).toFixed(2)),
            width: Number(Number(rect.width).toFixed(2)),
            height: Number(Number(rect.height).toFixed(2)),
        } : null;
        return {
            nativeType: nativeEvent?.type || null,
            clientX: Number.isFinite(Number(nativeEvent?.clientX)) ? Number(Number(nativeEvent.clientX).toFixed(2)) : null,
            clientY: Number.isFinite(Number(nativeEvent?.clientY)) ? Number(Number(nativeEvent.clientY).toFixed(2)) : null,
            button: nativeEvent?.button ?? null,
            buttons: nativeEvent?.buttons ?? null,
            displayPoint: displayPoint ? { x: Number(displayPoint.x.toFixed(2)), y: Number(displayPoint.y.toFixed(2)) } : null,
            projectPoint: ev?.point ? { x: Number(Number(ev.point.x).toFixed(2)), y: Number(Number(ev.point.y).toFixed(2)) } : null,
            projectDownPoint: ev?.downPoint ? { x: Number(Number(ev.downPoint.x).toFixed(2)), y: Number(Number(ev.downPoint.y).toFixed(2)) } : null,
            geoRect: summarizeRect(geoRect),
            canvasRect: summarizeRect(canvasRect),
        };
    }

    _geojsPaperItemAtEvent(ev){
        if (!this.geojsDisplay?.enabled) return null;
        return this.geojsDisplay.hitTestPaperItemsAtEvent(ev)[0]
            || this.geojsDisplay.hitTestPaperItemsAtProjectPoint?.(ev.point)?.[0]
            || this._paperBoundsItemsAtPoint(ev.point)[0]
            || null;
    }

    _isDirectEmbeddingRow(row){
        return Boolean(row?.directEmbedding && !row?.directEmbeddingOverview && row.id !== undefined && row.id !== null);
    }

    _eventDisplayPoint(ev){
        const nativeEvent = ev?.event || ev?.original?.nativeEvent || ev?.nativeEvent || null;
        const clientX = Number(nativeEvent?.clientX);
        const clientY = Number(nativeEvent?.clientY);
        const rect = this.geojsDisplay?.element?.getBoundingClientRect?.()
            || this.geojsDisplay?.viewer?.canvas?.getBoundingClientRect?.()
            || this.project?.overlay?._canvas?.getBoundingClientRect?.()
            || null;
        if (!rect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
        return {
            x: clientX - rect.left,
            y: clientY - rect.top,
        };
    }

    _filterDirectGeojsRows(hitRows){
        const directRows = (hitRows || []).filter((row) => this._isDirectEmbeddingRow(row));
        return this.selection_action === 'deselect' && this.geojsDisplay?.isEmbeddingSelectedId
            ? directRows.filter((row) => this.geojsDisplay.isEmbeddingSelectedId(row.id))
            : directRows;
    }

    _geojsDirectRowsAtEvent(ev){
        if (!this.geojsDisplay?.enabled) return [];
        const displayPoint = this._eventDisplayPoint(ev);
        if (displayPoint && this.geojsDisplay.hitTestRowsAtDisplayPoint) {
            const hitRows = (this.geojsDisplay.hitTestRowsAtDisplayPoint(displayPoint) || [])
                .filter((row) => this._isDirectEmbeddingRow(row));
            const rows = this._filterDirectGeojsRows(hitRows);
            this._lastGeojsDirectHitHadRows = hitRows.length > 0;
            debugLog('geojs.selection', 'direct-hit-test-point', {
                action: this.selection_action || 'select',
                source: 'display',
                rowCount: rows.length,
                hitRowCount: hitRows.length,
                filteredToSelected: this.selection_action === 'deselect',
                firstId: rows[0]?.id,
                displayX: Number.isFinite(displayPoint.x) ? displayPoint.x : null,
                displayY: Number.isFinite(displayPoint.y) ? displayPoint.y : null,
                projectX: Number.isFinite(ev?.point?.x) ? ev.point.x : null,
                projectY: Number.isFinite(ev?.point?.y) ? ev.point.y : null,
            });
            if (hitRows.length) return rows;
        }
        return this._geojsDirectRowsAtPoint(ev?.point);
    }

    _geojsDirectRowsAtPoint(point){
        if (!this.geojsDisplay?.enabled || !point) return [];
        const hitRows = (this.geojsDisplay.hitTestRowsAtProjectPoint?.(point) || [])
            .filter((row) => this._isDirectEmbeddingRow(row));
        const rows = this._filterDirectGeojsRows(hitRows);
        this._lastGeojsDirectHitHadRows = hitRows.length > 0;
        debugLog('geojs.selection', 'direct-hit-test-point', {
            action: this.selection_action || 'select',
            source: 'project',
            rowCount: rows.length,
            hitRowCount: hitRows.length,
            filteredToSelected: this.selection_action === 'deselect',
            firstId: rows[0]?.id,
            x: Number.isFinite(point.x) ? point.x : null,
            y: Number.isFinite(point.y) ? point.y : null,
        });
        return rows;
    }

    _pointRectSummary(pointA, pointB){
        if (!pointA || !pointB) return null;
        const minX = Math.min(Number(pointA.x), Number(pointB.x));
        const minY = Math.min(Number(pointA.y), Number(pointB.y));
        const maxX = Math.max(Number(pointA.x), Number(pointB.x));
        const maxY = Math.max(Number(pointA.y), Number(pointB.y));
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
        return {
            minX: Number(minX.toFixed(2)),
            minY: Number(minY.toFixed(2)),
            maxX: Number(maxX.toFixed(2)),
            maxY: Number(maxY.toFixed(2)),
            width: Number((maxX - minX).toFixed(2)),
            height: Number((maxY - minY).toFixed(2)),
        };
    }

    _flatRectSummary(prefix, rect){
        return {
            [prefix + 'MinX']: rect?.minX ?? null,
            [prefix + 'MinY']: rect?.minY ?? null,
            [prefix + 'MaxX']: rect?.maxX ?? null,
            [prefix + 'MaxY']: rect?.maxY ?? null,
            [prefix + 'Width']: rect?.width ?? null,
            [prefix + 'Height']: rect?.height ?? null,
        };
    }

    _rowsDisplayBoundsSummary(rows){
        if (!rows?.length || !this.geojsDisplay?._rowDisplayBounds) return null;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let validCount = 0;
        const samples = [];
        for (const row of rows) {
            const bounds = this.geojsDisplay._rowDisplayBounds(row);
            if (!bounds || ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) continue;
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
            validCount += 1;
            if (samples.length < 8) {
                samples.push({
                    id: row?.id,
                    minX: Number(bounds.minX.toFixed(2)),
                    minY: Number(bounds.minY.toFixed(2)),
                    maxX: Number(bounds.maxX.toFixed(2)),
                    maxY: Number(bounds.maxY.toFixed(2)),
                    width: Number((bounds.maxX - bounds.minX).toFixed(2)),
                    height: Number((bounds.maxY - bounds.minY).toFixed(2)),
                });
            }
        }
        if (!validCount) return {validCount: 0, sampleRows: []};
        return {
            validCount,
            minX: Number(minX.toFixed(2)),
            minY: Number(minY.toFixed(2)),
            maxX: Number(maxX.toFixed(2)),
            maxY: Number(maxY.toFixed(2)),
            width: Number((maxX - minX).toFixed(2)),
            height: Number((maxY - minY).toFixed(2)),
            sampleRows: samples,
        };
    }

    _uniqueRows(rows){
        const seen = new Set();
        return (rows || []).filter((row) => {
            const id = row?.id;
            if (id === undefined || id === null || seen.has(id)) return false;
            seen.add(id);
            return true;
        });
    }

    _geojsDirectRowsInArea(ev, onlyFullyContained = false, downDisplayPoint = null){
        if (!this.geojsDisplay?.enabled) return [];
        const deselectMode = this.selection_action === 'deselect';
        const currentDisplayPoint = this._eventDisplayPoint(ev);
        const hasDisplaySelectionRect = Boolean(downDisplayPoint && currentDisplayPoint);
        const displayRectangleRows = this.geojsDisplay.findDirectEmbeddingRowsInDisplayRectangle
            || this.geojsDisplay.findRowsInDisplayRectangle;
        const displayRectangleCenterRows = this.geojsDisplay.findDirectEmbeddingRowsInDisplayRectangleByCenter
            || this.geojsDisplay.findRowsInDisplayRectangleByCenter;
        const useDisplaySelectionRows = Boolean(hasDisplaySelectionRect && displayRectangleRows);
        const displaySourceRows = useDisplaySelectionRows
            ? (deselectMode && displayRectangleCenterRows
                ? displayRectangleCenterRows.call(this.geojsDisplay, currentDisplayPoint, downDisplayPoint)
                : displayRectangleRows.call(this.geojsDisplay, currentDisplayPoint, downDisplayPoint, onlyFullyContained))
            : [];
        const projectSourceRows = !useDisplaySelectionRows && ev?.point && ev?.downPoint
            ? (deselectMode && this.geojsDisplay.findRowsInProjectRectangleByCenter
                ? this.geojsDisplay.findRowsInProjectRectangleByCenter(ev.point, ev.downPoint)
                : this.geojsDisplay.findRowsInProjectRectangle?.(ev.point, ev.downPoint, onlyFullyContained))
            : [];
        const {
            rows,
            hitRows,
            displayHitRows,
            projectHitRows,
            source,
        } = chooseDirectSelectionRows({
            displayRows: useDisplaySelectionRows ? displaySourceRows : null,
            projectRows: projectSourceRows,
            action: this.selection_action || 'select',
            isSelectedId: (id) => this.geojsDisplay?.isEmbeddingSelectedId?.(id),
            preferDisplay: useDisplaySelectionRows,
        });
        const displayRect = this._pointRectSummary(downDisplayPoint, currentDisplayPoint);
        const projectRect = this._pointRectSummary(ev?.downPoint, ev?.point);
        this._lastGeojsDirectHitHadRows = hitRows.length > 0;
        const debugDetails = {
            action: this.selection_action || 'select',
            source,
            displayRectAvailable: hasDisplaySelectionRect,
            usedDisplayRectangle: useDisplaySelectionRows,
            skippedProjectRectangle: useDisplaySelectionRows,
            rowCount: rows.length,
            hitRowCount: hitRows.length,
            displayHitRowCount: displayHitRows.length,
            projectHitRowCount: projectHitRows.length,
            filteredToSelected: deselectMode,
            matchMode: deselectMode ? 'center' : (onlyFullyContained ? 'contained' : 'overlap'),
            firstId: rows[0]?.id,
            lastId: rows[rows.length - 1]?.id,
            onlyFullyContained,
            displayRect,
            projectRect,
            ...this._flatRectSummary('display', displayRect),
            ...this._flatRectSummary('project', projectRect),
        };
        if (isDebugEnabled('geojs.selection')) {
            debugDetails.rowDisplayBounds = this._rowsDisplayBoundsSummary(rows);
            debugDetails.displayHitBounds = this._rowsDisplayBoundsSummary(displayHitRows);
            debugDetails.projectHitBounds = this._rowsDisplayBoundsSummary(projectHitRows);
        }
        debugDetails.displayHitIdSampleJson = JSON.stringify(displayHitRows.slice(0, 12).map((row) => row.id));
        debugDetails.projectHitIdSampleJson = JSON.stringify(projectHitRows.slice(0, 12).map((row) => row.id));
        debugDetails.resultIdSampleJson = JSON.stringify(rows.slice(0, 12).map((row) => row.id));
        debugDetails.eventSummary = this._eventDebugSummary(ev);
        debugLogJson('geojs.selection', 'direct-hit-test-area', debugDetails);
        return rows;
    }

    _paperBoundsItemsAtPoint(point){
        const tolerance = this.getTolerance(5);
        return this.project.paperScope.annotationToolkit.getFeatures().filter((item) => {
            const bounds = this._paperItemProjectBounds(item);
            if (!bounds) return false;
            const expanded = bounds.clone();
            expanded.expand(tolerance * 2, tolerance * 2);
            return expanded.contains(point);
        });
    }

    _paperBoundsItemsInRectangle(pointA, pointB, onlyFullyContained){
        const testRectangle = new paper.Rectangle(pointA, pointB);
        const tolerance = this.getTolerance(2);
        testRectangle.expand(tolerance * 2, tolerance * 2);
        return this.project.paperScope.annotationToolkit.getFeatures().filter((item) => {
            const itemBounds = this._paperItemProjectBounds(item);
            if (!itemBounds) return false;
            return onlyFullyContained
                ? testRectangle.contains(itemBounds)
                : testRectangle.intersects(itemBounds) || testRectangle.contains(itemBounds) || itemBounds.contains(testRectangle);
        });
    }

    _paperItemProjectBounds(item){
        const imageBounds = item?.data?.geojsImageBounds;
        const tiledImage = item?.data?.tiledImage;
        if (imageBounds && tiledImage) {
            const values = [imageBounds.left, imageBounds.top, imageBounds.width, imageBounds.height].map(Number);
            if (values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
                const [left, top, width, height] = values;
                const layer = tiledImage._paperLayerMap?.get?.(this.project.paperScope) || item.layer || item.parent;
                const points = [
                    new paper.Point(left, top),
                    new paper.Point(left + width, top),
                    new paper.Point(left + width, top + height),
                    new paper.Point(left, top + height),
                ].map((point) => layer?.matrix?.transform ? layer.matrix.transform(point) : point);
                return this._boundsFromPoints(points);
            }
        }

        const bounds = item?.bounds;
        if (!bounds) return null;
        return bounds.clone ? bounds.clone() : new paper.Rectangle(bounds.left, bounds.top, bounds.width, bounds.height);
    }

    _boundsFromPoints(points){
        const finitePoints = points.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
        if (!finitePoints.length) return null;
        const limits = finitePoints.reduce((acc, point) => ({
            minX: Math.min(acc.minX, point.x),
            minY: Math.min(acc.minY, point.y),
            maxX: Math.max(acc.maxX, point.x),
            maxY: Math.max(acc.maxY, point.y),
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        return new paper.Rectangle(
            new paper.Point(limits.minX, limits.minY),
            new paper.Point(limits.maxX, limits.maxY),
        );
    }

    _uniqueItems(items){
        const seen = new Set();
        return items.filter((item) => {
            if (!item || seen.has(item)) return false;
            seen.add(item);
            return true;
        });
    }

    clearSelection({ notify = true } = {}) {
        const selectedItems = this.project.paperScope.findSelectedItems()
            .filter((item) => this._isItemSelectable(item));
        this._lastSelectionItems = selectedItems;
        this._lastSelectionEmbeddingIds = [];
        this._replaceSelectionOnSync = false;
        selectedItems.forEach((item) => item.deselect(true));
        this.geojsDisplay?.scheduleUpdate();

        if (notify && selectedItems.length > 0) {
            const previousAction = this.selection_action;
            this.selection_action = 'deselect';
            this.onSelectionChanged?.();
            this.selection_action = previousAction;
        }

        return selectedItems;
    }

    _applySelectionAction(items, keepExistingSelection, singleClick){
        const selectableItems = items.filter(item=>item && this._isItemSelectable(item));
        this._lastSelectionItems = selectableItems;
        this._lastSelectionEmbeddingIds = [];
        const action = this.selection_action || 'select';
        this._replaceSelectionOnSync = false;
        debugLog('geojs.selection', 'paper-selection-action', {
            action,
            itemCount: selectableItems.length,
            firstEmbeddingId: selectableItems[0]?.embedding_id ?? selectableItems[0]?.data?.embedding_id ?? null,
            keepExistingSelection,
            singleClick,
        });

        if (action === 'deselect') {
            selectableItems.forEach(item=>item.deselect(true));
            this.onSelectionChanged?.();
            this.geojsDisplay?.scheduleUpdate();
            return;
        }

        if (action === 'select') {
            selectableItems.forEach(item=>item.select(true));
            if (selectableItems.length > 0) {
                this.onSelectionChanged?.();
            }
            this.geojsDisplay?.scheduleUpdate();
            return;
        }

        selectableItems.forEach(item=>item.toggle(keepExistingSelection));
        this.geojsDisplay?.scheduleUpdate();
    }

    _applyEmbeddingSelectionAction(ids, keepExistingSelection, singleClick){
        const action = this.selection_action || 'select';
        const uniqueIds = Array.from(new Set((ids || []).filter((id) => id !== undefined && id !== null).map(String)));
        const actionIds = action === 'deselect' && this.geojsDisplay?.isEmbeddingSelectedId
            ? uniqueIds.filter((id) => this.geojsDisplay.isEmbeddingSelectedId(id))
            : uniqueIds;
        this._lastSelectionItems = [];
        this._lastSelectionEmbeddingIds = actionIds;
        this._replaceSelectionOnSync = false;
        debugLogJson('geojs.selection', 'id-selection-action', {
            action,
            idCount: actionIds.length,
            hitIdCount: uniqueIds.length,
            filteredToSelected: action === 'deselect',
            firstId: actionIds[0] ?? null,
            lastId: actionIds[actionIds.length - 1] ?? null,
            keepExistingSelection,
            singleClick,
            idSampleJson: JSON.stringify(actionIds.slice(0, 24)),
            hitIdSampleJson: JSON.stringify(uniqueIds.slice(0, 24)),
        });
        if (!actionIds.length) return;
        this.onSelectionChanged?.();
        this.geojsDisplay?.scheduleUpdate();
    }

    _isItemSelectable(item){
        return !!item?.isGeoJSONFeature;
    }
}
export{SelectTool};


class SelectToolbar extends AnnotationUIToolbarBase{
    constructor(tool){
        super(tool);
        this.dropdown.classList.add('select-dropdown');
        
        const i = makeFaIcon('fa-arrow-pointer');
        this.button.configure(i,'Selection Tool');
        
        const s = document.createElement('div');
        s.setAttribute('data-active', 'select');
        this.dropdown.appendChild(s);
        const span = document.createElement('span');
        span.innerHTML = '(Ctrl)click or drag to select items.';
        s.append(span);        
    }
    
    isEnabledForMode(mode){
        return this.tool.doAnnotationItemsExist();
    }
    
}