/** Export shape geometry in image pixels, including retained editing transforms.
 * The image layer and viewport transforms belong to the viewer, not saved data.
 */
export function isCompleteAnnotationGeometry(geometry) {
    if (geometry?.type === 'GeometryCollection') {
        return Boolean(geometry.properties?.raster?.data && geometry.geometries?.length);
    }
    if (!geometry?.type || !geometry.coordinates?.length) return false;
    const subtype = String(geometry.properties?.subtype || '').toLowerCase();
    if (subtype === 'ellipse') return Number(geometry.properties.majorRadius) > 0 && Number(geometry.properties.minorRadius) > 0;
    if (subtype === 'rectangle') return Number(geometry.properties.width) > 0 && Number(geometry.properties.height) > 0;
    return true;
}

export function pathPointsInImage(path) {
    if (!path?.segments) return [];
    const layer = path.layer;
    return path.segments.map(({point}) => {
        const global = path.localToGlobal(point);
        return layer ? layer.globalToLocal(global) : global;
    });
}

export function centerOfPoints(points) {
    if (!points.length) return [];
    return [
        points.reduce((total, point) => total + point.x, 0) / points.length,
        points.reduce((total, point) => total + point.y, 0) / points.length,
    ];
}

export function ellipseAxesFromPoints(points) {
    if (points.length < 4) return {majorRadius: 0, minorRadius: 0, angle: 0};
    const ux = (points[2].x - points[0].x) / 2;
    const uy = (points[2].y - points[0].y) / 2;
    const vx = (points[3].x - points[1].x) / 2;
    const vy = (points[3].y - points[1].y) / 2;
    // Principal axes of the transformed ellipse. Nonuniform scaling or shear
    // makes the original segment diameters nonperpendicular.
    const xx = ux * ux + vx * vx;
    const yy = uy * uy + vy * vy;
    const xy = ux * uy + vx * vy;
    const delta = Math.hypot(xx - yy, 2 * xy);
    const majorSquared = Math.max(0, (xx + yy + delta) / 2);
    const determinant = ux * vy - uy * vx;
    return {
        majorRadius: Math.sqrt(majorSquared),
        minorRadius: majorSquared ? Math.abs(determinant) / Math.sqrt(majorSquared) : 0,
        angle: ((Math.atan2(2 * xy, xx - yy) * 90 / Math.PI) + 180) % 180,
    };
}
