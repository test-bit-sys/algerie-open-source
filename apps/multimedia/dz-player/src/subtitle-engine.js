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
 * - WebVTT format
 * - Timing delay / advance (+/- 50ms, 100ms, 500ms, 1s)
 * - Automatic RTL direction detection for Arabic script
 * - Subtitle styling: font size, color, background, outline
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
    this.textColor = '#ffffff'; // white, #facc15 (yellow), #38bdf8 (cyan)
    this.bgStyle = 'shadow'; // 'shadow', 'semi', 'box', 'none'
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
    // If strict UTF-8 succeeded, check whether it actually contains Arabic UTF-8 code points
    // (0x0600 - 0x06FF) or if it's pure ASCII / other.
    const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
    if (utf8Valid && utf8Text && arabicRegex.test(utf8Text)) {
      return { text: utf8Text, encoding: 'utf-8' };
    }

    // 5. Check if raw bytes contain typical Windows-1256 Arabic letter codes:
    // In Windows-1256, common Arabic letters are mapped to 0xC0..0xFE:
    // 0xC7 = Alef, 0xE4 = Noon, 0xE5 = Heh, 0xE1 = Lam, 0xED = Yeh, 0xE6 = Waw, 0xCA = Teh, etc.
    let cp1256Hits = 0;
    const sampleSize = Math.min(bytes.length, 4096);
    for (let i = 0; i < sampleSize; i++) {
      const b = bytes[i];
      if (b >= 0xc0 && b <= 0xfe) {
        cp1256Hits++;
      }
    }

    const cp1256Ratio = cp1256Hits / sampleSize;

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

    // Fast binary search or range check
    const cue = this.cues.find((c) => adjustedTime >= c.start && adjustedTime <= c.end);
    this.currentCue = cue || null;
    return this.currentCue;
  }

  clear() {
    this.cues = [];
    this.currentCue = null;
    this.rawBytes = null;
    this.rawFilename = '';
    this.syncOffsetSec = 0;
  }
}
