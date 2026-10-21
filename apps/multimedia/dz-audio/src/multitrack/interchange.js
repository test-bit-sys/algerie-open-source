// File > Export > Interchange XML: the session as an XML edit list in the
// widely supported "xmeml" interchange format (version 5), so video and
// audio editors can rebuild the arrangement, packed in a ZIP with the media
// as 24-bit WAV files. Each session track becomes one interchange track per
// channel (stereo tracks become a linked pair), each clip a clip item with
// its source range and gain. Times are counted in frames of the timebase,
// as the format requires; fades, envelopes, effects and buses are not
// carried over.

import { dbToGain } from '../model/session-graph.js';
import { clipEnd } from '../model/session-edits.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Timebase for a time format: whole frames per second and the NTSC flag. */
export function timebaseFor(format) {
  const table = { smpte24: [24, false], smpte25: [25, false], smpte30: [30, false], smpte2398: [24, true], smpte2997: [30, true], smpte2997df: [30, true], smpte5994: [60, true], smpte5994df: [60, true] };
  const [fps, ntsc] = table[format] || [30, false];
  return { fps, ntsc };
}

/**
 * XML for a session state.
 * @param {object} state session state
 * @param {Map} pool media pool (sourceId -> { name, channels })
 * @param {{ name: string, files: Map<string, string>, timebase?: { fps, ntsc } }} o
 *   files: sourceId -> file name inside the ZIP
 */
export function sessionToXmeml(state, pool, { name, files, timebase = { fps: 30, ntsc: false } }) {
  const rate = state.sampleRate;
  const fps = timebase.ntsc ? (timebase.fps * 1000) / 1001 : timebase.fps;
  const fr = (frames) => Math.round((frames / rate) * fps);
  const rateXml = `<rate><timebase>${timebase.fps}</timebase><ntsc>${timebase.ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`;
  const fileSeen = new Set();
  const fileXml = (sourceId) => {
    const src = pool.get(sourceId);
    const fileName = files.get(sourceId);
    const id = `file-${sourceId}`;
    if (fileSeen.has(id)) return `<file id="${esc(id)}"/>`;
    fileSeen.add(id);
    const n = src.channels.length;
    return `<file id="${esc(id)}"><name>${esc(fileName)}</name><pathurl>${esc(encodeURI(fileName))}</pathurl>${rateXml}<duration>${fr(src.channels[0].length)}</duration><media><audio><samplecharacteristics><depth>24</depth><samplerate>${rate}</samplerate></samplecharacteristics><channelcount>${n}</channelcount></audio></media></file>`;
  };
  const tracks = [];
  let item = 0;
  for (const t of state.tracks.filter((x) => x.type === 'audio')) {
    const clips = state.clips.filter((c) => c.trackId === t.id && !c.mute && files.has(c.sourceId)).sort((a, b) => a.start - b.start);
    const lanes = t.channels === 1 ? 1 : 2;
    const ids = clips.map(() => Array.from({ length: lanes }, () => `clipitem-${++item}`));
    for (let ch = 0; ch < lanes; ch++) {
      const items = clips.map((c, k) => {
        const src = pool.get(c.sourceId);
        const srcFrames = src.channels[0].length;
        const sourceTrack = Math.min(ch + 1, src.channels.length);
        const links = lanes > 1 ? ids[k].map((lid, i) => `<link><linkclipref>${lid}</linkclipref><mediatype>audio</mediatype><trackindex>${tracks.length - ch + i + 1}</trackindex><clipindex>${k + 1}</clipindex></link>`).join('') : '';
        return (
          `<clipitem id="${ids[k][ch]}"><name>${esc(c.name)}</name><duration>${fr(srcFrames)}</duration>${rateXml}` +
          `<start>${fr(c.start)}</start><end>${fr(clipEnd(c))}</end><in>${fr(c.offset)}</in><out>${fr(c.offset + c.length)}</out>` +
          fileXml(c.sourceId) +
          `<sourcetrack><mediatype>audio</mediatype><trackindex>${sourceTrack}</trackindex></sourcetrack>` +
          `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype><parameter><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>${dbToGain(c.gain).toFixed(5)}</value></parameter></effect></filter>` +
          links +
          `</clipitem>`
        );
      });
      tracks.push(`<track><enabled>${t.mute ? 'FALSE' : 'TRUE'}</enabled>${items.join('')}</track>`);
    }
  }
  const end = Math.max(0, ...state.clips.map(clipEnd));
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5"><sequence id="sequence-1"><name>${esc(name)}</name><duration>${fr(end)}</duration>${rateXml}` +
    `<media><audio><format><samplecharacteristics><depth>24</depth><samplerate>${rate}</samplerate></samplecharacteristics></format>${tracks.join('')}</audio></media></sequence></xmeml>\n`
  );
}
