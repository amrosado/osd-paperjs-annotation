import { AnnotationItem } from './annotationitem.mjs';

/*
 * Raster - contains pixel data for a rectangular region, with an optional clip mask
 * pseudo-GeoJSON definition:
 * {
 *   type: Feature
 *   geometry:{
 *     type: GeometryCollection,
 *     properties:{
 *       subtype: Raster,
 *       raster: {
 *          data: [Raster data],
 *          width: width of raster image,
 *          height: height of raster image,
 *          center: center of raster object [x, y],
 *          scaling: scaling applied to raster object [x, y],
 *          rotation: rotation applied to raster object,
 *       },
 *       transform: matrix
 *     }
 *     geometries:[ Array of GeoJSON Geometry objects ],
 *   }
 * 
 **/

export class Raster extends AnnotationItem{
    constructor(geoJSON){
        super(geoJSON);
        if (geoJSON.geometry.type !== 'GeometryCollection' || geoJSON.geometry.properties.subtype !== 'Raster') {
            error('Bad geoJSON object: type !=="GeometryCollection" or subtype !=="Raster"');
        }

        //handle composition by geoJSON definition or by pre-constructed paper items
        let inputRaster = geoJSON.geometry.properties.raster;
        let inputClip = geoJSON.geometry.geometries;

        if(!inputRaster){
            error('Bad input: geometry.properties.raster must hold raster data, or a paper.Raster object');
        }

        let raster;
        if(inputRaster.data instanceof paper.Raster){
            raster = inputRaster.data;
        } else {
            raster = new paper.Raster(inputRaster.data);
            raster.translate(inputRaster.center[0], inputRaster.center[1]);
            raster.scale(inputRaster.scaling[0], inputRaster.scaling[1]);
            raster.rotate(inputRaster.rotation);
        }
        
        raster.selectedColor = rasterColor;

        

        let grp = new paper.Group([raster]);
        grp.updateFillOpacity = function(){
            paper.Group.prototype.updateFillOpacity.call(this);
            raster.opacity = this.opacity * this._computedFillOpacity;
            if(grp.clipped){
                grp.children[0].fillColor = null;
            }
        }
        if(inputClip.length > 0){
            let clipGroup = new paper.Group();
            grp.insertChild(0, clipGroup);
            grp.clipped = true; //do this after adding the items, so the stroke style is deleted
            inputClip.forEach(i => {
                let item = i instanceof paper.Item ? paper.Item.fromAnnotationItem(i) : paper.Item.fromGeoJSON(i);
                delete item.isGeoJSONFeature; //so it doesn't trigger event handlers about new features being added/moved/removed
                item._annotationItem = item.annotationItem; //rename to private property
                delete item.annotationItem; //so it isn't found by descendants query
                setTimeout(()=>item.strokeColor = (i.properties||i).strokeColor);
                item.strokeWidth = (i.properties||i).strokeWidth;
                item.rescale = (i.properties||i).rescale;
                clipGroup.addChild(item);
            });
            
        }

        if(geoJSON.geometry.properties.transform){
            grp.matrix = new paper.Matrix(geoJSON.geometry.properties.transform);
        }

        grp.on('selected',()=>{
            grp.clipped && (grp.children[0].selected = false);
        })
        
        this.paperItem = grp;
    }
    static get supportsType(){
        return {
            type: 'GeometryCollection',
            subtype: 'Raster'
        }
    }
    toGeoJSONGeometry(){
        let item = this.paperItem;
        let clipGroup = item.children[0];
        let raster = item.children[1];
        let geom = {
            type: 'GeometryCollection',
            properties: {
                subtype: 'Raster',
                raster: {
                    data:raster.toDataURL(),
                    center: [raster.bounds.center.x, raster.bounds.center.y],
                    width: raster.width,
                    height: raster.height,
                    scaling: [raster.matrix.scaling.x, raster.matrix.scaling.y],
                    rotation: raster.matrix.rotation,
                },
                transform: item.matrix.values,
            },
            geometries:clipGroup.children.map(item=>{
                let feature = item._annotationItem.toGeoJSONFeature();
                let geometry = feature.geometry;
                geometry.properties.strokeColor = feature.properties.strokeColor;
                geometry.properties.strokeWidth = feature.properties.strokeWidth;
                geometry.properties.rescale = feature.properties.rescale;
                return geometry;
            })
        }
        return geom;
    }
}

const rasterColor = new paper.Color(0,0,0,0);
