/**
 * DZ-Photo — Image Processing & Filter Algorithms
 * Pure JavaScript pixel manipulation using ImageData.
 */

export function applyGrayscale(ctx, width, height) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
}

export function applyInvert(ctx, width, height) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
  ctx.putImageData(imgData, 0, 0);
}

export function applySepia(ctx, width, height) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
    d[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
    d[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
  }
  ctx.putImageData(imgData, 0, 0);
}

export function applyBrightnessContrast(ctx, width, height, brightness = 0, contrast = 0) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  for (let i = 0; i < d.length; i += 4) {
    // Brightness
    let r = d[i] + brightness;
    let g = d[i + 1] + brightness;
    let b = d[i + 2] + brightness;

    // Contrast
    r = factor * (r - 128) + 128;
    g = factor * (g - 128) + 128;
    b = factor * (b - 128) + 128;

    d[i] = Math.max(0, Math.min(255, r));
    d[i + 1] = Math.max(0, Math.min(255, g));
    d[i + 2] = Math.max(0, Math.min(255, b));
  }
  ctx.putImageData(imgData, 0, 0);
}

export function applyAlgerianSunset(ctx, width, height) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, d[i] * 1.25); // enhance warm reds
    d[i + 1] = Math.min(255, d[i + 1] * 1.05); // amber greens
    d[i + 2] = Math.max(0, d[i + 2] * 0.85); // soft blues
  }
  ctx.putImageData(imgData, 0, 0);
}

export function applyMediterraneanBlue(ctx, width, height) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.max(0, d[i] * 0.85);
    d[i + 1] = Math.min(255, d[i + 1] * 1.1);
    d[i + 2] = Math.min(255, d[i + 2] * 1.3);
  }
  ctx.putImageData(imgData, 0, 0);
}

export function flipHorizontal(canvas, ctx) {
  const temp = document.createElement('canvas');
  temp.width = canvas.width;
  temp.height = canvas.height;
  temp.getContext('2d').drawImage(canvas, 0, 0);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(temp, 0, 0);
  ctx.restore();
}

export function flipVertical(canvas, ctx) {
  const temp = document.createElement('canvas');
  temp.width = canvas.width;
  temp.height = canvas.height;
  temp.getContext('2d').drawImage(canvas, 0, 0);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.scale(1, -1);
  ctx.drawImage(temp, 0, 0);
  ctx.restore();
}
