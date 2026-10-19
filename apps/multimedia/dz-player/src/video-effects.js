/**
 * DZ-Player: Hardware-Accelerated Video Effects & Geometry Engine
 * Reverse engineered from VLC media player's video_filter plugins:
 * - libadjust: Brightness, Contrast, Saturation, Hue Rotation, Grayscale, Blur
 * - libtransform: Aspect ratio scaling, 90/180/270 rotation, horizontal/vertical mirror
 * - Snapshot capture: Native-resolution video frame grabber (Shift+S)
 */

export class VideoEffects {
  constructor(videoElement, containerElement) {
    this.video = videoElement;
    this.container = containerElement;

    // Filters
    this.brightness = 100; // 50% to 200%
    this.contrast = 100;   // 50% to 200%
    this.saturation = 100; // 0% to 250%
    this.hue = 0;          // 0 to 360 deg
    this.sepia = 0;        // 0 to 100%
    this.invert = 0;       // 0 to 100%
    this.grayscale = 0;    // 0 to 100%
    this.blur = 0;         // 0 to 20px

    // Geometry
    this.aspectRatio = 'auto'; // 'auto', '16:9', '4:3', '1:1', '21:9', 'cover', 'fill'
    this.rotation = 0;         // 0, 90, 180, 270 deg
    this.flipH = false;        // Mirror Horizontal
    this.flipV = false;        // Mirror Vertical
  }

  apply() {
    if (!this.video) return;

    // 1. Build CSS Filter string
    const filterParts = [
      `brightness(${this.brightness}%)`,
      `contrast(${this.contrast}%)`,
      `saturate(${this.saturation}%)`,
      `hue-rotate(${this.hue}deg)`,
      `sepia(${this.sepia}%)`,
      `invert(${this.invert}%)`,
      `grayscale(${this.grayscale}%)`
    ];

    if (this.blur > 0) {
      filterParts.push(`blur(${this.blur}px)`);
    }

    this.video.style.filter = filterParts.join(' ');

    // 2. Build Transform matrix
    const scaleX = this.flipH ? -1 : 1;
    const scaleY = this.flipV ? -1 : 1;
    const rotate = `rotate(${this.rotation}deg)`;
    const scale = `scale(${scaleX}, ${scaleY})`;
    this.video.style.transform = `${rotate} ${scale}`;

    // 3. Aspect Ratio
    if (this.aspectRatio === 'cover') {
      this.video.style.objectFit = 'cover';
    } else if (this.aspectRatio === 'fill') {
      this.video.style.objectFit = 'fill';
    } else if (this.aspectRatio === 'auto') {
      this.video.style.objectFit = 'contain';
    } else {
      this.video.style.objectFit = 'fill';
    }
  }

  resetFilters() {
    this.brightness = 100;
    this.contrast = 100;
    this.saturation = 100;
    this.hue = 0;
    this.sepia = 0;
    this.invert = 0;
    this.grayscale = 0;
    this.blur = 0;
    this.apply();
  }

  resetGeometry() {
    this.aspectRatio = 'auto';
    this.rotation = 0;
    this.flipH = false;
    this.flipV = false;
    this.apply();
  }

  rotateClockwise() {
    this.rotation = (this.rotation + 90) % 360;
    this.apply();
    return this.rotation;
  }

  toggleFlipH() {
    this.flipH = !this.flipH;
    this.apply();
    return this.flipH;
  }

  toggleFlipV() {
    this.flipV = !this.flipV;
    this.apply();
    return this.flipV;
  }

  setAspectRatio(ratio) {
    this.aspectRatio = ratio;
    this.apply();
  }

  /**
   * Captures the current video frame at native video resolution.
   * Returns a PNG data URL and triggers immediate download.
   */
  captureSnapshot(filenamePrefix = 'dz_player_snapshot') {
    if (!this.video || !this.video.videoWidth || !this.video.videoHeight) {
      return null;
    }

    const canvas = document.createElement('canvas');
    // If rotated 90 or 270 deg, swap dimensions
    const isSideways = this.rotation === 90 || this.rotation === 270;
    canvas.width = isSideways ? this.video.videoHeight : this.video.videoWidth;
    canvas.height = isSideways ? this.video.videoWidth : this.video.videoHeight;
    const ctx = canvas.getContext('2d');

    // Apply filters to canvas context
    ctx.filter = [
      `brightness(${this.brightness}%)`,
      `contrast(${this.contrast}%)`,
      `saturate(${this.saturation}%)`,
      `hue-rotate(${this.hue}deg)`,
      `sepia(${this.sepia}%)`,
      `invert(${this.invert}%)`,
      `grayscale(${this.grayscale}%)`
    ].join(' ');

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((this.rotation * Math.PI) / 180);
    ctx.scale(this.flipH ? -1 : 1, this.flipV ? -1 : 1);

    ctx.drawImage(
      this.video,
      -this.video.videoWidth / 2,
      -this.video.videoHeight / 2,
      this.video.videoWidth,
      this.video.videoHeight
    );
    ctx.restore();

    const dataUrl = canvas.toDataURL('image/png');
    const timestamp = Math.floor(this.video.currentTime || 0);
    const downloadName = `${filenamePrefix}_${timestamp}s.png`;

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    return { dataUrl, filename: downloadName };
  }
}
