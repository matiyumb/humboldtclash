# Humboldtclash 🎵

Trivia musical: suena un fragmento de 10 segundos y eliges el título correcto entre 4 opciones.
Se juega solo o en salas privadas de 2 a 5 amigos, en el móvil o en el ordenador.

- **Cliente:** React + TypeScript (Vite)
- **Servidor:** Node.js + Express + Socket.IO (sincroniza las salas y valida respuestas y puntos)
- **Música real vía Deezer:** cualquier artista se busca desde el juego (Quevedo, Bad Bunny, Omar Courtz…). El servidor usa la API pública de Deezer y reproduce las **vistas previas oficiales de 30 s** como proxy, con identificadores opacos. No hace falta clave.
- **Salas:** privadas (con código o enlace) o **públicas** (aparecen en la lista del inicio)
- **Catálogo de demo sin conexión:** 41 pistas originales generadas por código (licencia CC0)

### API propia (sobre la de Deezer)

| Endpoint | Qué hace |
| --- | --- |
| `GET /api/catalogs` | Devuelve los destacados de Deezer (de `catalog/destacados.json`) y el catálogo local. |
| `GET /api/deezer/artistas?q=quevedo` | Busca artistas en Deezer. |
| `GET /api/catalogs/:id/check` | Comprueba si un catálogo tiene ≥10 canciones distintas con audio. El id puede ser `deezer:artist:<id>`, `deezer:playlist:<id>`, `deezer:chart` o uno local. |
| `GET /api/salas-publicas` | Lista las salas públicas en espera que tienen hueco. |
| `GET /api/audio/<token>` | Sirve el audio de la ronda sin revelar la canción. Si Deezer caducó la URL, pide una nueva y reintenta. |

Las respuestas de Deezer se guardan en caché unos minutos para no superar su límite de peticiones.
Para desactivar Deezer, arranca con `DEEZER=off npm start`.

## Requisitos

- Node.js 18.18 o superior (probado con Node 22)
- ffmpeg, solo si quieres volver a generar las pistas de demo (`npm run generate-audio`)

## Arrancar

```bash
npm install
```

**Modo desarrollo** (recarga automática). Abre http://localhost:5173

```bash
npm run dev
```

**Modo producción** (un solo proceso que sirve la web y el juego). Abre http://localhost:3000

```bash
npm run build
```

```bash
npm start
```

Para cambiar el puerto, usa `PORT=8080 npm start`.

### Jugar con amigos

- **En la misma red WiFi:** arranca con `npm start` y comparte `http://IP-DE-TU-PC:3000`
  (en Windows la ves con `ipconfig` y en Mac/Linux con `ip addr` o `ifconfig`).
  Los demás abren el enlace de la sala desde su móvil.
- **Por internet:** sube el proyecto a cualquier servicio que ejecute Node con WebSockets (Render, Railway, Fly.io, un VPS…).
  - Comando de build: `npm install && npm run build`
  - Comando de inicio: `npm start`
  - El servicio pone el `PORT` solo.

  Las salas se guardan en memoria, así que usa **una sola instancia**. Si el servidor se reinicia, las salas abiertas se pierden.

## Cómo se juega

1. Escribe tu apodo (juegas como invitado, sin cuenta).
2. **Jugar solo:** elige un artista o una colección. Se comprueba que tenga al menos 10 canciones distintas con audio, y luego pulsas «Empezar partida».
3. **Crear sala:** compartes el código de 6 caracteres o el enlace. El anfitrión elige el catálogo y empieza la partida.
4. Hay 10 rondas de 10 segundos. Un acierto vale `500 + 50 × segundos completos restantes`, con un máximo de 1000. Un error o el tiempo agotado valen 0.
5. En el ordenador, las teclas **1–4** eligen la respuesta.

## Estructura

```
catalog/catalog.json   Catálogo: título, artista, colección, archivo, origen y licencia de cada pista
audio/                 Archivos de audio (los sirve el servidor con identificadores opacos)
server/src/catalog.ts  Carga y valida el catálogo (≥10 canciones distintas reproducibles)
server/src/game.ts     Motor: salas, rondas, temporizador, puntos, reconexión, anfitrión
server/src/index.ts    HTTP + Socket.IO
client/src/            Interfaz React (pantallas en client/src/screens)
shared/types.ts        Tipos y fórmula de puntuación compartidos
scripts/               Generador de pistas de demo y verificador del catálogo
tests/                 Pruebas del motor (vitest) y prueba de extremo a extremo (Playwright)
```

## Pruebas

**Pruebas del motor:** puntos, empates, duplicados, plazo, reconexión y sustitución de audio.

```bash
npm test
```

**Prueba de extremo a extremo:** una partida en solitario y una multijugador en dos ventanas, en un navegador real.
Necesita Playwright con Chromium instalado.

1. Arranca un Deezer falso local (así la prueba no depende de internet):

   ```bash
   node tests/fake-deezer.mjs 4100
   ```

2. Arranca el servidor en modo de prueba. Este modo expone las respuestas, así que **nunca lo uses en producción**.

   ```bash
   npm run build && DEEZER_API_BASE=http://127.0.0.1:4100 HUMBOLDTCLASH_TEST=1 PORT=3100 npm start
   ```

3. En otra terminal, lanza la prueba:

   ```bash
   BASE=http://localhost:3100 npm run e2e
   ```

## Juego limpio

- Las opciones solo llegan al navegador cuando arranca el temporizador.
- El audio se pide con un identificador aleatorio por pregunta (`/api/audio/<token>`), sin nombre de archivo ni metadatos.
- La respuesta correcta nunca se envía antes de la revelación.
- El servidor decide si una respuesta llegó a tiempo y calcula los puntos. Además, acepta una sola respuesta por jugador y ronda.

## Añadir canciones

Mira **[GUIA-CANCIONES.md](GUIA-CANCIONES.md)**.
