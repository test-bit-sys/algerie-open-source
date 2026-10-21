// Clip menu: fade kinds and crossfades, groups, unique copies, silencing
// time in clips and the Edit > Select clip and time commands.
import { describe, it, expect } from 'vitest';
import * as S from '../src/model/session-edits.js';
import { clipPlan } from '../src/model/session-graph.js';

const RATE = 1000;

function twoOverlapping({ autoCrossfade = true } = {}) {
  let s = { ...S.createSessionState({ sampleRate: RATE, tracks: 2 }), autoCrossfade };
  const t = s.tracks[0].id;
  const a = S.createClip({ trackId: t, sourceId: 'src', name: 'A', start: 0, length: 600 });
  const b = S.createClip({ trackId: t, sourceId: 'src', name: 'B', start: 400, length: 600 });
  s = S.addClips(s, [a, b]);
  return { s, a, b };
}

describe('fade kinds', () => {
  it('reports crossfade, fade and none for each end as heard', () => {
    const { s, a, b } = twoOverlapping();
    expect(S.fadeMode(s, b, 'in')).toBe('crossfade');
    expect(S.fadeMode(s, a, 'out')).toBe('crossfade');
    expect(S.fadeMode(s, a, 'in')).toBe('none');
    const off = { ...s, autoCrossfade: false };
    expect(S.fadeMode(off, b, 'in')).toBe('none');
  });

  it('No Fade on an overlapping end stops the automatic crossfade (front clip hides the rear one)', () => {
    const { s, b } = twoOverlapping();
    const next = S.setFadeMode(s, [b.id], 'in', 'none');
    expect(S.findClip(next, b.id).fadeIn).toMatchObject({ length: 0, xf: false });
    expect(S.activeCrossfades(next)).toHaveLength(0);
    expect(clipPlan(next).get(b.id).fadeIn.length).toBe(0);
  });

  it('Fade In gives a plain fade of the default length; elsewhere it leaves crossfading to the session', () => {
    const { s, a, b } = twoOverlapping();
    let next = S.setFadeMode(s, [a.id], 'in', 'fade');
    expect(S.findClip(next, a.id).fadeIn.length).toBe(S.defaultFadeLength(a, RATE));
    expect('xf' in S.findClip(next, a.id).fadeIn).toBe(false);
    next = S.setFadeMode(next, [b.id], 'in', 'fade');
    expect(S.fadeMode(next, S.findClip(next, b.id), 'in')).toBe('fade');
  });

  it('Crossfade marks both clips so the overlap crossfades even with automatic crossfades off', () => {
    const { s, a, b } = twoOverlapping({ autoCrossfade: false });
    expect(clipPlan(s).get(b.id).fadeIn.length).toBe(0);
    const next = S.setFadeMode(s, [b.id], 'in', 'crossfade');
    expect(S.findClip(next, b.id).fadeIn.xf).toBe(true);
    expect(S.findClip(next, a.id).fadeOut.xf).toBe(true);
    const plan = clipPlan(next);
    expect(plan.get(b.id).fadeIn.length).toBe(200);
    expect(plan.get(a.id).fadeOut.length).toBe(200);
    // Both clips stay audible through the overlap.
    expect(plan.get(a.id).parts).toEqual([[0, 600]]);
  });

  it('Crossfade leaves a clip without an overlap on that end alone', () => {
    const { s, a } = twoOverlapping();
    expect(S.setFadeMode(s, [a.id], 'in', 'crossfade')).toBe(s);
  });

  it('an explicit no-crossfade wins over a crossfade on the other clip', () => {
    const { s, a, b } = twoOverlapping({ autoCrossfade: false });
    let next = S.setFadeMode(s, [b.id], 'in', 'crossfade');
    next = S.setFadeMode(next, [a.id], 'out', 'none');
    expect(S.overlapCrossfades(next, S.findClip(next, a.id), S.findClip(next, b.id))).toBe(false);
  });
});

describe('groups', () => {
  it('removes one clip from a group and dissolves a group left with one clip', () => {
    let s = S.createSessionState({ sampleRate: RATE, tracks: 1 });
    const t = s.tracks[0].id;
    const clips = [0, 1, 2].map((i) => S.createClip({ trackId: t, sourceId: 'src', start: i * 200, length: 100 }));
    s = S.groupClips(S.addClips(s, clips), clips.map((c) => c.id));
    let next = S.removeFromGroup(s, clips[0].id);
    expect(S.findClip(next, clips[0].id).groupId).toBe(null);
    expect(S.findClip(next, clips[1].id).groupId).toBe(S.findClip(s, clips[1].id).groupId);
    next = S.removeFromGroup(next, clips[1].id);
    expect(next.clips.every((c) => c.groupId === null)).toBe(true);
    expect(S.removeFromGroup(next, clips[2].id)).toBe(next);
  });
});

describe('silence time selection in clips', () => {
  it('drops the volume envelope to silence over the range with short ramps, without splitting', () => {
    let s = S.createSessionState({ sampleRate: RATE, tracks: 1 });
    const c = S.createClip({ trackId: s.tracks[0].id, sourceId: 'src', start: 100, length: 1000, volumeEnv: [{ t: 0, v: -6 }, { t: 1000, v: -6 }] });
    s = S.addClips(s, [c]);
    const next = S.silenceClipsRange(s, [c.id], 400, 600, 5);
    expect(next.clips).toHaveLength(1);
    const env = S.findClip(next, c.id).volumeEnv;
    expect(S.envelopeValue(env, 250, 0)).toBe(-6);
    expect(S.envelopeValue(env, 295, 0)).toBe(-6);
    expect(S.envelopeValue(env, 300, 0)).toBe(S.SILENT_DB);
    expect(S.envelopeValue(env, 450, 0)).toBe(S.SILENT_DB);
    expect(S.envelopeValue(env, 500, 0)).toBe(S.SILENT_DB);
    expect(S.envelopeValue(env, 505, 0)).toBe(-6);
    expect(S.envelopeValue(env, 900, 0)).toBe(-6);
  });

  it('silences from the clip start when the range begins before the clip, and leaves other clips alone', () => {
    let s = S.createSessionState({ sampleRate: RATE, tracks: 1 });
    const c = S.createClip({ trackId: s.tracks[0].id, sourceId: 'src', start: 100, length: 1000 });
    const other = S.createClip({ trackId: s.tracks[0].id, sourceId: 'src', start: 2000, length: 100 });
    s = S.addClips(s, [c, other]);
    const next = S.silenceClipsRange(s, [c.id, other.id], 0, 300, 3);
    const env = S.findClip(next, c.id).volumeEnv;
    expect(env[0]).toEqual({ t: 0, v: S.SILENT_DB });
    expect(S.envelopeValue(env, 199, 0)).toBe(S.SILENT_DB);
    expect(S.envelopeValue(env, 203, 0)).toBe(0);
    expect(S.findClip(next, other.id)).toBe(other);
    expect(S.silenceClipsRange(s, [other.id], 0, 300)).toBe(s);
  });
});
