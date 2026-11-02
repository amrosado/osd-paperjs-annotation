// Sizes are CSS pixels, independent of image zoom, layout and device pixel ratio.
export const DEFAULT_POINT_TEXT_SIZE = 18;
export const POINT_TEXT_FONTS = Object.freeze([
    {label: 'Sans serif', value: 'sans-serif'},
    {label: 'Serif', value: 'serif'},
    {label: 'Monospace', value: 'monospace'},
    {label: 'Arial / Helvetica', value: 'Arial, Helvetica, sans-serif'},
    {label: 'Verdana', value: 'Verdana, Geneva, sans-serif'},
    {label: 'Georgia', value: 'Georgia, serif'},
    {label: 'Times New Roman', value: '"Times New Roman", Times, serif'},
    {label: 'Courier New', value: '"Courier New", Courier, monospace'},
]);
export const POINT_TEXT_OFFSET = Object.freeze({x: 8, y: -4});
export const POINT_TEXT_MARKER_RADIUS = 4;

// Orbit the label with the image while keeping the glyphs horizontal.
export function pointTextOffsetForMatrix({a = 1, b = 0, c = 0, d = 1} = {}) {
    const sx = Math.hypot(a, b) || 1, sy = Math.hypot(c, d) || 1;
    return {x: POINT_TEXT_OFFSET.x * a / sx + POINT_TEXT_OFFSET.y * c / sy,
        y: POINT_TEXT_OFFSET.x * b / sx + POINT_TEXT_OFFSET.y * d / sy};
}

export function normalizePointTextStyle(properties = {}) {
    const size = Number(properties.fontSize);
    const family = String(properties.fontFamily || 'sans-serif');
    const font = POINT_TEXT_FONTS.find(font => font.value === family
        || font.value.split(',')[0].replaceAll('"', '').toLowerCase() === family.toLowerCase());
    return {
        fontSize: Number.isFinite(size) && size > 0 ? Math.min(256, Math.max(6, size)) : DEFAULT_POINT_TEXT_SIZE,
        fontFamily: font?.value || 'sans-serif',
    };
}

export function pointTextStyleControlsHTML() {
    return `<div class="point-text-style-controls flex-row style-row annotation-ui-buttonbar">
        <label>Text size (screen px) <input aria-label="Text size (screen px)" data-action="text-size"
            type="number" min="6" max="256" step="1" value="${DEFAULT_POINT_TEXT_SIZE}"></label>
        <label>Font <select aria-label="Text font" data-action="text-font">${POINT_TEXT_FONTS.map(font =>
            `<option value='${font.value}'>${font.label}</option>`).join('')}</select></label>
    </div>`;
}
