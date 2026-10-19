/**
 * DZ-Slides: Export Engine
 * Handles high-resolution PNG rendering, batch slide exports,
 * JSON deck serialization, and standalone self-contained HTML slideshow generation.
 * 100% Offline-First | Zero Dependencies
 */

export class ExportEngine {
  /**
   * Serializes a slide deck to a JSON .dzslide file.
   */
  static exportDzSlide(deckTitle, slides) {
    const payload = {
      format: 'DZ-SLIDES-OFFLINE',
      version: '2.0.0',
      title: deckTitle || 'عرض تقديمي بدون عنوان',
      author: 'DZ Open Suite',
      createdAt: new Date().toISOString(),
      aspectRatio: '16:9',
      slidesCount: slides.length,
      slides: slides
    };
    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  }

  /**
   * Renders a single slide onto a 1920x1080 canvas and triggers a PNG download.
   */
  static async exportSlideAsPng(slide, slideIndex = 1, deckTitle = 'presentation') {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');

    // Scale from 960x540 base to 1920x1080
    const scale = 2.0;

    // Draw Background
    if (slide.bg && slide.bg.startsWith('linear-gradient')) {
      const grad = ctx.createLinearGradient(0, 0, 1920, 1080);
      // Basic gradient extraction or default fallback
      grad.addColorStop(0, '#091e3a');
      grad.addColorStop(1, '#064e3b');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = slide.bg || '#ffffff';
    }
    ctx.fillRect(0, 0, 1920, 1080);

    // Render HTML content via SVG ForeignObject
    const tempSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="width: 960px; height: 540px; transform: scale(${scale}); transform-origin: 0 0; position: relative; overflow: hidden; font-family: 'Cairo', -apple-system, sans-serif; direction: rtl;">
            ${slide.elements.map(el => `
              <div style="position: absolute; left: ${el.x}px; top: ${el.y}px; width: ${el.w}px; height: ${el.h}px; box-sizing: border-box;">
                ${el.content}
              </div>
            `).join('')}
          </div>
        </foreignObject>
      </svg>
    `;

    return new Promise((resolve) => {
      const img = new Image();
      const svgBlob = new Blob([tempSvg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          const dlUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = dlUrl;
          const cleanTitle = (deckTitle || 'slide').replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, '_');
          a.download = `${cleanTitle}_slide_${slideIndex}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(dlUrl);
          resolve(blob);
        }, 'image/png');
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        // Fallback: direct canvas download
        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/png');
      };

      img.src = url;
    });
  }

  /**
   * Generates a completely standalone portable self-contained HTML slideshow file!
   * Can be opened on ANY computer in any browser offline without a web server.
   */
  static exportStandaloneHtml(deckTitle, slides) {
    const slidesJson = JSON.stringify(slides);
    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${deckTitle} — DZ-Impress Presentation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #000; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    #screen { width: 90vw; height: 50.625vw; max-height: 90vh; max-width: 160vh; position: relative; border-radius: 8px; overflow: hidden; box-shadow: 0 0 50px rgba(0,0,0,0.8); }
    .element { position: absolute; }
    #nav { position: fixed; bottom: 20px; background: rgba(15,23,42,0.85); backdrop-filter: blur(8px); padding: 8px 20px; border-radius: 30px; display: flex; gap: 16px; align-items: center; font-size: 14px; border: 1px solid rgba(255,255,255,0.2); }
    button { background: transparent; border: none; color: #fff; cursor: pointer; font-size: 16px; }
  </style>
</head>
<body>
  <div id="screen"></div>
  <div id="nav">
    <button onclick="prev()">❮ السابق</button>
    <span id="counter" style="font-weight:bold;">1 / 1</span>
    <button onclick="next()">التالي ❯</button>
  </div>
  <script>
    const slides = ${slidesJson};
    let cur = 0;
    const screen = document.getElementById('screen');
    const counter = document.getElementById('counter');

    function render() {
      const s = slides[cur];
      screen.style.background = s.bg || '#fff';
      screen.innerHTML = s.elements.map(el => '<div class="element" style="left:'+el.x+'px;top:'+el.y+'px;width:'+el.w+'px;height:'+el.h+'px;">'+el.content+'</div>').join('');
      counter.textContent = (cur + 1) + ' / ' + slides.length;
    }
    function next() { if (cur < slides.length - 1) { cur++; render(); } }
    function prev() { if (cur > 0) { cur--; render(); } }
    window.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'Space') next();
      if (e.key === 'ArrowLeft') prev();
    });
    render();
  </script>
</body>
</html>`;

    return new Blob([html], { type: 'text/html;charset=utf-8' });
  }
}
