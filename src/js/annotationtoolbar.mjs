/**
 * OpenSeadragon paperjs overlay plugin based on paper.js
 * @version 0.5.0
 *
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


import { OpenSeadragon } from './osd-loader';
import {ToolBase} from './papertools/base';
import {DefaultTool} from './papertools/default';
import {WandTool} from './papertools/wand';
import {BrushTool} from './papertools/brush';
import {PointTool} from './papertools/point';
import {PointTextTool} from './papertools/pointtext';
import {RectangleTool} from './papertools/rectangle';
import {EllipseTool} from './papertools/ellipse';
import {StyleTool} from './papertools/style';
import {LinestringTool} from './papertools/linestring';
import {PolygonTool} from './papertools/polygon';
import {SelectTool} from './papertools/select';
import {TransformTool} from './papertools/transform';
import {RasterTool} from './papertools/raster';




/**
 * A class for creating and managing annotation toolbars
 * @memberof OSDPaperjsAnnotation
 * @class
 */
class AnnotationToolbar {
    /**
     * @param {AnnotationToolset} toolset - The toolset to wrap (provides tools and mode).
     */
    constructor(toolset) {
        this.toolset = toolset;
        this.paperScope = toolset.paperScope;
        this.currentMode = toolset.currentMode;

        this.ui = this._makeUI();

        Object.keys(this.toolset.tools).forEach((name) => {
            const tool = this.toolset.getTool(name);
            const toolbarControl = tool && tool.getToolbarControl();
            if (toolbarControl) {
                this.addToolbarControl(toolbarControl);
            }
        });

        this._syncButtonsFromMode(this.toolset.currentMode);

        this.toolset.onModeChanged = (mode) => {
            this.currentMode = mode;
            this._syncButtonsFromMode(mode);
            const activeTool = this.paperScope.getActiveTool();
            if (activeTool) activeTool.selectionChanged();
        };
    }

    get element() {
        return this._element;
    }

    _syncButtonsFromMode(mode) {
        Object.keys(this.toolset.tools).forEach((name) => {
            const tool = this.toolset.getTool(name);
            const t = tool && tool.getToolbarControl();
            if (t) {
                t.isEnabledForMode(mode) ? t.button.enable() : t.button.disable();
            }
        });
    }

    addToolbarControl(toolbarControl) {
        const button = toolbarControl.button.element;
        const dropdown = toolbarControl.dropdown;
        this._buttonbar.appendChild(button);
        this._dropdowns.appendChild(dropdown);
        toolbarControl.isEnabledForMode(this.currentMode) ? toolbarControl.button.enable() : toolbarControl.button.disable();
    }

    show() {
        this.element.style.display = 'inline-block';
    }

    hide() {
        this.element.style.display = 'none';
    }

    destroy() {
        this.toolset.onModeChanged = null;
        this.element.remove();
    }

    _makeUI() {
        this._element = document.createElement('div');
        this._buttonbar = document.createElement('div');
        this._dropdowns = document.createElement('div');
        const dropdownContainer = document.createElement('div');
        this._element.appendChild(this._buttonbar);
        this._element.appendChild(dropdownContainer);
        dropdownContainer.appendChild(this._dropdowns);

        const classes = 'annotation-ui-drawing-toolbar btn-group btn-group-sm mode-selection'.split(' ');
        classes.forEach((c) => this._element.classList.add(c));

        dropdownContainer.classList.add('dropdowns-container');
        this._dropdowns.classList.add('dropdowns');
        this._buttonbar.classList.add('annotation-ui-buttonbar');

        return this._element;
    }
}

export { AnnotationToolbar };
