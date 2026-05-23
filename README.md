# osd-paperjs-annotation - Annotation tools for Openseadragon built with Paper.js

This project combines the [OpenSeadragon](https://openseadragon.github.io/) zoomable image viewer with [PaperJS](http://paperjs.org/)-based annotations drawn into a synced zoomable overlay.

## Quick start guide:

To get started with a basic overlay, only a couple lines of code are needed.

```
// import the PaperOverlay object. You need to be using a JavaScript module.
// if paper.js is not already included, it will be automatically loaded during import
import { PaperOverlay } from './src/js/paper-overlay.mjs';

// viewer creation, get reference to a TiledImage
let viewer = new OpenSeadragon({...});
let tiledImage = viewer.world.getItemAt(0);

// create a paper.js object
let myPaperItem = new paper.Path(...); // configure your paper item however you want

// add a PaperOverlay to the viewer
viewer.createPaperOverlay();

// add the paper.js item you've previously created to the overlay
tiledImage.addPaperItem(myPaperItem);

// you can modify the paper.js item using normal paper.js functionality
myPaperItem.fillColor = 'blue';

// A special `rescale` property can be used to automatically adjust properties during zooming
myPaperItem.rescale = {strokeWidth: 2}

```

## API Documentation:

See the [JSDoc documentation pages](https://pearcetm.github.io/osd-paperjs-annotation/docs/OSDPaperjsAnnotation.html) for information about how to use the library.

**Tool and project events:** Tools emit `item-created`, `item-updated`, and `item-converted` (and the project re-emits them). Subscribe on a tool or on the project to react to annotation creation and edits. See [docs/tool-and-project-events.md](docs/tool-and-project-events.md).

## Annotation data and Redux

`AnnotationToolkit` keeps annotation data in a single `AnnotationDataStore`. By default this store is local to the toolkit and `toGeoJSON()` reads from that source of truth. Tool edits, imports, deletes, label changes, and cached annotations are synchronized into the store through the library reducer.

To keep all annotation data in a host Redux application, add the exported reducer to your app and pass the store to the toolkit:

```js
import { configureStore } from '@reduxjs/toolkit';
import {
    AnnotationToolkit,
    annotationDataReducer,
} from './src/js/osdpaperjsannotation.mjs';

const store = configureStore({
    reducer: {
        osdPaperjsAnnotation: annotationDataReducer,
        // other app reducers...
    },
});

const toolkit = new AnnotationToolkit(viewer, {
    redux: {
        enabled: true,
        store,
        sliceKey: 'osdPaperjsAnnotation',
    },
});
```

If your reducer is mounted under a different key, pass `selector: state => state.annotations` instead of `sliceKey`. The same reducer and action creators are exported as `annotationDataReducer`, `annotationDataActions`, `annotationDataActionTypes`, and `initialAnnotationDataState`.

## GeoJS Display Mode

For large annotation sets, enable `geojs_display` to render display-only annotations through [GeoJS](https://opengeoscience.github.io/geojs/) while keeping Paper.js available for rich editing:

```js
const toolkit = new AnnotationToolkit(viewer, {
    geojs_display: true,
});
```

When enabled, the toolkit creates a GeoJS overlay above the OpenSeadragon canvas. Imported and edited annotations remain in the toolkit data store, but inactive Paper.js items are hidden and rendered by GeoJS. Clicking a GeoJS-rendered object reveals and selects the corresponding Paper.js item so existing osd-paperjs tools can edit it. Call `toolkit.finishGeoJSDisplayEdit()` to return the active object to GeoJS display mode.

## Demo pages:

See the [Demo pages](https://pearcetm.github.io/osd-paperjs-annotation/demo/) to try out the functionality.

### Digital Slide Archive Annotator
View and annotate slides from any [Digital Slide Archive instance](https://pearcetm.github.io/osd-paperjs-annotation/demo/dsa/app.html). Enter the base URL for the DSA in the box and press the "Open DSA" button. Some archives may have publically available slides to view, but to save changes you will need to be logged in.

### YOLO Reviewer for DSA
[Customized version](https://pearcetm.github.io/osd-paperjs-annotation/demo/yoloreviewer/app.html) of the Digital Slide Archive Annotator that adds tools specifically for reviewing and modifying bounding boxes for AI training. 

## To do

- BlankCanvasTileSource for OpenSeadragon
-- Allow an empty/blank image to be used as a drawing background, rather than an actual image

## Necessary packages -temp
One time guide for documentation task runner:
Goto directory in command prompt
Npm install -g jsdoc
npm install --g gulp gulp-babel gulp-jsdoc3 chokidar webpack-stream del path url
npm install -g webpack webpack-cli webpack-stream terser-webpack-plugin path url

## Gulp Directions
Open command prompt and goto build directory

Gulp Updater : updates bundle.js and does documentation whenever you save a file
Gulp DocUpdater: only updates documentation whenever you save a file 
Gulp PackUpdater: only updates bundle.js whenever you save a file
Gulp webpack: updates bundle.js
Gulp doc: updates documentation
Gulp Demo: Launches the rotional control demo on a local html address on your default browser
