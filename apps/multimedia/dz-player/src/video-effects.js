/**
 * DZ-Player: Hardware-Accelerated Video Effects & Geometry Engine
 * Reverse engineered from VLC media player's video_filter plugins:
 * - libadjust: Brightness, Contrast, Saturation, Hue Rotation
 * - libtransform: Aspect ratio scaling, 90/180/270 rotation, horizontal/vertical mirror
 * - Snapshot capture: Native-resolution video frame grabber (Shift+S)
 */

export class VideoEffects {
  constructor(videoElement, containerElement) {
    this.video = videoElement;
    this.container = containerElement;

    // Filters
    this.brightness = 100; // 50% to 150%
    this.contrast = 100;   // 50% to 150%
    this.saturation = 100; // 0% to 200%
    this.hue = 0;          // 0 to 360 deg
    this.sepia = 0;        // 0 to 100%
    this.invert = 0;       // 0 to 100%

    // Geometry
    this.aspectRatio = 'auto'; // 'auto', '16:9', '4:3', '1:1', '21:9', 'cover'
    this.rotation = 0;         // 0, 90, 180, 270 deg
    this.flipH = false;        // Mirror
    this.flipV = false;
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
      `invert(${this.invert}%)`
    ];
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
    } else if (this.aspectRatio === 'auto') {
      this.video.style.objectFit = 'contain';
    } else {
      this.video.style.objectFit = 'fill';
      // In CSS, object-fit fill allows the video to stretch to defined ratio
    }
  }

  resetFilters() {
    this.brightness = 100;
    this.contrast = 100;
    this.saturation = 100;
    this.hue = 0;
    this.sepia = 0;
    this.invert = 0;
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
  captureSnapshot(filenamePrefix = 'snapshot') {
    if (!this.video || !this.video.videoWidth || !this.video.videoHeight) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    const ctx = canvas.getContext('2d');

    // Apply rotation and flips to snapshot canvas if needed
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
    const timestamp = Math.floor(this.video.currentTime);
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
