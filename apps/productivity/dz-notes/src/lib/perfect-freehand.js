/**
 * Self-contained offline freehand stroke generator
 * Generates smooth SVG polygon points from [x, y, pressure] points
 */

export function getStroke(points, options = {}) {
  if (!points || points.length === 0) return [];
  const size = options.size || 2.5;
  const halfSize = size / 2;

  if (points.length === 1) {
    const [x, y] = points[0];
    return [
      [x - halfSize, y - halfSize],
      [x + halfSize, y - halfSize],
      [x + halfSize, y + halfSize],
      [x - halfSize, y + halfSize]
    ];
  }

  const leftPts = [];
  const rightPts = [];

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const prev = points[i - 1] || pt;
    const next = points[i + 1] || pt;

    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;

    const nx = -dy / len;
    const ny = dx / len;

    const pressure = pt[2] !== undefined ? pt[2] : 0.5;
    const currentHalf = halfSize * (0.6 + 0.8 * pressure);

    leftPts.push([pt[0] + nx * currentHalf, pt[1] + ny * currentHalf]);
    rightPts.push([pt[0] - nx * currentHalf, pt[1] - ny * currentHalf]);
  }

  return [...leftPts, ...rightPts.reverse()];
}
