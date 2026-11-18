// Glicko-2 (Mark Glickman, 2012) para partidas 1v1.
// Cada jugador tiene rating (MMR), RD (incertidumbre) y volatilidad. Un jugador nuevo
// (RD alto) se mueve mucho tras cada partida; uno con muchas partidas, poco.
// Cada partida se trata como un periodo de valoración con un único rival.

export interface Rating { mmr: number; rd: number; vol: number }

export const DEFAULT_RD = 350;
export const DEFAULT_VOL = 0.06;
export const MIN_RD = 40; // nunca del todo «seguro»: sigue habiendo movimiento
const SCALE = 173.7178;
const TAU = 0.5; // cuánto puede cambiar la volatilidad
const EPS = 1e-6;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** Nuevo rating de `me` tras jugar contra `opp` con resultado `score` (1 gana, 0,5 empate, 0 pierde). */
export function updateRating(me: Rating, opp: Rating, score: number): Rating {
  const mu = (me.mmr - 1500) / SCALE;
  const phi = me.rd / SCALE;
  const muJ = (opp.mmr - 1500) / SCALE;
  const phiJ = opp.rd / SCALE;

  const gJ = g(phiJ);
  const E = expected(mu, muJ, phiJ);
  const v = 1 / (gJ * gJ * E * (1 - E));
  const delta = v * gJ * (score - E);

  // Nueva volatilidad (algoritmo de Illinois).
  const a = Math.log(me.vol * me.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > EPS; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else { fA = fA / 2; }
    B = C; fB = fC;
  }
  const vol = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * gJ * (score - E);

  return {
    mmr: Math.round(SCALE * muNew + 1500),
    rd: Math.max(MIN_RD, Math.min(DEFAULT_RD, SCALE * phiNew)),
    vol,
  };
}

/** Probabilidad de que A gane a B (para mostrar o emparejar). */
export function winProbability(a: Rating, b: Rating): number {
  const phi = Math.sqrt(a.rd * a.rd + b.rd * b.rd) / SCALE;
  return expected((a.mmr - 1500) / SCALE, (b.mmr - 1500) / SCALE, phi);
}
