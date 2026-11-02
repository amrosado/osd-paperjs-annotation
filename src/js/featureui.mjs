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

import {EditableContent} from './utils/editablecontent';
import { domObjectFromHTML } from './utils/domObjectFromHTML';
import { datastore } from './utils/datastore';
import { convertFaIcons } from './utils/faIcon';

/**
 * A user interface for managing features.
 * @class
 * @memberof OSDPaperjsAnnotation
 */
class FeatureUI{
    /**
     * Create a new FeatureUI instance.
     * @constructor
     * @param {paper.Item} paperItem - The paper item object.
     * @param {object} [opts] - The initialization options.
     * @param {IconFactory} [opts.iconFactory] - the IconFactory to use
     */
    constructor(paperItem, opts){
        
        this.paperItem=paperItem;
        let el = this._element = makeFeatureElement();
        opts.iconFactory ? opts.iconFactory.convertFaIcons(el) : convertFaIcons(el);

        this.paperItem.FeatureUI = this;
        this._editableName = new EditableContent();
        el.querySelector('.feature-item.name').appendChild(this._editableName.element);
        this._editableName.onChanged = text => {
            this.setLabel(text,'user-defined');
        };
        this._editableName.onEditClicked = function(event){
            event.preventDefault();
            event.stopPropagation();
        }
        
        datastore.set(el, {feature:this});
        el.addEventListener('click', ev => {
            if(ev.target.matches('[data-action]')){
                //don't bubble up
                ev.stopPropagation();
                ev.stopImmediatePropagation();
                ev.preventDefault();
                let action = ev.target.dataset.action;
                switch(action){
                    case 'trash': this.removeItem(); break;
                    case 'bounds': this.useAsBoundingElement(true); break;
                    case 'style':this.openStyleEditor(ev); break;
                    case 'zoom-to':this.centerItem(); break;
                    default: console.log('No function set for action:',action);
                }
            }
        });
        
        el.addEventListener('click',ev => {
            ev.stopPropagation();
            this.paperItem.toggle((ev.metaKey || ev.ctrlKey));
        })
        
        this.element = el;
        this.paperItem.on({
            'selected':()=>{ 
                el.classList.add('selected');
                el.dispatchEvent(new Event('selected')); 
            },
            'deselected':()=>{ 
                el.classList.remove('selected');
                el.dispatchEvent(new Event('deselected')); 
            },
            'selection:mouseenter':()=>{ 
                el.classList.add('item-hovered');
            },
            'selection:mouseleave':()=>{ 
                el.classList.remove('item-hovered');
            },
            'item-replaced':(ev)=>{ 
                // console.log('item-replaced',ev);
                //check label first because it is dynamically fetched from the referenced this.paperItem object
                if(this.label?.source=='user-defined'){
                    ev.item.displayName = this.label;
                }
                this.paperItem = ev.item;
                this.paperItem.FeatureUI=this;
                this.updateLabel();
            },
            'display-name-changed':(ev)=>{ 
                this.updateLabel();
            },
            'removed':(ev)=>{ 
                if(ev.item == this.paperItem){
                    this.remove();
                }
            }
        });

        if(this.paperItem.selected){
            this.paperItem.emit('selected');
        }

        // A list label must not modify an annotation while projecting a remote tree.
        this.label ? this.updateLabel() : this._editableName.setText('Creating...');
        
    }

    get label(){
        return this.paperItem.displayName;
    }
    set label(l){
        return this.setLabel(l)
    }
    /**
     * Set the label of the feature with a source.
     * @param {string} text - The new label of the feature.
     * @param {string} source - The source of the label (e.g. 'user-defined' or 'initializing').
     * @returns {string} The new label of the feature.
     */
    setLabel(text,source){
        let l = new String(text);
        l.source=source;
        this.paperItem.displayName = l;
        this.updateLabel();
        return l;
    }
    /**
     * Update the label of the feature in the UI element.
     */
    updateLabel(){
        if (this._editableName.element.classList.contains('editing')) return;
        // this._element.find('.feature-item.name').text(this.label);//.trigger('value-changed',[l]);
        this._editableName.setText(this.label);
    }
    /**
     * Remove the paper item associated with the feature.
     */
    removeItem(){        
        //clean up paperItem
        this.paperItem.remove();
        this.paperItem.deselect();
    }
    /**
     * Remove the UI element associated with the feature.
     */
    remove(){
        this._element.remove();
        this._element.dispatchEvent( new Event('removed') );
    }
    
    
    /**
     * Use the feature as a bounding element.
     * @param {boolean} [toggle=false] - Whether to toggle the bounding element status or not.
     * @returns {boolean} Whether the feature is used as a bounding element or not.
     */
    useAsBoundingElement(toggle=false){
        if(!this.paperItem.canBeBoundingElement) return false;
        let element = this._element.querySelector('[data-action="bounds"]');
        if(toggle){
            element.classList.toggle('active');
        } else {
            element.classList.add('active');
        }
        let isActive = element.classList.contains('active');
        this.paperItem.isBoundingElement = isActive;
        return isActive;
    }   
    /**
     * Open the style editor for the feature.
     */ 
    openStyleEditor(){
        let heard = this.paperItem.project.emit('edit-style',{item:this.paperItem});
        if(!heard){
            console.warn('No event listeners are registered for paperScope.project for event \'edit-style\'');
        }
    }
    /**
     * Center the feature in the viewport.
     * @param {boolean} [immediately=false] - Whether to center the feature immediately or not.
     */
    centerItem(immediately = false){
        const viewer = this.paperItem?.project?.overlay?.viewer;
        const viewport = viewer?.viewport;
        const bounds = this.paperItem?.bounds;
        if (!viewport || !bounds || !Number.isFinite(bounds.center?.x) || !Number.isFinite(bounds.center?.y)) return;
        // Point markers are tiny in image space; keep a readable minimum view around them.
        const minSpan = 480;
        const width = Math.max(Number(bounds.width) || 0, minSpan);
        const height = Math.max(Number(bounds.height) || 0, minSpan);
        const centerX = bounds.center.x;
        const centerY = bounds.center.y;
        try {
            if (typeof viewport.imageToViewportRectangle === 'function' && typeof viewport.fitBounds === 'function') {
                const rect = viewport.imageToViewportRectangle({
                    x: centerX - width / 2,
                    y: centerY - height / 2,
                    width,
                    height,
                });
                if (rect && rect.width > 0 && rect.height > 0) {
                    viewport.fitBounds(rect, immediately);
                    return;
                }
            }
            const center = viewport.imageToViewportCoordinates(centerX, centerY);
            if (Number.isFinite(center?.x) && Number.isFinite(center?.y)) {
                viewport.panTo(center, immediately);
            }
        } catch (error) {
            console.warn('Unable to center feature in viewport', error);
        }
    }
    
}
export {FeatureUI};
/**
  * Create an HTML element for the feature UI.
 * @private
 * @returns {jQuery} The jQuery object of the HTML element.
 */
function makeFeatureElement(){
    let html = `
    <div class='feature'>
        <div class='annotation-header hoverable-actions'>
            <span class='onhover fa-solid fa-crop-simple bounding-element' data-action="bounds" title='Bounding element'></span>
            <span class='feature-item name'></span>
            <span class='onhover fa-solid fa-palette' data-action='style' title='Open style editor'></span>
            <span class='fa-solid fa-binoculars' data-action='zoom-to' title='Go to this object'></span>
            <span class='onhover fa-solid fa-trash-can' data-action='trash' title='Remove'></span>
        </div>
    </div>
    `;
    return domObjectFromHTML(html);
}
