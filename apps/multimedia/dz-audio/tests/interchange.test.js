import { describe, it, expect } from 'vitest';
import { Channel } from '../src/audio/channel.js';
import { createSessionState, createClip } from '../src/model/session-edits.js';
import { sessionToXmeml, timebaseFor } from '../src/multitrack/interchange.js';

describe('interchange XML', () => {
  const rate = 48000;
  let state = createSessionState({ sampleRate: rate, tracks: 0, template: [{ name: 'Dialog', channels: 1 }, { name: 'Music', channels: 2 }] });
  const [dlg, mus] = state.tracks;
  state = {
    ...state,
    clips: [
      createClip({ trackId: dlg.id, sourceId: 'v', name: 'Voice <1>', start: rate, offset: rate / 2, length: rate * 2, gain: -6 }),
      createClip({ trackId: mus.id, sourceId: 'm', name: 'Song', start: 0, length: rate * 4 }),
    ],
  };
  const pool = new Map([
    ['v', { channels: [Channel.silence(rate * 3)] }],
    ['m', { channels: [Channel.silence(rate * 4), Channel.silence(rate * 4)] }],
  ]);
  const xml = sessionToXmeml(state, pool, { name: 'Show & Tell', files: new Map([['v', 'Voice.wav'], ['m', 'Song.wav']]) });

  it('writes a sequence with one track per channel and escaped names', () => {
    expect(xml).toContain('<xmeml version="5">');
    expect(xml).toContain('<name>Show &amp; Tell</name>');
    expect(xml).toContain('<name>Voice &lt;1&gt;</name>');
    expect(xml.match(/<track>/g)).toHaveLength(3);
  });

  it('places clips in timebase frames with their source range and gain', () => {
    expect(xml).toMatch(/<start>30<\/start><end>90<\/end><in>15<\/in><out>75<\/out>/);
    expect(xml).toContain('<value>0.50119</value>');
    // The stereo music clip appears on two linked tracks reading source channels 1 and 2.
    expect(xml.match(/<linkclipref>/g)).toHaveLength(4);
    expect(xml).toContain('<trackindex>2</trackindex></sourcetrack>');
  });

  it('describes each media file once', () => {
    expect(xml.match(/<pathurl>Song.wav<\/pathurl>/g)).toHaveLength(1);
    expect(timebaseFor('smpte2997df')).toEqual({ fps: 30, ntsc: true });
  });
});
