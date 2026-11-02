export function measurementDisplay(toolkit, item) {
    if (!toolkit?.options?.measurementUnits) return {};
    const image = item?.layer?.tiledImage || toolkit.viewer?.world?.getItemAt?.(0);
    const mm = Number(image?.file?.file_tile_info?.mm_x ?? image?.source?.mm_x ?? toolkit.options.mmPerPixel);
    return toolkit.options.measurementUnits !== 'pixels' && Number.isFinite(mm) && mm > 0
        ? {units: 'µm', unitsPerPixel: mm * 1000} : {units: 'px', unitsPerPixel: 1};
}

export function refreshMeasurementDisplay(toolkit) {
    const ruler = toolkit.getTool?.('ruler');
    const display = measurementDisplay(toolkit, ruler?.item);
    if (ruler?.toolbarControl && display.units) {
        const controls = ruler.toolbarControl;
        controls.labelUnit = display.units; controls.unitsPerPixel = display.unitsPerPixel;
        controls.unitsInput.value = display.units; controls.unitsInput.disabled = true;
        controls.unitsPerPixelInput.value = display.unitsPerPixel; controls.unitsPerPixelInput.disabled = true;
    }
    for (const item of toolkit.getFeatures?.() || []) {
        if (item.annotationItem?.subtype === 'Measurement') item.annotationItem.refreshSegmentLabels();
    }
    toolkit.paperScope?.view?.update?.();
}
