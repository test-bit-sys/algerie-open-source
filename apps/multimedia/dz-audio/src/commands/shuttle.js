// J/K/L shuttle: L plays forward and each further press doubles the speed,
// J runs backward the same way, K stops. The engine plays at normal speed
// only, so faster and backward shuttling jump the playhead every tick: fast
// forward skips ahead between short stretches of normal playback, and
// backward plays short stretches while stepping back further each time.
// The first speed comes from Preferences > Playback and Recording.

const TICK = 0.15; // seconds between jumps
const MAX = 16;

/** Speed after a J (-1) or L (+1) press from `speed`, starting at `base`. */
export function nextShuttleSpeed(speed, dir, base = 1) {
  if (dir > 0) return speed <= 0 ? base : Math.min(MAX, speed * 2);
  return speed >= 0 ? -base : Math.max(-MAX, speed * 2);
}

/** Frames the playhead jumps each tick at `speed` (0 at normal forward speed). */
export function shuttleJump(speed, rate, tick = TICK) {
  if (speed > 0) return Math.round((speed - 1) * tick * rate);
  // Backward: undo the tick of normal playback, then step back |speed| ticks.
  return -Math.round((1 - speed) * tick * rate);
}

export function shuttleCommands(app) {
  let speed = 0;
  let timer = 0;
  let own = false; // true while the shuttle itself stops playback

  const clear = () => {
    clearInterval(timer);
    timer = 0;
  };

  const tick = () => {
    const doc = app.active;
    if (!doc || !app.engine.playing) return reset();
    const jump = shuttleJump(speed, doc.sampleRate);
    if (!jump) return;
    const at = app.engine.position + jump;
    if (at <= 0 && speed < 0) {
      stop();
      doc.setCursor(0);
      return;
    }
    if (at >= doc.length && speed > 0) return stop();
    app.engine.seek(Math.max(0, Math.min(doc.length, Math.round(at))));
  };

  const reset = () => {
    clear();
    speed = 0;
  };

  const stop = () => {
    reset();
    own = true;
    if (app.engine.playing) app.stop();
    own = false;
    app.setStatus('');
  };

  app.on('transport', (s) => {
    if (s === 'stopped' && !own && speed) reset();
  });

  const go = async (dir) => {
    const doc = app.active;
    if (!doc) return;
    const base = Math.max(1, Math.min(4, Number(app.prefs.get('shuttleSpeed')) || 1));
    speed = nextShuttleSpeed(speed, dir, base);
    clear();
    if (!app.engine.playing) {
      // Backward from the very start has nowhere to go.
      if (speed < 0 && doc.cursor <= 0) {
        speed = 0;
        return;
      }
      await app.play({ to: doc.length });
    }
    if (shuttleJump(speed, doc.sampleRate)) timer = setInterval(tick, TICK * 1000);
    app.setStatus(`Shuttle ${speed < 0 ? 'backward' : 'forward'} ${Math.abs(speed)}x`);
  };

  const anyDoc = (a) => Boolean(a.active);
  return [
    { id: 'transport.shuttleReverse', label: 'Shuttle Backward', shortcut: 'J', enabled: anyDoc, run: () => go(-1) },
    { id: 'transport.shuttleStop', label: 'Shuttle Stop', shortcut: 'K', enabled: anyDoc, run: () => stop() },
    { id: 'transport.shuttleForward', label: 'Shuttle Forward', shortcut: 'L', enabled: anyDoc, run: () => go(1) },
  ];
}
