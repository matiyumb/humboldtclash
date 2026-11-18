// Genera las pistas de demostración de Humboldtclash: música original sintetizada
// a partir de una semilla, sin muestras de terceros (licencia CC0).
// Uso: npm run generate-audio  [-- --force]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const SR = 44100;
const DURATION = 14; // segundos (el juego usa 10)
const force = process.argv.includes('--force');

interface Track {
  id: string;
  title: string;
  file: string;
  generator?: { style: Style; seed: number };
}
type Style = 'pop' | 'cumbia' | 'bolero' | 'synth';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];

type Wave = 'sine' | 'tri' | 'square' | 'saw';
function osc(wave: Wave, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'sine': return Math.sin(2 * Math.PI * p);
    case 'tri': return 1 - 4 * Math.abs(p - 0.5);
    case 'square': return p < 0.5 ? 0.8 : -0.8;
    case 'saw': return 2 * p - 1;
  }
}

class Mix {
  buf = new Float32Array(SR * DURATION);
  add(i: number, v: number) {
    if (i >= 0 && i < this.buf.length) this.buf[i] += v;
  }
}

interface ToneOpts {
  wave: Wave;
  gain: number;
  attack?: number;
  release?: number;
  vibrato?: number;
  lowpass?: number; // 0..1 coeficiente simple
  wave2?: Wave;
  detune?: number;
}

function tone(mix: Mix, t0: number, dur: number, freq: number, o: ToneOpts) {
  const a = o.attack ?? 0.01;
  const r = o.release ?? 0.08;
  const start = Math.floor(t0 * SR);
  const len = Math.floor((dur + r) * SR);
  let ph = 0, ph2 = 0, lp = 0;
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    const vib = o.vibrato ? 1 + o.vibrato * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t / 0.25) : 1;
    ph += (freq * vib) / SR;
    ph2 += (freq * vib * (1 + (o.detune ?? 0.006))) / SR;
    let s = osc(o.wave, ph);
    if (o.wave2) s = 0.6 * s + 0.4 * osc(o.wave2, ph2);
    if (o.lowpass) { lp += o.lowpass * (s - lp); s = lp; }
    let env = t < a ? t / a : 1;
    if (t > dur) env *= Math.max(0, 1 - (t - dur) / r);
    mix.add(start + n, s * env * o.gain);
  }
}

// Cuerda pulsada (Karplus-Strong) para guitarra y requinto.
function pluck(mix: Mix, t0: number, freq: number, gain: number, rand: () => number, decay = 0.996) {
  const period = Math.max(2, Math.round(SR / freq));
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = rand() * 2 - 1;
  const start = Math.floor(t0 * SR);
  const len = Math.floor(1.6 * SR);
  let idx = 0;
  for (let n = 0; n < len; n++) {
    const next = (idx + 1) % period;
    const v = ring[idx];
    ring[idx] = decay * 0.5 * (ring[idx] + ring[next]);
    idx = next;
    mix.add(start + n, v * gain);
  }
}

function kick(mix: Mix, t0: number, gain: number) {
  const start = Math.floor(t0 * SR);
  let ph = 0;
  for (let n = 0; n < SR * 0.3; n++) {
    const t = n / SR;
    ph += (45 + 110 * Math.exp(-t * 30)) / SR;
    mix.add(start + n, Math.sin(2 * Math.PI * ph) * Math.exp(-t * 9) * gain);
  }
}

function noiseHit(mix: Mix, t0: number, dur: number, gain: number, rand: () => number, bright = 0.9, tone = 0) {
  const start = Math.floor(t0 * SR);
  let prev = 0;
  for (let n = 0; n < SR * dur; n++) {
    const t = n / SR;
    const w = rand() * 2 - 1;
    const hp = w - bright * prev; // filtro paso alto rudimentario
    prev = w;
    const body = tone ? Math.sin(2 * Math.PI * tone * t) * Math.exp(-t * 25) : 0;
    mix.add(start + n, (hp * 0.6 + body) * Math.exp((-t * 4) / dur) * gain);
  }
}

function bongo(mix: Mix, t0: number, freq: number, gain: number) {
  const start = Math.floor(t0 * SR);
  for (let n = 0; n < SR * 0.18; n++) {
    const t = n / SR;
    mix.add(start + n, Math.sin(2 * Math.PI * freq * (1 + 0.3 * Math.exp(-t * 40)) * t) * Math.exp(-t * 22) * gain);
  }
}

const STYLE = {
  pop: { bpm: [100, 124], scales: [MAJOR, MINOR], progs: [[0, 4, 5, 3], [5, 3, 0, 4], [0, 5, 3, 4]] },
  cumbia: { bpm: [88, 102], scales: [MINOR, MAJOR], progs: [[0, 3, 4, 0], [0, 4, 0, 4], [5, 3, 4, 0]] },
  bolero: { bpm: [68, 84], scales: [HARM_MINOR, MAJOR], progs: [[0, 3, 4, 0], [0, 5, 1, 4], [0, 4, 5, 4]] },
  synth: { bpm: [108, 126], scales: [MINOR], progs: [[0, 5, 2, 6], [0, 3, 5, 4], [5, 3, 0, 6]] },
} as const;

function render(style: Style, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
  const S = STYLE[style];
  const bpm = S.bpm[0] + Math.floor(rand() * (S.bpm[1] - S.bpm[0]));
  const beat = 60 / bpm;
  const bar = beat * 4;
  const scale = pick(S.scales);
  const prog = pick(S.progs);
  const root = 57 + Math.floor(rand() * 8); // La3..Mi4
  const mix = new Mix();
  const deg = (d: number, oct = 0) => {
    const o = Math.floor(d / 7);
    const i = ((d % 7) + 7) % 7;
    return root + scale[i] + 12 * (o + oct);
  };

  // Motivo melódico de 2 compases con ritmo propio de cada canción.
  const rhythms = [
    [1, 0.5, 0.5, 1, 1], [0.5, 0.5, 1, 0.5, 0.5, 1], [1.5, 0.5, 1, 1],
    [0.5, 1, 0.5, 1, 1], [0.75, 0.75, 0.5, 1, 1], [1, 1, 0.5, 0.5, 1],
  ];
  const motif: { len: number; d: number }[] = [];
  for (let b = 0; b < 2; b++) {
    const rh = pick(rhythms);
    let d = 2 + Math.floor(rand() * 5);
    for (const len of rh) {
      motif.push({ len, d });
      d += pick([-2, -1, -1, 1, 1, 2, 3, -3, 0]);
      d = Math.max(0, Math.min(9, d));
    }
  }
  const totalBars = Math.ceil(DURATION / bar);
  const leadOpts: Record<Style, ToneOpts> = {
    pop: { wave: 'saw', wave2: 'square', gain: 0.16, lowpass: 0.18, attack: 0.02, vibrato: 0.004 },
    cumbia: { wave: 'square', wave2: 'saw', gain: 0.13, lowpass: 0.3, attack: 0.03, vibrato: 0.012, detune: 0.01 },
    bolero: { wave: 'sine', wave2: 'tri', gain: 0.22, attack: 0.08, release: 0.25, vibrato: 0.01 },
    synth: { wave: 'square', gain: 0.12, lowpass: 0.25, attack: 0.005, release: 0.05 },
  };

  for (let barIdx = 0; barIdx < totalBars; barIdx++) {
    const t = barIdx * bar;
    const chordDeg = prog[barIdx % prog.length];
    const chord = [deg(chordDeg, -1), deg(chordDeg + 2, -1), deg(chordDeg + 4, -1)];
    const bassNote = deg(chordDeg, -2);

    // Armonía
    if (style === 'pop') {
      for (const m of chord) tone(mix, t, bar * 0.95, mtof(m), { wave: 'tri', gain: 0.05, attack: 0.15, release: 0.3 });
      for (let k = 0; k < 8; k++) tone(mix, t + k * beat / 2, beat * 0.4, mtof(bassNote), { wave: 'saw', gain: 0.1, lowpass: 0.06 });
    } else if (style === 'cumbia') {
      for (let k = 0; k < 4; k++) {
        if (k % 2 === 1) for (const m of chord) tone(mix, t + k * beat + beat / 2, beat * 0.3, mtof(m + 12), { wave: 'square', gain: 0.03, lowpass: 0.2 });
      }
      tone(mix, t, beat * 0.8, mtof(bassNote), { wave: 'sine', gain: 0.32 });
      tone(mix, t + 2 * beat, beat * 0.8, mtof(deg(chordDeg + 4, -2)), { wave: 'sine', gain: 0.3 });
    } else if (style === 'bolero') {
      const arp = [0, 1, 2, 1, 0, 2, 1, 2];
      for (let k = 0; k < 8; k++) pluck(mix, t + (k * beat) / 2, mtof(chord[arp[k]] + 12), 0.18, rand, 0.995);
      tone(mix, t, beat * 1.8, mtof(bassNote), { wave: 'sine', gain: 0.26, release: 0.2 });
      tone(mix, t + 2 * beat, beat * 1.8, mtof(deg(chordDeg + 4, -2)), { wave: 'sine', gain: 0.22, release: 0.2 });
    } else {
      const arp = [0, 1, 2, 3, 2, 1, 0, 2];
      for (let k = 0; k < 16; k++) {
        const m = k % 8 === 3 ? chord[0] + 12 : chord[arp[k % 8] % 3];
        tone(mix, t + (k * beat) / 4, beat * 0.2, mtof(m + 12), { wave: 'square', gain: 0.045, lowpass: 0.35, attack: 0.002, release: 0.03 });
      }
      for (let k = 0; k < 4; k++) tone(mix, t + k * beat, beat * 0.9, mtof(bassNote), { wave: 'saw', gain: 0.13, lowpass: 0.05 });
    }

    // Percusión
    for (let k = 0; k < 4; k++) {
      const bt = t + k * beat;
      if (style === 'pop' || style === 'synth') {
        kick(mix, bt, 0.55);
        if (k % 2 === 1) noiseHit(mix, bt, 0.15, 0.22, rand, 0.3, 190);
        noiseHit(mix, bt + beat / 2, 0.04, 0.07, rand, 0.95);
        if (style === 'synth') noiseHit(mix, bt + beat / 4, 0.03, 0.04, rand, 0.95);
      } else if (style === 'cumbia') {
        noiseHit(mix, bt, beat * 0.45, 0.07, rand, 0.98); // güiro largo
        noiseHit(mix, bt + beat / 2, 0.06, 0.06, rand, 0.98);
        noiseHit(mix, bt + beat * 0.75, 0.06, 0.06, rand, 0.98);
        if (k % 2 === 0) bongo(mix, bt + beat / 2, 330, 0.18);
        else bongo(mix, bt, 220, 0.22);
      } else {
        bongo(mix, bt + beat / 2, 380, 0.12);
        if (k === 0 || k === 2) bongo(mix, bt, 250, 0.14);
        if (k === 3) bongo(mix, bt + beat * 0.75, 380, 0.1);
      }
    }
  }

  // Melodía: A A' B A con transposición del motivo.
  const shifts = [0, 0, 2, 0, -1, 0, 3, 0];
  let tm = 0;
  let section = 0;
  while (tm < DURATION) {
    const shift = shifts[section % shifts.length];
    for (let i = 0; i < motif.length && tm < DURATION; i++) {
      const n = motif[i];
      const len = n.len * beat;
      const midi = deg(n.d + shift) + (style === 'bolero' ? 0 : 12);
      if (style === 'cumbia' && rand() < 0.2) {
        // adornos de acordeón
        tone(mix, tm, len / 2, mtof(midi), leadOpts[style]);
        tone(mix, tm + len / 2, len / 2, mtof(deg(n.d + shift + 1) + 12), leadOpts[style]);
      } else if (style === 'bolero' && rand() < 0.3) {
        pluck(mix, tm, mtof(midi + 12), 0.2, rand, 0.997);
        tone(mix, tm, len * 0.9, mtof(midi), leadOpts[style]);
      } else {
        tone(mix, tm, len * 0.85, mtof(midi), leadOpts[style]);
      }
      tm += len;
    }
    section++;
  }

  // Normaliza y aplica fundidos.
  const b = mix.buf;
  let peak = 0;
  for (let i = 0; i < b.length; i++) peak = Math.max(peak, Math.abs(b[i]));
  const g = peak > 0 ? 0.89 / peak : 1;
  const fade = SR * 0.6;
  for (let i = 0; i < b.length; i++) {
    let e = 1;
    if (i < SR * 0.02) e = i / (SR * 0.02);
    if (i > b.length - fade) e = (b.length - i) / fade;
    b[i] = Math.tanh(b[i] * g * 1.1) * e;
  }
  return b;
}

function writeWav(path: string, data: Float32Array) {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + data.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  writeFileSync(path, buf);
}

const catalog = JSON.parse(readFileSync(join(ROOT, 'catalog/catalog.json'), 'utf8')) as { tracks: Track[] };
const outDir = join(ROOT, 'audio');
mkdirSync(outDir, { recursive: true });
const tmp = join(tmpdir(), 'humboldtclash-gen');
mkdirSync(tmp, { recursive: true });

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
let made = 0;
for (const t of catalog.tracks) {
  if (!t.generator) continue;
  const out = join(outDir, t.file);
  if (existsSync(out) && !force) continue;
  const pcm = render(t.generator.style, t.generator.seed);
  if (t.file.endsWith('.wav')) { writeWav(out, pcm); made++; continue; }
  if (!hasFfmpeg) throw new Error(`Hace falta ffmpeg para crear ${t.file} (o usa la extensión .wav en el catálogo).`);
  const wav = join(tmp, `${t.id}.wav`);
  writeWav(wav, pcm);
  // Sin metadatos: el archivo no debe revelar el título.
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-map_metadata', '-1', '-id3v2_version', '0', '-write_id3v1', '0', '-ac', '1', '-b:a', '96k', out]);
  if (r.status !== 0) throw new Error(`ffmpeg falló con ${t.file}: ${r.stderr}`);
  rmSync(wav);
  made++;
  process.stdout.write(`✓ ${t.title}\n`);
}
console.log(`Listo: ${made} pistas generadas en audio/`);
