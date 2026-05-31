function normalizeRowId(id) {
    return id === undefined || id === null ? null : String(id);
}

function uniqueRowsById(rows) {
    const seen = new Set();
    return (rows || []).filter((row) => {
        const id = normalizeRowId(row?.id);
        if (id === null || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

function directEmbeddingRows(rows) {
    return uniqueRowsById(rows).filter((row) => Boolean(
        row?.directEmbedding && !row?.directEmbeddingOverview && row.id !== undefined && row.id !== null,
    ));
}

function rowsForSelectionAction(rows, action, isSelectedId) {
    const directRows = directEmbeddingRows(rows);
    if (action !== 'deselect' || typeof isSelectedId !== 'function') {
        return directRows;
    }
    return directRows.filter((row) => isSelectedId(row.id));
}

function displayBoundsFromBounds(bounds, transformPoint) {
    if (!bounds || typeof transformPoint !== 'function') return null;
    const points = [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
    ]
        .map((point) => transformPoint(point))
        .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));

    if (!points.length) return null;

    return points.reduce((extent, point) => ({
        minX: Math.min(extent.minX, point.x),
        minY: Math.min(extent.minY, point.y),
        maxX: Math.max(extent.maxX, point.x),
        maxY: Math.max(extent.maxY, point.y),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function chooseDirectSelectionRows({
    displayRows = [],
    projectRows = [],
    action = 'select',
    isSelectedId = null,
    preferDisplay = true,
} = {}) {
    const displayHitRows = directEmbeddingRows(displayRows);
    const projectHitRows = directEmbeddingRows(projectRows);
    const hasDisplayRows = Array.isArray(displayRows);
    const source = preferDisplay && hasDisplayRows
        ? 'display'
        : (projectHitRows.length > displayHitRows.length ? 'project' : 'display');
    const hitRows = source === 'project' ? projectHitRows : displayHitRows;
    const rows = rowsForSelectionAction(hitRows, action, isSelectedId);

    return {
        rows,
        hitRows,
        displayHitRows,
        projectHitRows,
        source,
        filteredToSelected: action === 'deselect',
    };
}

function applyEmbeddingSelectionIds(currentIds, actionIds, action = 'select') {
    const current = new Set((currentIds || []).map(normalizeRowId).filter((id) => id !== null));
    const incoming = (actionIds || []).map(normalizeRowId).filter((id) => id !== null);

    if (action === 'deselect') {
        incoming.forEach((id) => current.delete(id));
    } else {
        incoming.forEach((id) => current.add(id));
    }

    return Array.from(current);
}

export {
    applyEmbeddingSelectionIds,
    chooseDirectSelectionRows,
    displayBoundsFromBounds,
    directEmbeddingRows,
    rowsForSelectionAction,
    uniqueRowsById,
};
