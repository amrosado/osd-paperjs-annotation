import {AnnotationUITool, AnnotationUIToolbarBase} from './annotationUITool.mjs';

/**
 * The RectangleTool class extends the AnnotationUITool and provides functionality for creating and modifying rectangles.
 * @extends AnnotationUITool
 * @class
 * @memberof OSDPaperjsAnnotation
 */
class RectangleTool extends AnnotationUITool{
    /**
     * Create a new RectangleTool instance.
    * @memberof OSDPaperjsAnnotation.RectangleTool
    * @param {paper.PaperScope} paperScope - The Paper.js scope for the tool.
    * @property {string} mode - The current mode of the RectangleTool.
    * @property {paper.Path.Rectangle|null} creating - The currently creating rectangle.
    * @property {paper.Point|null} refPoint - The reference point used for resizing rectangles.
    * @property {paper.Point|null} ctrlPoint - The control point used for resizing rectangles.
    * @description This tool provides users with the ability to create new rectangles by clicking and dragging on the canvas, as well as modifying existing rectangles by resizing and moving them. It offers options to control the shape and position of the rectangles, making it a versatile tool for annotating and highlighting areas of interest.
    */
    constructor(paperScope){
        super(paperScope);
        let self=this;

        let crosshairTool = new paper.Group({visible:false});
        let h1 = new paper.Path({segments:[new paper.Point(0,0),new paper.Point(0,0)],strokeScaling:false,strokeWidth:1,strokeColor:'black'});
        let h2 = new paper.Path({segments:[new paper.Point(0,0),new paper.Point(0,0)],strokeScaling:false,strokeWidth:1,strokeColor:'white',dashArray:[6,6]});
        let v1 = new paper.Path({segments:[new paper.Point(0,0),new paper.Point(0,0)],strokeScaling:false,strokeWidth:1,strokeColor:'black'});
        let v2 = new paper.Path({segments:[new paper.Point(0,0),new paper.Point(0,0)],strokeScaling:false,strokeWidth:1,strokeColor:'white',dashArray:[6,6]});
        crosshairTool.addChildren([h1,h2,v1,v2]);
        this.project.toolLayer.addChild(crosshairTool);
        
        /**
         * The current mode of the RectangleTool, which can be 'creating', 'corner-drag', 'fill-drag', or 'modifying'.
         * @type {string}
         */
        this.mode = null;
        /**
         * The currently creating rectangle during the drawing process.
         * @type {paper.Path.Rectangle|null}
         */
        this.creating = null;
        
        this.setToolbarControl(new RectToolbar(this));

    /**
     * Handles the mouse down event within the Paper.js project.
     * If an item is being created, it initializes the GeoJSON feature and updates the toolbar instructions.
     * If an existing rectangle is clicked, it sets the mode accordingly for corner dragging or fill dragging.
     * @private
     * @param {Object} ev - The mouse down event object containing information about the cursor position.
     */
        this.tool.onMouseDown=function(ev){
            if(self.itemToCreate){
                self.itemToCreate.initializeGeoJSONFeature('Point', 'Rectangle');
                self.refreshItems();
                
                let r=new paper.Path.Rectangle(ev.point,ev.point);
                self.creating = r;
                self.item.removeChildren();
                self.item.addChild(r);
                self.mode='creating';
            }
            else if(self.item){
                // try hit test on corners first
                let result = self.item.hitTest(ev.point,{fill:false,stroke:false,segments:true,tolerance:5/self.project.getZoom()});
                if(result){
                    // crosshairTool.visible=true;
                    self.mode='corner-drag';
                    let idx=result.segment.path.segments.indexOf(result.segment);
                    let oppositeIdx=(idx+2) % result.segment.path.segments.length;
                    self.refPoint = result.segment.path.segments[oppositeIdx].point;
                    self.ctrlPoint = result.segment.point.clone();
                    return;
                }
                
                // next hit test on "fill"
                if(self.item.contains(ev.point)){
                    // crosshairTool.visible=true;
                    self.mode='fill-drag';
                    return;
                }
            }
        }
    /**
     * Handles the mouse drag event within the Paper.js project.
     * Depending on the mode, it updates the rectangle being created, resized, or moved.
     * @private
     * @param {Object} ev - The mouse drag event object containing information about the cursor position and movement.
     */
        this.tool.onMouseDrag=function(ev){
            let refPt, currPt, angle;
            let center = self.item.center;
            if(self.mode=='creating'){
                angle = -self.item.view.getRotation();
                refPt = ev.downPoint;
                
                if(ev.modifiers.command || ev.modifiers.control){
                    let delta = ev.point.subtract(ev.downPoint);
                    let axes = [[1,1],[1,-1],[-1,-1],[-1,1]].map(p=>new paper.Point(p[0],p[1]).rotate(angle));
                    let closestAxis = axes.sort( (a, b) => a.dot(delta) - b.dot(delta))[0];
                    let proj = delta.project(closestAxis);
                    currPt = ev.downPoint.add(proj);
                } else {
                    currPt = ev.point;
                }
            } else if(self.mode=='corner-drag'){
                angle = self.item.children[0].segments[1].point.subtract(self.item.children[0].segments[0].point).angle;
                refPt = self.refPoint;

                if(ev.modifiers.command || ev.modifiers.control){
                    let delta = ev.point.subtract(self.refPoint);
                    let axis = self.ctrlPoint.subtract(self.refPoint);
                    let proj = delta.project(axis);
                    currPt = self.refPoint.add(proj);
                } else {
                    currPt = ev.point;
                }
            } else if(self.mode == 'fill-drag') {
                self.item.translate(ev.delta);
                return;
            } else{
                setCursorPosition(this,ev.point);
                return;
            }
            setCursorPosition(this,currPt);
            let r=new paper.Rectangle(refPt.rotate(-angle,center),currPt.rotate(-angle, center));
            let corners = [r.topLeft, r.topRight, r.bottomRight, r.bottomLeft].map(p=>p.rotate(angle,center));
            self.item.children[0].set({segments:corners})
        }
    /**
     * Handles the mouse move event within the Paper.js project.
     * If in modifying mode, it checks if the cursor is over a corner for resizing or over the fill for moving.
     * @private
     * @param {Object} ev - The mouse move event object containing information about the cursor position.
     */
        this.tool.onMouseMove=function(ev){
            setCursorPosition(this,ev.point);
            if(self.mode == 'modifying'){
                let hitResult = self.item.hitTest(ev.point,{fill:false,stroke:false,segments:true,tolerance:5/self.project.getZoom()});
                if(hitResult){
                    self.project.overlay.addClass('rectangle-tool-resize');
                } else{
                    self.project.overlay.removeClass('rectangle-tool-resize');
                }

                if(self.item.contains(ev.point)){
                    self.project.overlay.addClass('rectangle-tool-move');
                } else {
                    self.project.overlay.removeClass('rectangle-tool-move');
                }
            }
        }   
        
        /**
        * @private
        * Handles the mouse up event within the Paper.js project.
        * It sets the mode to 'modifying' and hides the crosshair tool.
        */
        this.tool.onMouseUp = function(){
            self.mode='modifying';
            crosshairTool.visible=false;
            self.creating=null;
            self.toolbarControl.updateInstructions('Point:Rectangle');
        }
        this.extensions.onActivate = this.onSelectionChanged = function(){
            if(self.itemToCreate){
                self.mode='creating';
                crosshairTool.visible = true;
                self.creating = null;//reset reference to actively creating item
                self.toolbarControl.updateInstructions('new');
            }
            else if(self.creating && self.creating.parent==self.item){
                self.mode='creating';
                crosshairTool.visible = true;
                self.toolbarControl.updateInstructions('new');
            }
            else if (self.item){
                self.creating=null;//reset reference to actively creating item
                self.mode='modifying';
                crosshairTool.visible = false;
                self.toolbarControl.updateInstructions('Point:Rectangle');
            }
            else {
                // self.creating=null;//reset reference to actively creating item
                // self.mode=null;
                // crosshairTool.visible = false;
                // self.toolbarControl.updateInstructions('Point:Rectangle');
                self.deactivate();
            }
        }
        this.extensions.onDeactivate = function(finished){
            if(finished) self.creating = null;
            crosshairTool.visible=false;
            self.mode=null;
            self.project.overlay.removeClass('rectangle-tool-resize');
        }
        /**
         * Sets the position of the cursor crosshair tool based on the given point.
         * The crosshair tool consists of horizontal and vertical lines indicating the cursor position.
         * @private
         * @param {paper.Tool} tool - The Paper.js Tool associated with the cursor events.
         * @param {paper.Point} point - The point representing the cursor position.
         */
        function setCursorPosition(tool,point){
            //to do: account for view rotation
            // let viewBounds=tool.view.bounds;
            let pt = tool.view.projectToView(point);
            let left=tool.view.viewToProject(new paper.Point(0, pt.y))
            let right=tool.view.viewToProject(new paper.Point(tool.view.viewSize.width, pt.y))
            let top=tool.view.viewToProject(new paper.Point(pt.x, 0))
            let bottom=tool.view.viewToProject(new paper.Point(pt.x,tool.view.viewSize.height))
            // console.log(viewBounds)
            h1.segments[0].point = left;
            h2.segments[0].point = left;
            h1.segments[1].point = right;
            h2.segments[1].point = right;
            v1.segments[0].point = top;
            v2.segments[0].point = top;
            v1.segments[1].point = bottom;
            v2.segments[1].point = bottom;
        }
    }
    
}

export {RectangleTool};

/**
 * The RectToolbar class extends the AnnotationUIToolbarBase and provides a toolbar for the RectangleTool.
 * @extends AnnotationUIToolbarBase
 * @memberof OSDPaperjsAnnotation.RectangleTool#
 */
class RectToolbar extends AnnotationUIToolbarBase{
    /**
     * Create a new RectToolbar instance.
     * @param {RectangleTool} tool - The RectangleTool instance.
     */
    constructor(tool){
        super(tool);
        let html = $('<i>',{class:'fa-solid fa-vector-square'})[0];
        this.button.configure(html,'Rectangle Tool');
        this.instructions = $('<span>').text('Click and drag to create a rectangle').appendTo(this.dropdown);
    }
    /**
     * Check if the toolbar is enabled for the specified mode.
     * @param {string} mode - The mode to check.
     * @returns {boolean} True if the toolbar is enabled for the mode, false otherwise.
     */
    isEnabledForMode(mode){
        return ['new','Point:Rectangle'].includes(mode);
    }
    /**
     * Update the instructions text based on the mode.
     * @param {string} mode - The current mode.
     */
    updateInstructions(mode){
        this.instructions.text(mode=='new'?'Click and drag to create a rectangle' : mode=='Point:Rectangle' ? 'Drag a corner to resize' : '???' )
    }
}