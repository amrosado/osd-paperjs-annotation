/**
 * Consolidated setup for osd-paperjs-annotation.
 *
 * Import this module once before constructing overlays/toolkits in React or
 * non-React applications. Package entry points import it for compatibility.
 */

import { OpenSeadragon } from './osd-loader.mjs';
import { paper } from './paperjs.mjs';
import { installPaperExtensions } from './paper-extensions.mjs';
import { installOSDExtensions } from './osd-extensions.mjs';
import { PaperOverlay } from './paper-overlay.mjs';

let setupState = null;

function setupOSDPaperJSAnnotation() {
    if (setupState) return setupState;

    installPaperExtensions();
    installOSDExtensions({ PaperOverlay });

    setupState = {
        OpenSeadragon,
        paper,
        PaperOverlay,
    };
    return setupState;
}

const setup = setupOSDPaperJSAnnotation();

export {
    OpenSeadragon,
    paper,
    PaperOverlay,
    setup,
    setupOSDPaperJSAnnotation,
};

export default setupOSDPaperJSAnnotation;
