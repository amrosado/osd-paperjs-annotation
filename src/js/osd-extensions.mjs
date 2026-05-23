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

import { OpenSeadragon } from './osd-loader.mjs';
import { paper } from './paperjs.mjs';

let osdExtensionsInstalled = false;
let createPaperOverlayInstalled = false;

function definePrototypeProperty(proto, name, descriptor) {
    if (!Object.prototype.hasOwnProperty.call(proto, name)) {
        Object.defineProperty(proto, name, descriptor);
    }
}

function installOSDExtensions({ PaperOverlay } = {}) {
    if (!osdExtensionsInstalled) {
        osdExtensionsInstalled = true;

        definePrototypeProperty(OpenSeadragon.Viewer.prototype, 'PaperOverlays', {
            get: function PaperOverlays(){
                return this._PaperOverlays || (this._PaperOverlays = []);
            }
        });
        definePrototypeProperty(OpenSeadragon.Viewer.prototype, 'paperLayer', paperLayerDef());
        definePrototypeProperty(OpenSeadragon.TiledImage.prototype, 'paperLayer', paperLayerDef());
        definePrototypeProperty(OpenSeadragon.Viewport.prototype, 'paperLayer', paperLayerDef());
        definePrototypeProperty(OpenSeadragon.TiledImage.prototype, '_paperLayerMap', paperLayerMapDef());
        definePrototypeProperty(OpenSeadragon.Viewer.prototype, '_paperLayerMap', paperLayerMapDef());
        definePrototypeProperty(OpenSeadragon.Viewport.prototype, '_paperLayerMap', paperLayerMapDef());
        definePrototypeProperty(OpenSeadragon.Viewer.prototype, 'paperItems', paperItemsDef());
        definePrototypeProperty(OpenSeadragon.TiledImage.prototype, 'paperItems', paperItemsDef());
        definePrototypeProperty(OpenSeadragon.Viewport.prototype, 'paperItems', paperItemsDef());

        OpenSeadragon.Viewer.prototype._setupPaper ||= _setupPaper;
        OpenSeadragon.Viewport.prototype._setupPaper ||= _setupPaperForViewport;
        OpenSeadragon.TiledImage.prototype._setupPaper ||= _setupPaperForTiledImage;
        OpenSeadragon.Viewer.prototype.addPaperItem ||= addPaperItem;
        OpenSeadragon.Viewport.prototype.addPaperItem ||= addPaperItem;
        OpenSeadragon.TiledImage.prototype.addPaperItem ||= addPaperItem;
    }

    if (PaperOverlay && !createPaperOverlayInstalled && !OpenSeadragon.Viewer.prototype.createPaperOverlay) {
        createPaperOverlayInstalled = true;
        OpenSeadragon.Viewer.prototype.createPaperOverlay = function(){
            return new PaperOverlay(this, ...arguments);
        };
    }

    return OpenSeadragon;
}

/**
 * Define the paperItems property for a tiledImage.
 * @private
 * @returns {object} The property descriptor object.
 * @property {function} get - The getter function for paperItems.
 *   @returns {paper.Item[]} The array of paper item objects representing the items belonging to this TiledImage.
 */
function paperItemsDef(){
    return {
        get: function paperItems(){
            return this.paperLayer.children;
        }
    }
}


/**
 * @private
 */
function _createPaperLayer(osdObject, paperScope){
    let layer = new paper.Layer({applyMatrix:false});
    paperScope.project.addLayer(layer);
    osdObject._paperLayerMap.set(paperScope, layer);
    return layer;
}

/**
 * Define the paperLayer property for a tiledImage.
 * @private
 * @returns {object} The property descriptor object.
 * @property {function} get - The getter function for paperGroup.
 *   @returns {paper.Layer} The group that serves as the parent of all paper items belonging to this TiledImage.
 */
function paperLayerDef(){
    return {
        get: function paperLayer(){
            let numScopes = this._paperLayerMap.size;
            if( numScopes === 1){
                return this._paperLayerMap.values().next().value;
            } else if (numScopes === 0){
                return null;
            } else {
                return this._paperLayerMap.get(paper) || null;
            }
        }
    }
}
/**
 * Define the _paperLayerMap property for a tiledImage. Initializes the Map object the first time it is accessed.
 * @private
 * @returns {object} The property descriptor object.
 * @property {function} get - The getter function for paperGroup.
 *   @returns {Map} The mapping from paper.Scope to the layer within the scope corresponding to this object
 */
function paperLayerMapDef(){
    return {
        get: function _paperLayerMap(){
            if(!this.__paperLayerMap){
                this.__paperLayerMap = new Map();
            }
            return this.__paperLayerMap;
        }
    }
}

/**
 * @private
 * @returns {paper.Layer}
 */
function _setupPaper(overlay){
    return _createPaperLayer(this, overlay.paperScope);
}

/**
 * @private
 * 
 */
function _setupPaperForTiledImage(overlay){
    let _this = this;
    let layer = _setupPaper.call(this, overlay);
    let tiledImage = this;
    layer.tiledImage = tiledImage;
    
    function updateMatrix(){
        const scaleFactor = overlay.scaleFactor;
        const bounds = _this.getBoundsNoRotate();
        const sourceWidth = _this.source?.width || _this.source?.dimensions?.x || _this.getContentSize?.().x;
        if (!isFinitePositive(scaleFactor) || !isFinitePositive(bounds?.width) || !isFinitePositive(sourceWidth)) {
            return;
        }

        let degrees = _this.getRotation();
        let flipped = _this.getFlip();
        let center = new paper.Point((bounds.x+bounds.width/2) * scaleFactor, (bounds.y+bounds.height/2) * scaleFactor);
        let matrix = new paper.Matrix();

        if(flipped){
            matrix.scale(-1, 1, center)
        }
        matrix.rotate(degrees, center);
        matrix.translate({x: bounds.x * scaleFactor, y: bounds.y * scaleFactor});
        matrix.scale(bounds.width * scaleFactor / sourceWidth);
        // matrix.scale() // TODO how to flip the coordinates when the tiled image is flipped?

        layer.matrix.set(matrix);
    }
    tiledImage.addHandler('bounds-change',updateMatrix);
    overlay.addHandler('update-scale',updateMatrix);
    updateMatrix();
}

/**
 * @private
 * 
 */
function _setupPaperForViewport(overlay){
    let layer = _setupPaper.call(this, overlay);
    layer.viewport = this;
    
    updateMatrix();

    function updateMatrix(){
        const scaleFactor = overlay.scaleFactor;
        if (!isFinitePositive(scaleFactor)) {
            return;
        }
        layer.matrix.reset();
        layer.matrix.scale(scaleFactor);
    }
    
    overlay.addHandler('update-scale',updateMatrix);
}


function isFinitePositive(value){
    return Number.isFinite(value) && value > 0;
}

/**
 * @private
 */
function addPaperItem(item){
    if(this.paperLayer){
        this.paperLayer.addChild(item);
        item.applyRescale();
    } else {
        console.error('No layer has been set up in the active paper scope for this object. Does a scope need to be activated?');
    }
}

export { installOSDExtensions };
