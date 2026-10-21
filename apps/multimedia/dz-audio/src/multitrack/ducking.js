// Keeps Sound Assistant ducking envelopes in step with the clips that trigger
// them: when a clip with Ducking on, or a clip of a type it ducks against,
// moves, is trimmed, muted, added or removed, the ducked clip's keyframes are
// generated again. Envelopes whose inputs did not change are left alone, so
// keyframes edited by hand survive unrelated edits.

import * as S from '../model/session-edits.js';
import { duckingKeyframes, duckTriggers } from '../sound-assistant/model.js';

const inputs = (state, clip, d) => JSON.stringify([clip.start, clip.length, clip.mute, duckTriggers(state.clips, d.against, clip.id)]);

/** Returns `state` with ducking regenerated where its inputs changed since `prev`. */
export function followDucking(prev, state) {
  let next = state;
  for (const c of state.clips) {
    const d = c.soundAssistant?.ducking;
    if (!d?.on) continue;
    const old = prev ? S.findClip(prev, c.id) : null;
    if (old?.soundAssistant?.ducking?.on && inputs(prev, old, d) === inputs(state, c, d)) continue;
    const env = duckingKeyframes({ clip: c, triggers: duckTriggers(state.clips, d.against, c.id), sensitivity: d.sensitivity, reduce: d.reduce, fade: d.fade, rate: state.sampleRate });
    if (JSON.stringify(env) === JSON.stringify(c.volumeEnv)) continue;
    next = S.updateClips(next, [c.id], { volumeEnv: env, soundAssistant: { ...c.soundAssistant, ducking: { ...d, generated: true } } });
  }
  return next;
}
