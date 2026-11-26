/* Counts: where the 1 falls, phrase by phrase.
   In bachata the chords change on the 1 and on the 5. For every beat we measure how much the harmony
   (guitar + bass + other) changes there, and how strong the bass is. A Viterbi pass over the beats then
   follows the count 1..8: normally each beat is the next count, but the count may jump (a 2- or 4-beat
   break, a bar added or skipped) when several phrases in a row clearly agree on the new position.
   Result: anchors [{i, c}] = beat i has count c (0 = the 1), the count goes on from there. */
(function (root) {
  'use strict';
  function features(stems, beats, n, SR, Sep) {
    const harm = new Float32Array(n);
    for (const id of ['guitar', 'bass', 'altro']) { const [L, R] = stems[id]; for (let i = 0; i < n; i++) harm[i] += (L[i] + R[i]) * 0.5; }
    const NF = 8192, HOP = 2048, z = Sep.stft(harm, NF, HOP, false), bins = [];
    for (let f = 1; f < z.F; f++) { const hz = f * SR / NF; if (hz >= 55 && hz <= 1800) bins.push([f, ((Math.round(12 * Math.log2(hz / 440)) % 12) + 12) % 12]); }
    const chroma = (t0, t1) => { const c = new Float64Array(12), f0 = Math.max(0, Math.floor(t0 * SR / HOP)), f1 = Math.min(z.T, Math.ceil(t1 * SR / HOP));
      for (const [f, pc] of bins) for (let t = f0; t < f1; t++) c[pc] += Math.hypot(z.re[f * z.T + t], z.im[f * z.T + t]);
      let s = 0; for (const v of c) s += v * v; s = Math.sqrt(s) || 1; return c.map(v => v / s); };
    const m = beats.length, h = new Float64Array(m), b = new Float64Array(m), [BL] = stems.bass, w = Math.floor(0.06 * SR);
    for (let i = 2; i < m - 2; i++) { const a = chroma(beats[i - 2], beats[i]), c = chroma(beats[i], beats[i + 2]); let dot = 0; for (let k = 0; k < 12; k++) dot += a[k] * c[k]; h[i] = 1 - dot; }
    beats.forEach((t, i) => { const a = Math.floor(t * SR); if (a < 0 || a + w >= n) return; let e = 0; for (let j = a; j < a + w; j++) e += BL[j] * BL[j]; b[i] = e; });
    return { h: zs(h), b: zs(b) };
  }
  function zs(x) { const v = Array.from(x).filter(Number.isFinite), mu = v.reduce((a, c) => a + c, 0) / (v.length || 1), sd = Math.sqrt(v.reduce((a, c) => a + (c - mu) ** 2, 0) / (v.length || 1)) || 1;
    return Float64Array.from(x, y => Math.max(-2, Math.min(3, (y - mu) / sd))); }

  // Viterbi over 8 count states. jump: cost of a change of count (only by 2, 4 or 6 beats: breaks, half bars)
  function viterbi(h, b, jump = 6) {
    const m = h.length, S = 8, score = new Float64Array(S), prev = new Float64Array(S), back = new Int8Array(m * S);
    const emit = (c, i) => (c === 0 ? h[i] + 0.25 * b[i] : c === 4 ? h[i] : -0.15 * h[i]);
    for (let c = 0; c < S; c++) score[c] = emit(c, 0);
    for (let i = 1; i < m; i++) {
      prev.set(score);
      for (let c = 0; c < S; c++) {
        let best = prev[(c + 7) % 8], bc = (c + 7) % 8;
        for (const d of [2, 4, 6]) { const p = (c + 7 - d + 8) % 8, v = prev[p] - jump; if (v > best) { best = v; bc = p; } }
        score[c] = best + emit(c, i); back[i * S + c] = bc;
      }
    }
    let c = 0; for (let k = 1; k < S; k++) if (score[k] > score[c]) c = k;
    const out = new Int8Array(m); for (let i = m - 1; i >= 0; i--) { out[i] = c; if (i) c = back[i * S + c]; }
    return out;
  }
  function anchors(counts) {
    const out = []; if (!counts.length) return out;
    out.push({ i: 0, c: counts[0] });
    for (let i = 1; i < counts.length; i++) if (counts[i] !== (counts[i - 1] + 1) % 8) out.push({ i, c: counts[i] });
    // keep the anchor of the 1 itself: express each anchor at the first beat with count 0 after it (or the beat itself)
    return out;
  }
  function analyze(stems, beats, n, SR, Sep, jump) {
    if (beats.length < 16) return [{ i: 0, c: 0 }];
    const f = features(stems, beats, n, SR, Sep);
    return anchors(viterbi(f.h, f.b, jump));
  }
  // count (0..7) of beat i given the anchors
  function countAt(anc, i) {
    let a = anc[0]; for (const x of anc) { if (x.i <= i) a = x; else break; }
    return (((a.c + i - a.i) % 8) + 8) % 8;
  }
  root.Counts = { features, viterbi, anchors, analyze, countAt };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : globalThis);
