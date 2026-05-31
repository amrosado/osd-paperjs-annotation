import assert from 'node:assert/strict';
import {
    applyEmbeddingSelectionIds,
    chooseDirectSelectionRows,
    displayBoundsFromBounds,
} from '../src/js/geojs-selection-helpers.mjs';

const rows = [
    { id: 'tile-a', directEmbedding: true, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
    { id: 'tile-b', directEmbedding: true, bounds: { minX: 10, minY: 0, maxX: 20, maxY: 10 } },
    { id: 'tile-c', directEmbedding: true, bounds: { minX: 20, minY: 0, maxX: 30, maxY: 10 } },
    { id: 'overview', directEmbedding: true, directEmbeddingOverview: true, bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 } },
    { id: 'paper-only', bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 } },
];

function rowsInScaledDisplayRect(scale, panX = 0, panY = 0) {
    const rect = {
        minX: 10 * scale + panX,
        minY: 0 * scale + panY,
        maxX: 20 * scale + panX,
        maxY: 10 * scale + panY,
    };
    return rows.filter((row) => {
        const bounds = row.bounds;
        const displayBounds = {
            minX: bounds.minX * scale + panX,
            minY: bounds.minY * scale + panY,
            maxX: bounds.maxX * scale + panX,
            maxY: bounds.maxY * scale + panY,
        };
        return displayBounds.maxX >= rect.minX
            && displayBounds.minX <= rect.maxX
            && displayBounds.maxY >= rect.minY
            && displayBounds.minY <= rect.maxY;
    });
}

for (const scale of [0.5, 1, 3]) {
    const chosen = chooseDirectSelectionRows({
        displayRows: rowsInScaledDisplayRect(scale, 37, -12),
        projectRows: rows,
        action: 'select',
        preferDisplay: true,
    });

    assert.strictEqual(chosen.source, 'display');
    assert.deepStrictEqual(chosen.rows.map((row) => row.id), ['tile-a', 'tile-b', 'tile-c']);
}

const selectedOnly = chooseDirectSelectionRows({
    displayRows: rows,
    projectRows: rows,
    action: 'deselect',
    isSelectedId: (id) => id === 'tile-b',
    preferDisplay: true,
});
assert.deepStrictEqual(selectedOnly.rows.map((row) => row.id), ['tile-b']);

assert.deepStrictEqual(
    applyEmbeddingSelectionIds(['tile-a'], ['tile-b', 'tile-b'], 'select'),
    ['tile-a', 'tile-b'],
);
assert.deepStrictEqual(
    applyEmbeddingSelectionIds(['tile-a', 'tile-b', 'tile-c'], ['tile-b'], 'deselect'),
    ['tile-a', 'tile-c'],
);

for (const scale of [0.25, 1, 4]) {
    const transformed = displayBoundsFromBounds(
        { minX: 10, minY: 20, maxX: 30, maxY: 50 },
        (point) => ({ x: point.x * scale + 17, y: point.y * scale - 9 }),
    );
    assert.deepStrictEqual(transformed, {
        minX: 10 * scale + 17,
        minY: 20 * scale - 9,
        maxX: 30 * scale + 17,
        maxY: 50 * scale - 9,
    });
}
