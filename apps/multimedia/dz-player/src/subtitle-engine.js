/**
 * DZ-Player: Intelligent Subtitle Engine & Arabic Encoding Resolver
 * 
 * Special Algerian & Arab World Feature:
 * Solves the 20-year-old Arabic subtitle mojibake issue (garbled characters
 * like "ãÑÍÈÇ" or "Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©") by providing heuristic auto-detection between
 * Windows-1256 (ANSI Arabic) and UTF-8, plus manual encoding override.
 * 
 * Supports:
 * - SRT (SubRip) format with millisecond precision
 * - WebVTT format (.vtt)
 * - Timing delay / advance (+/- 50ms, 100ms, 500ms, 1s)
 * - Automatic RTL direction detection for Arabic script
 * - Subtitle styling: font size, color, background, outline, bottom position
 * - In-app Subtitle Editor (search, edit cue, delete, add, export to SRT/VTT)
 * - Pre-loaded sample Algerian Arabic subtitles (Anthem & Cultural Verses)
 */

export class SubtitleEngine {
  constructor() {
    this.cues = [];
    this.syncOffsetSec = 0; // offset in seconds (positive = delay, negative = advance)
    this.currentEncoding = 'auto'; // 'auto', 'utf-8', 'windows-1256', 'iso-8859-6'
    this.detectedEncoding = 'utf-8';
    this.currentCue = null;
    this.rawBytes = null;
    this.rawFilename = '';

    // Visual preferences
    this.fontSize = 'medium'; // 'small', 'medium', 'large', 'huge'
    this.textColor = '#ffffff'; // white, #facc15 (yellow), #38bdf8 (cyan), #4ade80 (green)
    this.bgStyle = 'shadow'; // 'shadow', 'semi', 'box', 'none'
    this.bottomOffsetPx = 50;
  }

  /**
   * Loads subtitle from an ArrayBuffer / Uint8Array.
   */
  async loadFromBuffer(arrayBuffer, filename = 'subtitle.srt', forcedEncoding = 'auto') {
    this.rawBytes = new Uint8Array(arrayBuffer);
    this.rawFilename = filename;
    this.currentEncoding = forcedEncoding;

    const { text, encoding } = this.decodeSubtitleBytes(this.rawBytes, forcedEncoding);
    this.detectedEncoding = encoding;

    this.parseSubtitleText(text);
    return {
      cuesCount: this.cues.length,
      encoding: this.detectedEncoding
    };
  }

  /**
   * Loads subtitle from a raw text string.
   */
  loadFromText(text, filename = 'subtitle.srt') {
    this.rawFilename = filename;
    this.rawBytes = new TextEncoder().encode(text);
    this.detectedEncoding = 'utf-8';
    this.parseSubtitleText(text);
    return {
      cuesCount: this.cues.length,
      encoding: this.detectedEncoding
    };
  }

  /**
   * Intelligent heuristic decoder for Arabic subtitles.
   */
  decodeSubtitleBytes(bytes, forcedEncoding = 'auto') {
    // 1. If forced encoding is requested (and not 'auto')
    if (forcedEncoding && forcedEncoding !== 'auto') {
      try {
        const decoder = new TextDecoder(forcedEncoding);
        return { text: decoder.decode(bytes), encoding: forcedEncoding };
      } catch (err) {
        console.warn(`[SubtitleEngine] Failed to decode as ${forcedEncoding}, falling back to auto:`, err);
      }
    }

    // 2. Check for UTF-8 Byte Order Mark (BOM: EF BB BF)
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      const decoder = new TextDecoder('utf-8');
      return { text: decoder.decode(bytes.subarray(3)), encoding: 'utf-8 (BOM)' };
    }

    // 3. Try decoding as strict UTF-8
    let utf8Text = null;
    let utf8Valid = false;
    try {
      const strictDecoder = new TextDecoder('utf-8', { fatal: true });
      utf8Text = strictDecoder.decode(bytes);
      utf8Valid = true;
    } catch {
      utf8Valid = false;
    }

    // 4. Heuristic evaluation for Arabic code points:
    const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
    if (utf8Valid && utf8Text && arabicRegex.test(utf8Text)) {
      return { text: utf8Text, encoding: 'utf-8' };
    }

    // 5. Check if raw bytes contain typical Windows-1256 Arabic letter codes:
    let cp1256Hits = 0;
    const sampleSize = Math.min(bytes.length, 4096);
    for (let i = 0; i < sampleSize; i++) {
      const b = bytes[i];
      if (b >= 0xc0 && b <= 0xfe) {
        cp1256Hits++;
      }
    }

    const cp1256Ratio = cp1256Hits / (sampleSize || 1);

    // If more than 3% of characters fall into Windows-1256 Arabic range, or UTF-8 failed
    if (!utf8Valid || cp1256Ratio > 0.03) {
      try {
        const cp1256Decoder = new TextDecoder('windows-1256');
        const candidateText = cp1256Decoder.decode(bytes);
        if (arabicRegex.test(candidateText)) {
          return { text: candidateText, encoding: 'windows-1256 (Arabic)' };
        }
      } catch (err) {
        console.warn('[SubtitleEngine] windows-1256 decoding error:', err);
      }
    }

    // Default fallback to UTF-8 non-fatal
    const fallbackDecoder = new TextDecoder('utf-8');
    return { text: fallbackDecoder.decode(bytes), encoding: 'utf-8' };
  }

  /**
   * Reloads currently loaded subtitle with a specific encoding.
   */
  reloadWithEncoding(newEncoding) {
    if (!this.rawBytes) return null;
    return this.loadFromBuffer(this.rawBytes.buffer, this.rawFilename, newEncoding);
  }

  /**
   * Parses SRT or WebVTT string into cues array.
   */
  parseSubtitleText(text) {
    this.cues = [];
    if (!text) return;

    // Normalize newlines
    const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = cleanText.split(/\n\s*\n/);

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 2) continue;

      let timeLineIndex = 0;
      // Skip numeric counter line in SRT if present
      if (/^\d+$/.test(lines[0].trim())) {
        timeLineIndex = 1;
      }

      if (timeLineIndex >= lines.length) continue;

      const timeLine = lines[timeLineIndex];
      // Match timestamp: 00:01:20,000 --> 00:01:23,500 or 00:01:20.000 --> 00:01:23.500
      const timeMatch = timeLine.match(
        /(\d{1,2}:(?:\d{2}:)?\d{2}[,\.]\d{2,3})\s*-->\s*(\d{1,2}:(?:\d{2}:)?\d{2}[,\.]\d{2,3})/
      );

      if (!timeMatch) continue;

      const startTime = this.parseTimestampToSeconds(timeMatch[1]);
      const endTime = this.parseTimestampToSeconds(timeMatch[2]);
      const textLines = lines.slice(timeLineIndex + 1).join('\n').trim();

      if (startTime != null && endTime != null && textLines) {
        const isRtl = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(textLines);
        this.cues.push({
          id: this.cues.length + 1,
          start: startTime,
          end: endTime,
          text: textLines,
          isRtl
        });
      }
    }

    // Sort cues by start time
    this.cues.sort((a, b) => a.start - b.start);
  }

  parseTimestampToSeconds(stamp) {
    if (!stamp) return null;
    const parts = stamp.replace(',', '.').split(':');
    if (parts.length === 3) {
      const hours = parseFloat(parts[0]);
      const minutes = parseFloat(parts[1]);
      const seconds = parseFloat(parts[2]);
      return hours * 3600 + minutes * 60 + seconds;
    } else if (parts.length === 2) {
      const minutes = parseFloat(parts[0]);
      const seconds = parseFloat(parts[1]);
      return minutes * 60 + seconds;
    }
    return null;
  }

  formatSecondsToSRT(seconds) {
    const s = Math.max(0, seconds || 0);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    const ms = Math.floor((s - Math.floor(s)) * 1000);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  /**
   * Adjusts subtitle synchronization offset (+/- seconds).
   * positive = subtitle is delayed, negative = subtitle is shown earlier.
   */
  adjustSyncOffset(deltaSeconds) {
    this.syncOffsetSec = Math.round((this.syncOffsetSec + deltaSeconds) * 1000) / 1000;
    return this.syncOffsetSec;
  }

  setSyncOffset(seconds) {
    this.syncOffsetSec = Number(seconds) || 0;
    return this.syncOffsetSec;
  }

  /**
   * Retrieves active cue for current playback time.
   */
  getCueAtTime(currentTimeSec) {
    if (!this.cues.length) return null;

    // Apply sync adjustment: adjustedTime = currentTime - offset
    const adjustedTime = currentTimeSec - this.syncOffsetSec;

    // Range check
    const cue = this.cues.find((c) => adjustedTime >= c.start && adjustedTime <= c.end);
    this.currentCue = cue || null;
    return this.currentCue;
  }

  /**
   * Alias for getCueAtTime to ensure seamless API interoperability.
   */
  getCurrentCue(currentTimeSec) {
    return this.getCueAtTime(currentTimeSec);
  }

  /**
   * Exports all loaded cues to standard SRT text.
   */
  exportSRT() {
    let out = '';
    this.cues.forEach((c, i) => {
      out += `${i + 1}\n`;
      out += `${this.formatSecondsToSRT(c.start)} --> ${this.formatSecondsToSRT(c.end)}\n`;
      out += `${c.text}\n\n`;
    });
    return out.trim();
  }

  /**
   * Exports all loaded cues to WebVTT text.
   */
  exportVTT() {
    let out = 'WEBVTT\n\n';
    this.cues.forEach((c, i) => {
      const s = this.formatSecondsToSRT(c.start).replace(',', '.');
      const e = this.formatSecondsToSRT(c.end).replace(',', '.');
      out += `${i + 1}\n${s} --> ${e}\n${c.text}\n\n`;
    });
    return out.trim();
  }

  updateCueText(cueId, newText) {
    const cue = this.cues.find((c) => c.id === cueId);
    if (cue) {
      cue.text = newText;
      cue.isRtl = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(newText);
    }
  }

  deleteCue(cueId) {
    this.cues = this.cues.filter((c) => c.id !== cueId);
  }

  clear() {
    this.cues = [];
    this.currentCue = null;
    this.rawBytes = null;
    this.rawFilename = '';
    this.syncOffsetSec = 0;
  }

  /**
   * Generates sample Algerian Arabic subtitles for testing.
   */
  static getSampleAlgerianSubtitles() {
    return `1
00:00:00,500 --> 00:00:03,500
قَسَمًا بِالنَّازِلَاتِ الْمَاحِقَاتِ
Kassaman — Par les foudres qui anéantissent

2
00:00:04,000 --> 00:00:07,000
وَالدِّمَاءِ الزَّاكِيَاتِ الطَّاهِرَاتِ
Et par les flots de sang pur et sans tache

3
00:00:07,500 --> 00:00:10,500
وَالْبُنُودِ اللَّامِعَاتِ الْخَافِقَاتِ
Par les étendards flottants et éclatants

4
00:00:11,000 --> 00:00:14,000
فِي الْجِبَالِ الشَّامِخَاتِ الشَّاهِقَاتِ
Sur les cimes altières de nos fières montagnes

5
00:00:14,500 --> 00:00:18,500
نَحْنُ ثُرْنَا فَحَيَاةٌ أَوْ مَمَاتٌ
Nous nous sommes dressés pour la vie ou la mort!

6
00:00:19,000 --> 00:00:23,000
وَعَقَدْنَا الْعَزْمَ أَنْ تَحْيَا الْجَزَائِرْ
Et nous avons juré que l'Algérie vivra!
`;
  }
}
