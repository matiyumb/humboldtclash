# Humboldtclash 🎵

Trivia musical: suena un fragmento de 10 segundos y eliges el título correcto entre 4 opciones.
Se juega solo o en salas privadas de 2 a 5 amigos, en el móvil o en el ordenador.

- **Cliente:** React + TypeScript (Vite)
- **Servidor:** Node.js + Express + Socket.IO (sincroniza las salas y valida respuestas y puntos)
- **Música real vía Deezer:** cualquier artista se busca desde el juego (Quevedo, Bad Bunny, Omar Courtz…). El servidor usa la API pública de Deezer y reproduce las **vistas previas oficiales de 30 s** como proxy, con identificadores opacos. No hace falta clave.
- **Salas:** privadas (con código o enlace) o **públicas** (aparecen en la lista del inicio)
- **Catálogo de prueba:** 41 pistas originales (CC0) en `tests/fixtures`, solo para las pruebas automáticas

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

## Guardar puntos, rangos y playlists (base de datos)

Sin base de datos, los puntos y playlists se guardan en un archivo que **Render gratis borra en cada despliegue**.
Para que duren para siempre, conecta un Postgres gratis de **Neon**:

1. Entra en **neon.tech** → *Sign up* (puedes usar GitHub) → crea un proyecto.
2. Copia la **connection string** (empieza por `postgres://…`).
3. En Render → tu servicio → **Environment** → añade `DATABASE_URL` con ese valor → *Save*.

Las tablas se crean solas al arrancar. En `/api/health`, el campo `store` dice `postgres` cuando todo está bien.

## Competitivo 1v1 y cuentas

- **Cuenta:** usuario y contraseña (guardada con scrypt). Al crearla, el progreso del navegador pasa a la cuenta y puedes entrar desde cualquier dispositivo.
- **Competitivo:** solo para cuentas registradas. Son duelos 1v1 de 10 canciones de «Éxitos del momento».
  - El emparejamiento busca tu **mismo rango** y un **MMR parecido** (±100).
  - El margen crece con la espera (+15 por segundo). A los 20 s acepta rangos vecinos y a los 45 s cualquiera.
- **MMR secreto:** usa **Glicko-2** y **nunca se muestra** (ni en la web ni en la API). Solo sirve para emparejar con justicia.
  - Ganar a alguien mejor sube más tu nivel, y los jugadores nuevos se mueven más rápido durante las primeras partidas (calibración).
  - Lo que sí ves es tu récord competitivo (victorias, empates y derrotas) y tu rango. Un empate no es victoria ni derrota. Abandonar cuenta como derrota.
- **Rangos:** Rookie, Conocedor, Fan y Melófano. **Solo cuentan las victorias multijugador** (salas y competitivo); el modo solo es práctica.

## Publicidad (para el futuro)

La página ya reserva huecos para anuncios en la barra lateral y entre secciones, pero están **apagados** y no ocupan espacio.
Para activarlos, arranca con `ADS=1` (y opcionalmente `ADS_CLIENT=<id del proveedor>`), y pega el código del proveedor en `client/src/screens/AdSlot.tsx`.

## Variables de entorno

| Variable | Para qué |
| --- | --- |
| `PORT` | Puerto (Render lo pone solo) |
| `DATABASE_URL` | Postgres para guardar puntos, rangos, MMR, cuentas y playlists |
| `DEEZER=off` | Desactiva Deezer |
| `LASTFM_API_KEY` | Opcional. Usa los oyentes de Last.fm para repartir la dificultad (si no está, se usa la popularidad de Deezer) |
| `ADS=1`, `ADS_CLIENT` | Activa los huecos de publicidad |
| `CATALOG_DIR` | Carpeta con `catalog/` y `audio/` para canciones propias |

## ¿Por qué Deezer y no Spotify?

La política para desarrolladores de Spotify **prohíbe crear juegos y trivia** con su contenido.
Además, desde noviembre de 2024 ya no da los fragmentos de 30 s ni las playlists oficiales a las apps nuevas.
Por eso las playlists de Spotify se traen **importando la lista**: se exporta con Exportify o TuneMyMusic y se pega en «Mis playlists».

## Cómo se juega

1. Escribe tu apodo (juegas como invitado, sin cuenta).
2. **Jugar solo:** elige un artista o una colección. Se comprueba que tenga al menos 10 canciones distintas con audio, y luego pulsas «Empezar partida».
3. **Crear sala:** compartes el código de 6 caracteres o el enlace. El anfitrión elige el catálogo y empieza la partida.
   El anfitrión puede **expulsar** a un jugador (en salas públicas o privadas); quien es expulsado no puede volver a esa sala.
   Las salas tienen **chat** (en la sala de espera, en la partida y en los resultados). Lo que escribes mientras suena una canción no lo ven los demás hasta la revelación, para que nadie chive la respuesta. Máximo 200 caracteres y 5 mensajes cada 5 s.
4. Eliges de **5 a 20 canciones** por partida, la **duración del fragmento** (1 a 5 s, o completo), el modo **solo instrumental** (quita la voz), el **tamaño de la sala** (2 a 10), la **dificultad** (General, Mainstream, Fan o Nicho, según los oyentes en Last.fm si hay `LASTFM_API_KEY`, o la popularidad en Deezer si no) y si quieres el **modo 1 segundo**.
   Cada fragmento empieza en un punto al azar de la canción (el mismo para toda la sala).
   Una canción que ya sonó **no vuelve a salir**, ni como pregunta ni como opción falsa (solo si el catálogo es tan pequeño que no queda otra). Con «Jugar otra vez» salen primero las canciones que aún no han sonado en la sala.
5. Cada canción vale de **0 a 10 puntos**: un fallo o el tiempo agotado valen 0. Un acierto vale `5 + 1 punto por cada 2 segundos que queden`, con un máximo de 10. ⚡ Si aciertas en menos de 0,4 s, ganas la insignia «Oído biónico».
6. **Rangos por victorias multijugador:** Rookie (50, bronce), Conocedor (100, plata), Fan (500, oro) y Melófano (5000, realeza).
   Solo gana **el 1.º en solitario** de cada partida. Un **empate** en el primer puesto no cuenta como victoria ni como derrota para nadie. El modo solo es práctica y no suma.
7. **Mis playlists:** mezcla canciones de varios artistas, rellénalas al azar («🎲 5 al azar») y bárajalas.
8. En el ordenador, las teclas **1–4** eligen la respuesta.

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
   npm run build && CATALOG_DIR=tests/fixtures DEEZER_API_BASE=http://127.0.0.1:4100 HUMBOLDTCLASH_TEST=1 PORT=3100 npm start
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
