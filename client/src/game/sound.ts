/**
 * Retro 8-bit sound effects, synthesized live with the Web Audio API
 * (square / triangle / noise channels like old consoles). No audio files,
 * no music — just short blips for actions.
 */

type Wave = OscillatorType;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

const MUTE_KEY = 'royale:muted';
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
})();

const listeners = new Set<(m: boolean) => void>();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (master) master.gain.value = value ? 0 : 0.5;
  listeners.forEach((l) => l(value));
}

export function onMuteChange(fn: (m: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Browsers only allow audio after a user gesture; call this from one. */
export function unlockAudio(): void {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function ready(): AudioContext | null {
  if (muted || !ctx || !master || ctx.state !== 'running') return null;
  return ctx;
}

/** One note. `at` is seconds from now. */
function tone(freq: number, at: number, dur: number, opts: { wave?: Wave; vol?: number; slideTo?: number } = {}) {
  const c = ready();
  if (!c) return;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = opts.wave ?? 'square';
  osc.frequency.setValueAtTime(freq, t);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
  const vol = opts.vol ?? 0.12;
  gain.gain.setValueAtTime(vol, t);
  gain.gain.setValueAtTime(vol, t + dur * 0.7);
  gain.gain.linearRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(master!);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Filtered noise burst (card flicks, shuffles). */
function noise(at: number, dur: number, opts: { vol?: number; freq?: number } = {}) {
  const c = ready();
  if (!c || !noiseBuffer) return;
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = opts.freq ?? 3000;
  filter.Q.value = 1.2;
  const gain = c.createGain();
  gain.gain.setValueAtTime(opts.vol ?? 0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(gain).connect(master!);
  src.start(t);
  src.stop(t + dur + 0.02);
}

const seq = (notes: number[], step: number, dur: number, opts: { wave?: Wave; vol?: number } = {}) =>
  notes.forEach((f, i) => tone(f, i * step, dur, opts));

// Note frequencies (Hz)
const N = {
  C4: 262, D4: 294, E4: 330, F4: 349, G4: 392, A4: 440, B4: 494,
  C5: 523, D5: 587, E5: 659, F5: 698, G5: 784, A5: 880, B5: 988,
  C6: 1047, E6: 1319, G6: 1568,
  C3: 131, E3: 165, G3: 196, A3: 220,
};

export const sfx = {
  /** Generic menu/button press. */
  click: () => tone(N.A5, 0, 0.04, { vol: 0.08 }),
  /** Selecting a card in your hand. */
  select: () => tone(N.E5, 0, 0.05, { wave: 'triangle', vol: 0.18, slideTo: N.A5 }),
  /** A card lands on the table. */
  cardPlay: () => {
    noise(0, 0.07, { vol: 0.3, freq: 2500 });
    tone(N.C4, 0, 0.05, { wave: 'triangle', vol: 0.12 });
  },
  /** Dealing / shuffling: a quick run of card flicks. */
  deal: () => {
    for (let i = 0; i < 8; i++) noise(i * 0.05, 0.04, { vol: 0.18, freq: 3500 + (i % 2) * 800 });
  },
  /** Someone bids — rising two-note. */
  bid: () => seq([N.C5, N.G5], 0.07, 0.07),
  /** Holder stays at the same number — two equal beeps. */
  stay: () => seq([N.E5, N.E5], 0.09, 0.06),
  /** Someone passes — low falling blip. */
  pass: () => tone(N.G4, 0, 0.12, { vol: 0.09, slideTo: N.C4 }),
  /** Bidding won, trump selection begins. */
  bidWon: () => seq([N.C5, N.E5, N.G5, N.C6], 0.06, 0.06),
  /** Trump chosen (secretly or openly). */
  trumpChosen: () => seq([N.G4, N.C5], 0.08, 0.08, { wave: 'triangle', vol: 0.18 }),
  /** Normal trump revealed — rising arpeggio. */
  trumpReveal: () => seq([N.C5, N.E5, N.G5, N.C6, N.E6], 0.05, 0.07),
  /** Reverse trump revealed — the same arpeggio upside down, warbly. */
  reverseReveal: () => {
    seq([N.E6, N.C6, N.G5, N.E5, N.C5], 0.05, 0.07);
    tone(N.C5, 0.27, 0.22, { slideTo: N.C4, vol: 0.1 });
  },
  /** It's your turn. */
  yourTurn: () => seq([N.B5, N.E6], 0.08, 0.08, { wave: 'triangle', vol: 0.2 }),
  /** Your team takes the trick. */
  trickWon: () => seq([N.G5, N.C6], 0.06, 0.09),
  /** The other team takes the trick. */
  trickLost: () => seq([N.E4, N.C4], 0.07, 0.09, { wave: 'triangle', vol: 0.2 }),
  /** Pair (K+Q) declared. */
  pair: () => seq([N.A5, N.C6, N.A5, N.E6], 0.06, 0.06),
  /** Your team won the round. */
  roundWon: () => seq([N.C5, N.E5, N.G5, N.E5, N.C6], 0.09, 0.09),
  /** Your team lost the round. */
  roundLost: () => seq([N.G4, N.E4, N.C4, N.C3], 0.12, 0.12, { wave: 'triangle', vol: 0.22 }),
  /** Match victory fanfare (short, not music). */
  victory: () => {
    seq([N.C5, N.C5, N.C5, N.C5, N.A4, N.B4, N.C5], 0.1, 0.09);
    tone(N.B4, 0.7, 0.08);
    tone(N.C5, 0.8, 0.4);
  },
  /** Match lost. */
  defeat: () => seq([N.C5, N.B4, N.A4, N.G4, N.E3], 0.14, 0.14, { wave: 'triangle', vol: 0.22 }),
  /** Action rejected / illegal move. */
  error: () => {
    tone(N.A3, 0, 0.09, { wave: 'sawtooth', vol: 0.08 });
    tone(N.A3, 0.11, 0.12, { wave: 'sawtooth', vol: 0.08 });
  },
  /** A player joins / reconnects. */
  join: () => seq([N.G5, N.B5], 0.05, 0.05, { wave: 'triangle', vol: 0.18 }),
  /** A player leaves / disconnects. */
  leave: () => seq([N.B4, N.G4], 0.06, 0.06, { wave: 'triangle', vol: 0.18 }),
  /** Ready up in the lobby. */
  ready: () => seq([N.C5, N.G5, N.C6], 0.05, 0.05),
  /** Match starting. */
  start: () => seq([N.G4, N.C5, N.E5, N.G5], 0.07, 0.08),
  /** Last seconds of your turn timer. */
  tick: () => tone(N.C6, 0, 0.03, { vol: 0.07 }),
};
