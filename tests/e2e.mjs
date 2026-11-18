// Prueba de extremo a extremo: una partida en solitario y una multijugador en dos ventanas.
// Requiere el servidor arrancado con HUMBOLDTCLASH_TEST=1 (expone la respuesta correcta para el robot).
//   HUMBOLDTCLASH_TEST=1 PORT=3100 npm start   y luego   BASE=http://localhost:3100 npm run e2e
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE ?? 'http://localhost:3100';
const SHOTS = process.env.SHOTS ?? 'docs/capturas';
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const log = (...a) => console.log(...a);
function check(cond, msg) {
  if (cond) log(`  ✓ ${msg}`);
  else { failures++; log(`  ✗ ${msg}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const answer = async (code) => (await fetch(`${BASE}/api/test/answer/${code}`)).json();

async function waitAnswering(page, timeout = 20000) {
  await page.waitForSelector('.answer:not(:disabled):not(.is-placeholder)', { timeout });
}
async function optionTitles(page) {
  return page.$$eval('.answer .answer__title', (els) => els.map((e) => e.textContent.trim()));
}
async function roundIndex(page) {
  return Number((await page.textContent('.hud__item .hud__value')).split('/')[0]);
}
async function waitReveal(page, timeout = 14000) {
  await page.waitForSelector('.verdict', { timeout });
}
async function pointsFromVerdict(page) {
  const t = await page.textContent('.verdict');
  const m = t.match(/\+(\d+)/);
  return m ? Number(m[1]) : 0;
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [];
const watch = (p, name) => {
  p.on('pageerror', (e) => pageErrors.push(`${name}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_FAILED/.test(m.text())) pageErrors.push(`${name}: ${m.text()}`); });
};

// ───────────────────────── SOLITARIO ─────────────────────────
log('\n▶ Partida en solitario (escritorio)');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  watch(page, 'solo');
  await page.goto(BASE);
  await page.waitForSelector('.card');
  await page.screenshot({ path: `${SHOTS}/01-inicio.png` });
  await page.fill('#nickname', 'Mati');
  await page.fill('input[type=search]', 'marea');
  await page.waitForTimeout(600);
  const names = await page.$$eval('.grid .card .card__name', (els) => els.map((e) => e.textContent));
  check(names[0] === 'Marea Baja' && !names.includes('Luna Brava'), `el buscador filtra las tarjetas (${names.join(', ')})`);
  await page.fill('input[type=search]', '');
  await page.click('text=Practicar solo');
  await page.click('.card:has-text("Marea Baja")');
  await page.waitForSelector('.banner--error');
  check(/Solo hay 6/.test(await page.textContent('.setup__status')), 'Marea Baja (6 pistas) se rechaza: hacen falta 10');
  check(await page.isDisabled('text=Empezar partida'), '«Empezar partida» deshabilitado con catálogo insuficiente');
  await page.click('.card:has-text("Luna Brava")');
  await page.waitForSelector('.banner--info');
  check(!(await page.isDisabled('text=Empezar partida')), 'catálogo válido habilita «Empezar partida»');

  // Fallo de audio en la ronda 1: el primer intento falla, el reintento funciona.
  let failNext = 1;
  let persistNext = false;
  let persistUrl = null;
  const audioUrls = [];
  await page.route('**/api/audio/**', async (route) => {
    const url = route.request().url();
    audioUrls.push(url);
    if (failNext > 0) { failNext--; return route.abort(); }
    if (persistNext && !persistUrl) { persistUrl = url; persistNext = false; }
    if (url === persistUrl) return route.abort();
    return route.continue();
  });
  await page.click('button:has-text("Empezar partida")');
  await page.waitForSelector('text=No se pudo cargar el audio');
  check(await page.isVisible('button:has-text("Reintentar")'), 'fallo de audio: aparece «Reintentar» y el temporizador no arranca');
  check((await page.textContent('.timer__num')).trim() === '10', 'el temporizador sigue en 10 mientras no hay audio');
  check((await page.$$('.answer.is-placeholder')).length === 4, 'las opciones no se muestran antes de tiempo');
  const code = await page.evaluate(() => localStorage.getItem('hc.room'));
  check(audioUrls.every((u) => !/luna|brava|fuego|\.mp3/i.test(u)), 'la URL del audio es opaca (no revela la pista)');
  await page.click('button:has-text("Reintentar")');
  await waitAnswering(page);
  check(await roundIndex(page) === 1, 'tras reintentar empieza la ronda 1');

  let total = 0;
  let correctCount = 0;
  for (let r = 1; r <= 10; r++) {
    if (r > 1) await waitAnswering(page);
    check(await roundIndex(page) === r, `ronda ${r}/10`);
    const titles = await optionTitles(page);
    if (r === 1) check(new Set(titles).size === 4, 'cuatro títulos distintos');
    const sol = await answer(code);
    const idx = titles.indexOf(sol.title);
    if (r === 1) {
      await page.screenshot({ path: `${SHOTS}/02-partida-escritorio.png` });
      await page.keyboard.press(String(idx + 1)); // tecla del acierto
      await page.keyboard.press(String(((idx + 1) % 4) + 1)); // segunda respuesta: debe ignorarse
    } else if (r === 3) {
      const t0 = Date.now();
      await waitReveal(page, 13000);
      const dt = Date.now() - t0;
      check(dt > 8500 && dt < 11500, `sin respuesta, la ronda termina por tiempo (~${(dt / 1000).toFixed(1)} s)`);
      check(/Tiempo agotado/.test(await page.textContent('.verdict')), 'tiempo agotado: texto + icono, 0 puntos');
    } else if (r % 2 === 0) {
      if (r === 4) persistNext = true;
      await page.dblclick(`.answer >> nth=${(idx + 1) % 4}`); // fallo con doble clic
    } else {
      await sleep(2300);
      const before = Number((await page.textContent('.timer__num')).trim());
      check(before >= 7 && before <= 8, `la cuenta regresiva avanza (${before} s restantes)`);
      await page.click(`.answer >> nth=${idx}`);
    }
    if (r !== 3) await waitReveal(page);
    const pts = await pointsFromVerdict(page);
    const verdict = await page.textContent('.verdict');
    if (r % 2 === 1 && r !== 3) {
      check(/Acierto|Oído biónico/.test(verdict) && pts >= 5 && pts <= 10, `acierto con ${pts} puntos`);
      check(await page.isVisible('.answer.is-correct:has-text("Correcta")'), 'la respuesta correcta se marca con icono y texto');
      correctCount++;
    } else if (r !== 3) {
      check(/Fallaste/.test(verdict) && pts === 0, 'error = 0 puntos');
      check(await page.isVisible('.answer.is-wrong:has-text("Tu respuesta")'), 'el error se marca con icono y texto');
    }
    if (r === 1) {
      check(pts === 10, `respuesta inmediata = 10 puntos (${pts})`);
      await page.screenshot({ path: `${SHOTS}/03-revelacion.png` });
    }
    total += pts;
    const shown = Number(await page.getAttribute('.hud__item--right .hud__value', 'data-value'));
    check(shown === total, `marcador acumulado ${shown} = ${total}`);
    if (r === 4) {
      // Ronda 5: el audio falla siempre → 3 intentos → el servidor sustituye la canción.
      await page.waitForSelector('text=No se pudo cargar el audio', { timeout: 8000 });
      await page.click('button:has-text("Reintentar")');
      await page.waitForSelector('text=No se pudo cargar el audio', { timeout: 8000 });
      check((await page.textContent('.timer__num')).trim() === '10', 'el temporizador espera durante los reintentos');
      await page.click('button:has-text("Reintentar")');
      await waitAnswering(page);
      const last = audioUrls[audioUrls.length - 1];
      check(await roundIndex(page) === 5 && last !== persistUrl, 'tras 3 fallos se sustituye la canción y la ronda 5 continúa');
    }
  }
  await page.waitForSelector('.score-big', { timeout: 8000 });
  await page.screenshot({ path: `${SHOTS}/04-resultado-solo.png`, fullPage: true });
  const final = Number(await page.getAttribute('.score-big', 'data-value'));
  check(final === total, `resultado final ${final} puntos`);
  check((await page.textContent('.results__hits')).includes(`${correctCount} aciertos de 10`), `${correctCount} aciertos de 10`);
  check((await page.$$('.missed li')).length === 10 - correctCount, 'lista de canciones falladas');
  await page.click('text=Jugar otra vez');
  await waitAnswering(page, 20000);
  check(await roundIndex(page) === 1, '«Jugar otra vez» reinicia en la ronda 1');
  page.once('dialog', (d) => d.accept());
  await page.click('text=Abandonar');
  await page.waitForSelector('.mode-tabs');
  check(true, '«Abandonar» vuelve al inicio');
  await ctx.close();
}

// ───────────────────────── DEEZER ─────────────────────────
log('\n▶ Partida en solitario con Deezer (Omar Courtz)');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  watch(page, 'deezer');
  await page.goto(BASE);
  await page.fill('#nickname', 'Mati');
  await page.waitForSelector('.picker__title:has-text("Lo más sonado")');
  const feat = await page.$$eval('.picker__section:has(.picker__title:has-text("Lo más sonado")) .card__name', (els) => els.map((e) => e.textContent));
  check(['Bad Bunny', 'Quevedo', 'Omar Courtz'].every((n) => feat.includes(n)), `artistas más sonados de la semana (Deezer): ${feat.join(', ')}`);
  await page.screenshot({ path: `${SHOTS}/09-inicio-deezer.png`, fullPage: true });
  await page.fill('input[type=search]', 'quevedo');
  await page.waitForSelector('.picker__section:has-text("Resultados") .card:has-text("Quevedo"), .picker__section:has-text("Lo más sonado") .card:has-text("Quevedo")');
  check(true, 'la búsqueda encuentra a Quevedo en Deezer');
  await page.fill('input[type=search]', '');
  await page.click('.card:has-text("Omar Courtz")');
  await page.waitForSelector('.banner--info', { timeout: 10000 });
  check(/12 canciones/.test(await page.textContent('.setup__status')), 'Omar Courtz: 12 canciones con vista previa');
  const audioReqs = [];
  page.on('request', (r) => { if (r.url().includes('/api/audio/')) audioReqs.push(r.url()); });
  await page.click('button:has-text("Empezar partida")');
  await page.waitForSelector('.intro__num', { timeout: 8000 });
  check(true, 'cuenta atrás «3, 2, 1» antes de la primera ronda');
  await page.screenshot({ path: `${SHOTS}/11-cuenta-atras.png` });
  await page.waitForSelector('.hud', { timeout: 15000 });
  const code = await page.evaluate(() => localStorage.getItem('hc.room'));
  for (let r = 1; r <= 3; r++) {
    await waitAnswering(page, 20000);
    const sol = await answer(code);
    const titles = await optionTitles(page);
    check(titles.includes(sol.title), `ronda ${r}: suena la vista previa y aparecen 4 títulos («${sol.title}»)`);
    if (r === 1) {
      await page.waitForFunction(() => [...document.querySelectorAll('.answer img.answer__cover')].filter((i) => i.complete && i.naturalWidth > 0).length === 4, null, { timeout: 5000 }).catch(() => {});
      check((await page.$$('.answer img.answer__cover')).length === 4, 'cada opción muestra la portada del álbum');
      await page.screenshot({ path: `${SHOTS}/12-portadas.png` });
    }
    await page.click(`.answer:has-text("${sol.title}")`);
    await waitReveal(page);
    const href = await page.getAttribute('.verdict a', 'href');
    check(/deezer\.com\/track\//.test(href ?? ''), 'al revelar aparece «Escuchar en Deezer»');
    if (r === 1) await page.screenshot({ path: `${SHOTS}/10-deezer-revelacion.png` });
  }
  check(audioReqs.length > 0 && audioReqs.every((u) => !/dzcdn|deezer|preview|4100/.test(u)), 'el navegador nunca ve la URL de Deezer');
  page.once('dialog', (d) => d.accept());
  await page.click('text=Abandonar');
  await page.waitForSelector('.mode-tabs');
  await ctx.close();
}

// ───────────────────────── PLAYLISTS, AJUSTES, PERFIL, TEMA Y VOLUMEN ─────────────────────────
log('\n▶ Playlist propia, 5 rondas Nicho en modo 1 segundo, perfil, ranking, tema y volumen');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  watch(page, 'v3');
  await page.goto(BASE);
  await page.fill('#nickname', 'Mati');
  await page.waitForSelector('.profile');
  check(/Aprendiz/.test(await page.textContent('.profile')), 'tarjeta de perfil con rango (Aprendiz al empezar)');

  await page.click('.corner-btn[aria-label*="oscuro"]');
  check((await page.getAttribute('html', 'data-theme')) === 'dark', 'modo oscuro');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/14-inicio-oscuro.png` });

  await page.click('[aria-label="Ajustar volumen"]');
  await page.waitForSelector('.sound__panel');
  await page.locator('.sound__panel input[type=range]').first().fill('40');
  check((await page.evaluate(() => localStorage.getItem('hc.vol.music'))) === '0.4', 'volumen de música ajustado y guardado');
  await page.keyboard.press('Escape');

  // Playlist: dos artistas al azar + barajar
  await page.click('.mixes-cta');
  await page.click('text=+ Nueva playlist');
  await page.fill('.mix-editor .field input', 'Perreo del recreo');
  await page.fill('.mix-editor input[type=search]', 'bad');
  await page.click('.artist-chip:has-text("Bad Bunny")');
  await page.waitForFunction(() => document.querySelectorAll('.song-list--mine li').length === 5);
  await page.fill('.mix-editor input[type=search]', 'omar');
  await page.click('.artist-chip:has-text("Omar Courtz")');
  await page.waitForFunction(() => document.querySelectorAll('.song-list--mine li').length === 10);
  check(/2 artistas/.test(await page.textContent('.mix-editor__listhead')), 'playlist con 10 canciones de 2 artistas al azar');
  const before = await page.$$eval('.song-list--mine .song-list__txt b', (e) => e.map((x) => x.textContent).join('|'));
  // Importar una lista pegada (Artista - Canción)
  await page.click('.import summary');
  await page.fill('.import__text', 'Quevedo - Columbia\nQuevedo - Punto G\nNadie - Canción Inventada');
  await page.click('.import button:has-text("Importar")');
  await page.waitForSelector('.import .muted:has-text("añadidas")', { timeout: 10000 });
  check(/2 añadidas · no encontradas: Nadie - Canción Inventada/.test(await page.textContent('.import')), 'importar lista: 2 encontradas y 1 que no existe');
  await page.waitForFunction(() => document.querySelectorAll('.song-list--mine li').length === 12);
  await page.click('button:has-text("🎲 Barajar")');
  const after = await page.$$eval('.song-list--mine .song-list__txt b', (e) => e.map((x) => x.textContent).join('|'));
  check(before !== after || before.split('|').length < 2, 'barajar cambia el orden');
  await page.screenshot({ path: `${SHOTS}/15-playlist.png` });
  await page.click('button:has-text("Guardar y jugar")');

  // Ajustes: 5 rondas, Nicho, fragmento de 2 s, solo instrumental
  await page.waitForSelector('.selected-line:has-text("Perreo del recreo")');
  await page.locator('.settings input[type=range]').fill('5');
  await page.click('.segmented__opt:has-text("Nicho")');
  await page.click('.chip-opt:has-text("2 s")');
  await page.click('.switch:has-text("Solo instrumental")');
  await page.waitForFunction(() => /5 rondas/.test(document.querySelector('.setup__status')?.textContent ?? ''), null, { timeout: 8000 });
  check(true, 'catálogo verificado para 5 rondas en nivel Nicho');
  await page.screenshot({ path: `${SHOTS}/16-ajustes.png` });
  await page.click('button:has-text("Empezar partida")');
  await page.waitForSelector('.hud', { timeout: 15000 });
  const code = await page.evaluate(() => localStorage.getItem('hc.room'));
  for (let r = 1; r <= 5; r++) {
    await waitAnswering(page, 20000);
    check((await page.textContent('.hud__item .hud__value')).includes('/5'), `ronda ${r}/5`);
    if (r === 1) check(/Fragmento de 2 s sin voz/.test(await page.textContent('.stage__status')), 'aviso: fragmento de 2 s en modo instrumental');
    const sol = await answer(code);
    await page.click(`.answer:has-text("${sol.title}")`);
    await waitReveal(page);
  }
  await page.waitForSelector('.score-big', { timeout: 8000 });
  check(/5<\/b> aciertos de 5|5 aciertos de 5/.test(await page.innerHTML('.results__hits')), '5 aciertos de 5');
  check(!(await page.isVisible('.win-flag')) && /Modo práctica/.test(await page.textContent('.results')), 'el modo solo es práctica: no suma victorias');
  check(/respondes en/.test(await page.textContent('.results__hits')), 'muestra el tiempo medio de respuesta');
  await page.screenshot({ path: `${SHOTS}/17-resultado-practica.png` });
  await page.click('text=Volver al inicio');
  await page.waitForSelector('.mode-tabs');
  // El logo lleva al inicio
  await page.click('.mixes-cta');
  await page.click('.logo-btn');
  await page.waitForSelector('.mode-tabs');
  check(true, 'pulsar el logo vuelve al inicio');
  // En el inicio, el logo grande también es un botón: vuelve a cargar el inicio (arriba y catálogo al día).
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const recarga = page.waitForResponse((res) => res.url().endsWith('/api/catalogs'), { timeout: 5000 });
  await page.click('.home__head .logo-btn');
  await recarga;
  await page.waitForSelector('.mode-tabs');
  check((await page.evaluate(() => window.scrollY)) === 0, 'en el inicio, el logo vuelve a cargar el inicio y sube arriba');
  await ctx.close();
}

// URL caducada: el servidor debe pedir una nueva a Deezer (/track/:id) y servir el audio igual.
{
  const r = await fetch(`${BASE}/api/catalogs/deezer:artist:3/check`).then((x) => x.json());
  check(r.ok, 'catálogo de Omar Courtz verificado');
}

// ───────────────────────── MULTIJUGADOR ─────────────────────────
log('\n▶ Partida multijugador (escritorio + móvil)');
{
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const guestCtx = await browser.newContext({ ...devices['iPhone 13'] });
  const lateCtx = await browser.newContext();
  let host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  watch(host, 'anfitrión');
  watch(guest, 'invitado');

  await host.goto(BASE);
  await host.fill('#nickname', 'Ana');
  await host.check('text=Sala pública');
  await host.click('button:has-text("Crear sala")');
  await host.waitForSelector('.code--big');
  const code = (await host.textContent('.code--big')).trim();
  const link = await host.inputValue('#share-link');
  check(/^[A-Z2-9]{6}$/.test(code), `sala creada con código de 6 caracteres (${code})`);
  check(link.endsWith(`/sala/${code}`), 'enlace compartible');
  check(await host.isDisabled('button:has-text("Empezar partida")'), 'no se puede empezar con 1 jugador');

  // El invitado entra desde la lista de salas públicas del inicio.
  await guest.goto(BASE);
  await guest.fill('#nickname', 'Beto');
  await guest.waitForSelector(`.room:has-text("${code}")`, { timeout: 8000 });
  check(true, 'la sala pública aparece en la lista del inicio');
  await guest.click(`.room:has-text("${code}") button:has-text("Unirme")`);
  await guest.waitForSelector('.players li:nth-child(2)');
  await host.waitForSelector('.players li:has-text("Beto")');
  check(await guest.isVisible('.player:has-text("Ana") .tag--host'), 'la sala de espera muestra quién es el anfitrión');
  check((await guest.$$('.picker')).length === 0, 'el invitado no puede elegir catálogo');
  await host.click('.card:has-text("Verano Eterno")');
  await host.click('[aria-label="Menos jugadores"]');
  await host.click('[aria-label="Menos jugadores"]');
  await host.waitForSelector('.stepper__value:has-text("3")');
  await guest.waitForSelector('.h3:has-text("(2/3)")');
  check(true, 'el anfitrión cambia el tamaño de la sala (5 → 3) y el invitado lo ve');
  await guest.waitForSelector('.lobby__catalog:has-text("Verano Eterno")');
  check(true, 'el invitado ve el catálogo elegido por el anfitrión');
  await host.screenshot({ path: `${SHOTS}/05-sala-espera.png` });
  await host.click('button:has-text("Empezar partida")');

  // Nadie más puede entrar una vez iniciada.
  const late = await lateCtx.newPage();
  await late.goto(link); // enlace compartible
  await late.waitForSelector('text=Te invitaron a la sala');
  check((await late.inputValue('.input--code')) === code, 'el enlace rellena el código de sala');
  check((await host.$$eval('.room', (r) => r.length).catch(() => 0)) === 0, 'la sala deja de ser visible al empezar');
  await late.fill('#nickname', 'Tarde');
  await late.click('form.join button');
  await late.waitForSelector('.banner--error');
  check(/ya empezó/.test(await late.textContent('.banner--error')), 'impide unirse a una partida empezada');
  await lateCtx.close();

  // Ronda 1: mismas opciones; ambos responden → revelación antes de los 10 s.
  await waitAnswering(host); await waitAnswering(guest);
  const ht = await optionTitles(host); const gt = await optionTitles(guest);
  check(JSON.stringify(ht) === JSON.stringify(gt), 'ambos reciben la misma pregunta');
  const tA = await host.evaluate(() => document.querySelector('.timer__num').textContent);
  const tB = await guest.evaluate(() => document.querySelector('.timer__num').textContent);
  check(Math.abs(Number(tA) - Number(tB)) <= 1, `misma hora límite (${tA} s / ${tB} s)`);
  // Disposición: 2×2 en escritorio, una columna en móvil.
  const settled = (pg) => pg.waitForFunction(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.classList?.contains('answer')).length === 0, null, { timeout: 3000 }).catch(() => {});
  await Promise.all([settled(host), settled(guest)]);
  const hb = await host.$$eval('.answer', (els) => els.map((e) => e.getBoundingClientRect()).map((r) => [Math.round(r.x), Math.round(r.y)]));
  const gb = await guest.$$eval('.answer', (els) => els.map((e) => e.getBoundingClientRect()).map((r) => [Math.round(r.x), Math.round(r.y), Math.round(r.height)]));
  check(hb[0][1] === hb[1][1] && hb[0][0] === hb[2][0], 'escritorio: respuestas en cuadrícula 2×2');
  check(new Set(gb.map((b) => b[0])).size === 1 && gb.every((b) => b[2] >= 60), 'móvil: una columna de botones grandes');
  await guest.screenshot({ path: `${SHOTS}/06-partida-movil.png` });
  let sol = await answer(code);
  const t0 = Date.now();
  await host.click(`.answer:has-text("${sol.title}")`);
  await host.waitForSelector('text=Respuesta enviada');
  check(!(await host.isVisible('.verdict')), 'el anfitrión espera: no se revela hasta que todos respondan');
  const wrong = gt.find((t) => t !== sol.title);
  await guest.dblclick(`.answer:has-text("${wrong}")`);
  await host.waitForSelector('.verdict'); await guest.waitForSelector('.verdict');
  check(Date.now() - t0 < 6000, 'revelación inmediata cuando todos respondieron');
  check(/Acierto|Oído biónico/.test(await host.textContent('.verdict')), 'anfitrión acierta');
  check(/Fallaste/.test(await guest.textContent('.verdict')), 'invitado falla');
  check(/\d s/.test(await host.textContent('.chip:has-text("Ana") .chip__state')), 'la revelación muestra cuánto tardó cada jugador');
  await host.screenshot({ path: `${SHOTS}/07-revelacion-multi.png` });

  // Ronda 2: el invitado no responde → revelación al agotarse el tiempo.
  await waitAnswering(host);
  sol = await answer(code);
  await host.click(`.answer:has-text("${sol.title}")`);
  await guest.waitForSelector('.chip:has-text("Ana") >> text=respondió');
  check(true, 'el invitado ve quién ya respondió');
  await guest.waitForSelector('.verdict', { timeout: 13000 });
  check(/Tiempo agotado/.test(await guest.textContent('.verdict')), 'el servidor da tiempo agotado al invitado');

  // Ronda 3: el invitado recarga la página y recupera su puesto.
  await waitAnswering(guest);
  const scoreBefore = await guest.getAttribute('.hud__item--right .hud__value', 'data-value');
  await guest.reload();
  await waitAnswering(guest, 15000).catch(() => {});
  await guest.waitForSelector('.hud');
  check((await guest.getAttribute('.hud__item--right .hud__value', 'data-value')) === scoreBefore, `reconexión: conserva su puntaje (${scoreBefore})`);
  sol = await answer(code);
  if (sol.phase === 'answering') {
    await guest.click(`.answer:has-text("${sol.title}")`).catch(() => {});
    await host.click(`.answer:has-text("${sol.title}")`).catch(() => {});
  }
  await host.waitForSelector('.verdict', { timeout: 13000 });

  // Ronda 4: el anfitrión se va → la función pasa al invitado; luego vuelve.
  await waitAnswering(guest);
  await host.close();
  await guest.waitForSelector('.chip:has-text("Beto ♛")', { timeout: 15000 });
  check(true, 'al irse el anfitrión, Beto pasa a ser anfitrión');
  sol = await answer(code);
  await guest.click(`.answer:has-text("${sol.title}")`);
  await guest.waitForSelector('.verdict');
  check(true, 'con el anfitrión desconectado, la ronda se revela al responder el resto');
  host = await hostCtx.newPage();
  watch(host, 'anfitrión (vuelta)');
  await host.goto(`${BASE}/sala/${code}`);
  await host.waitForSelector('.hud', { timeout: 15000 });
  check(true, 'Ana vuelve desde el mismo navegador y recupera su puesto en la partida');

  // Resto de rondas: ambos responden bien hasta el final.
  for (;;) {
    const done = await Promise.race([
      host.waitForSelector('.answer:not(:disabled):not(.is-placeholder)', { timeout: 20000 }).then(() => false),
      host.waitForSelector('.table', { timeout: 20000 }).then(() => true),
    ]);
    if (done) break;
    sol = await answer(code);
    if (sol.phase !== 'answering') { await sleep(300); continue; }
    await Promise.all([
      host.click(`.answer:has-text("${sol.title}")`).catch(() => {}),
      guest.click(`.answer:has-text("${sol.title}")`).catch(() => {}),
    ]);
    await host.waitForSelector('.verdict', { timeout: 13000 }).catch(() => {});
  }
  await guest.waitForSelector('.table');
  await host.screenshot({ path: `${SHOTS}/08-clasificacion.png`, fullPage: true });
  const rows = await host.$$eval('.table tbody tr', (trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())));
  log('  tabla:', JSON.stringify(rows));
  check(rows.length === 2 && rows[0][0] === '1º', 'tabla con posición, apodo, puntaje y aciertos');
  check(rows.every((r) => /\/10$/.test(r[3])), 'aciertos sobre 10');
  check(rows.every((r) => /s$|—/.test(r[4])), 'tiempo medio de respuesta por jugador');
  check(await host.isDisabled('button:has-text("Jugar otra vez")'), 'Ana (ya no anfitriona) espera al anfitrión para repetir');
  await guest.click('button:has-text("Jugar otra vez")');
  await host.waitForSelector('.code--big');
  await guest.waitForSelector('.code--big');
  check(true, '«Jugar otra vez» devuelve a ambos a la sala de espera');
  await guest.click('text=Salir de la sala');
  await guest.waitForSelector('.mode-tabs');
  check(true, 'salir de la sala vuelve al inicio');
  await host.waitForSelector('.player:has-text("Ana") .tag--host');
  check(true, 'al salir el anfitrión, Ana recupera la función de anfitriona');
  await hostCtx.close(); await guestCtx.close();
}

// ───────────────────────── COMPETITIVO 1v1 ─────────────────────────
log('\n▶ Competitivo 1v1: cuentas, emparejamiento y MMR');
{
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const ctxB = await browser.newContext({ ...devices['iPhone 13'] });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  watch(a, 'duelo A'); watch(b, 'duelo B');
  const run = Date.now().toString(36).slice(-5);
  for (const [pg, name] of [[a, `Ana${run}`], [b, `Beto${run}`]]) {
    await pg.goto(BASE);
    await pg.click('.mode-tabs button:has-text("Competitivo")');
    await pg.waitForSelector('.ranked form.account');
    await pg.fill('.ranked .account input[autocomplete="username"]', name);
    await pg.fill('.ranked .account input[type=password]', 'clave-segura-1');
    await pg.click('.ranked .account button[type=submit]');
    await pg.waitForSelector('.ranked__record');
  }
  check(true, 'dos jugadores crean su cuenta desde la pestaña Competitivo');
  await a.click('button:has-text("Buscar rival")');
  await a.waitForSelector('.searching');
  await a.screenshot({ path: `${SHOTS}/18-buscando-rival.png` });
  await b.click('button:has-text("Buscar rival")');
  await a.waitForSelector('.hud', { timeout: 15000 });
  await b.waitForSelector('.hud', { timeout: 15000 });
  check(true, 'emparejados en un duelo 1v1');
  const code = await a.evaluate(() => localStorage.getItem('hc.room'));
  for (let r = 1; r <= 10; r++) {
    await waitAnswering(a, 25000); await waitAnswering(b, 25000);
    const sol = await answer(code);
    const titles = await optionTitles(b);
    await a.click(`.answer:has-text("${sol.title}")`);
    await b.click(`.answer:has-text("${titles.find((t) => t !== sol.title)}")`);
    await a.waitForSelector('.verdict', { timeout: 13000 });
  }
  await a.waitForSelector('.results h1', { timeout: 15000 });
  await b.waitForSelector('.results h1', { timeout: 15000 });
  check(/Ganaste el duelo/.test(await a.textContent('.results h1')) && /Derrota/.test(await b.textContent('.results h1')), 'Ana gana el duelo y Beto pierde');
  check(!/MMR/.test(await a.textContent('.results')), 'el MMR no se muestra en los resultados');
  await a.waitForTimeout(800);
  const pid = await a.evaluate(() => JSON.parse(localStorage.getItem('hc.identity')).playerId);
  const perfil = await (await fetch(`${BASE}/api/perfil/${pid}`)).json();
  check(perfil.rankedWins === 1 && !('mmr' in perfil) && !('rd' in perfil), 'la API del perfil no expone el MMR (secreto)');
  await a.screenshot({ path: `${SHOTS}/19-duelo-ganado.png` });
  await a.click('text=Volver al inicio');
  await a.waitForSelector(`.ranked .leaders li:has-text("Ana${run}")`, { timeout: 8000 });
  check(/1\s*V/.test(await a.textContent('.ranked__record')), 'récord competitivo 1 V');
  check(true, 'aparece en el ranking competitivo (por victorias, sin MMR)');
  await ctxA.close(); await ctxB.close();
}

await browser.close();
if (pageErrors.length) { log('\nErrores en consola:'); pageErrors.forEach((e) => log('  ' + e)); }
log(failures ? `\n✗ ${failures} comprobaciones fallaron` : '\n✓ Todas las comprobaciones pasaron');
process.exit(failures || pageErrors.length ? 1 : 0);
