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

import { AnnotationItem } from "./annotationitem.mjs";
import { paper } from '../paperjs.mjs';
import { normalizePointTextStyle, POINT_TEXT_OFFSET, POINT_TEXT_MARKER_RADIUS, pointTextOffsetForMatrix } from '../utils/pointTextStyle.mjs';

/**
 * Represents a point with text annotation item.
 * @class
 * @memberof OSDPaperjsAnnotation
 * @extends AnnotationItem
 * @description The `PointText` class represents a point with text annotation item. It inherits from the `AnnotationItem` class and provides methods to work with point text annotations.
 */
class PointText extends AnnotationItem{
     /**
     * Create a new PointText instance.
     * @param {Object} geoJSON - The GeoJSON object containing annotation data.
     * @property {paper.Group} _paperItem - The associated paper item representing the point with text.
     * @description This constructor initializes a new point with text annotation item based on the provided GeoJSON object.
     */
    constructor(geoJSON){
        super(geoJSON);

        if (geoJSON.geometry.type !== 'Point') {
            error('Bad geoJSON object: type !=="Point"');
        }
        const point = new paper.Group({applyMatrix: false});
        point.pivot = new paper.Point(0, 0);
        point.addChild(new paper.Path.Circle(new paper.Point(0, 0), POINT_TEXT_MARKER_RADIUS));
        point.addChild(new paper.PointText({point: new paper.Point(POINT_TEXT_OFFSET),
            content: geoJSON.geometry.properties?.content || 'PointText'}));
        point.position = new paper.Point(...geoJSON.geometry.coordinates.slice(0, 2));
        point.data.pointTextStyle = normalizePointTextStyle(geoJSON.properties);
        point.rescale = {strokeWidth: 2, size: () => this.applyScreenStyle()};
        // The whole item is in screen pixels. Generic rescale would divide the
        // stroke a second time and spread the marker stroke onto the glyphs.
        point.applyRescale = () => this.applyScreenStyle();
        this.paperItem = point;
        point.children[1].on('content-changed', () => this.refreshTextOffset());
        this.applyScreenStyle();
    }

    setStyle(properties = {}) {
        const item = this.paperItem;
        const incoming = {...properties};
        item.data.pointTextStyle = normalizePointTextStyle({...item.data.pointTextStyle,
            ...('fontSize' in incoming ? {fontSize: incoming.fontSize} : {}),
            ...('fontFamily' in incoming ? {fontFamily: incoming.fontFamily} : {})});
        delete incoming.fontSize;
        delete incoming.fontFamily;
        if (incoming.strokeColor) incoming.strokeColor = new paper.Color(incoming.strokeColor);
        const strokeWidth = Number(incoming.rescale?.strokeWidth ?? incoming.strokeWidth);
        if (Number.isFinite(strokeWidth) && strokeWidth >= 0) item.rescale.strokeWidth = strokeWidth;
        super.setStyle(incoming);
    }

    applyScreenStyle() {
        const item = this.paperItem;
        if (!item?.parent || !item.view) return;
        // Cancel the complete parent-to-view linear transform, including image
        // scale, layout, rotation and flip. Keep the anchor in image coordinates.
        const inverse = item.parent.viewMatrix.inverted();
        if (!inverse) return;
        const viewer = item.project._scope.annotationToolkit?.viewer;
        if (viewer?.isGeoJSTileViewer) inverse.append(new paper.Matrix().rotate(-Number(viewer._viewportRotation || 0)));
        const anchor = item.position.clone();
        item.matrix.set(inverse.a, inverse.b, inverse.c, inverse.d, anchor.x, anchor.y);
        const textStyle = item.data.pointTextStyle;
        this.circle.strokeWidth = Number(item.rescale.strokeWidth);
        this.circle.fillColor = null;
        this.circle.strokeOpacity = item.strokeOpacity;
        this.circle.updateStrokeOpacity();
        this.textitem.fontSize = textStyle.fontSize;
        this.textitem.fontFamily = textStyle.fontFamily;
        this.textitem.fillColor = this.circle.strokeColor?.clone() || new paper.Color('black');
        this.textitem.strokeColor = null;
        this.textitem.strokeWidth = 0;
        this.refreshTextOffset();
    }
    /**
     * Get the text item associated with the point.
     * @returns {paper.PointText} The associated text item.
     */
    get textitem(){
        return this.paperItem.children[1];
    }

    /**
     * Get the circle that represents the point.
     * @returns {paper.Path.Circle} The circle
     */
    get circle(){
        return this.paperItem.children[0];
    }

    /**
     * Retrieves the supported types by the PointText annotation item.
     * @static
     * @param { String } type
     * @param { String } [subtype]
     * @returns {Boolean} Whether this constructor supports the requested type/subtype
     */
    static supportsGeoJSONType(type, subtype){
        return typeof type === 'string' && type.toLowerCase() === 'point' && subtype?.toLowerCase() === 'pointtext';
    }

    /**
     * Get the type of this object.
     * @returns { Object } with fields `type === 'Point'` and `subtype === 'PointText'`
     */
    getGeoJSONType(){
        return {
            type: 'Point',
            subtype: 'PointText'
        }
    }

    /**
    * Get the coordinates of the point.
    * @returns {Array<number>} The coordinates of the point.
    */
    getCoordinates(){
        const item = this.paperItem;
        const anchor = item.layer.globalToLocal(item.localToGlobal(new paper.Point(0, 0)));
        return [anchor.x, anchor.y];
    }
    /**
     * Get the properties of the point.
     * @returns {Object} The properties of the point.
     */
    getProperties(){
        let item = this.paperItem;
        return {
            content: item.children[1].content,
        };
    }
    /**
     * Get the style properties of the point for GeoJSON export.
     * @returns {Object} The style properties in JSON format.
     * @description Returns drawing style from the circle (strokeColor, fillColor, etc.) merged with
     * serializable rescale from the group (e.g. strokeWidth) so both colors and logical stroke width round-trip.
     */
    getStyleProperties(){
        const circleStyle = this.paperItem.children[0].style.toJSON();
        const strokeWidth = Number(this.paperItem.rescale.strokeWidth);
        return {...circleStyle, ...this.paperItem.data.pointTextStyle,
            strokeWidth, rescale: {strokeWidth}};
    }
    /**
     * Handle transformation operations on the point.
     * @static
     * @param {string} operation - The type of transformation operation.
     * @description This static method handles transformation operations on the point annotation.
     */
    static onTransform(){
        let operation = arguments[0];
        switch(operation){
            case 'rotate':{
                let angle = arguments[1];
                let center = arguments[2];
                this.rotate(-angle, center); //undo the rotation: return to original position and orientation
                let vector = this.position.subtract(center);
                let newpos = center.add(vector.rotate(angle));
                let delta = newpos.subtract(this.position);
                this.translate(delta);
                break;
            }
            case 'scale':{
                let p = arguments[1]; //reference position
                let r = arguments[2]; //rotation
                let m = arguments[3]; //matrix

                this.matrix.append(m.inverted()); //undo previous operation
                let pos = this.pivot.transform(this.matrix);
                // let pos = this.pivot;
                let a = pos.subtract(p); // initial vector, unrotated
                let ar = a.rotate(-r); // initial vector, rotated
                let br = ar.multiply(m.scaling); //scaled rotated vector
                let b = br.rotate(r); //scaled unrotated vector
                let delta = b.subtract(a); //difference between scaled and unscaled position

                this.translate(delta);
                break;
            }
        }
    }

    refreshTextOffset(){
        const viewer = this.paperItem.project._scope.annotationToolkit?.viewer;
        if (viewer) {
            const angle = Number(viewer.viewport.getRotation(true) || 0)
                + (viewer.isGeoJSTileViewer ? 0 : Number(this.paperItem.layer?.tiledImage?.getRotation?.() || 0));
            this.textitem.point = new paper.Point(POINT_TEXT_OFFSET).rotate(angle);
        } else this.textitem.point = new paper.Point(pointTextOffsetForMatrix(this.paperItem.parent?.viewMatrix));
    }
    
}
export{PointText};

