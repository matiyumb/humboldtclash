# Guía para añadir canciones

## Opción A: Deezer (artistas reales, sin descargar nada)

Desde el juego se puede **buscar cualquier artista** en el buscador del inicio, de la configuración o de la sala.
Cada artista trae sus canciones más escuchadas (hasta 100) con la vista previa oficial de 30 segundos.
Tiene que tener al menos 10 canciones distintas con vista previa para poder jugarse.

**Cambiar los destacados del inicio:** edita `catalog/destacados.json`:

```json
{
  "exitos": true,
  "artistas": ["Bad Bunny", "Quevedo", "Omar Courtz", "Feid"],
  "playlists": [{ "nombre": "Reggaetón clásico", "id": 1234567890 }]
}
```

- `exitos`: muestra la tarjeta «Éxitos del momento» (lista de éxitos de Deezer).
- `artistas`: nombres tal como salen en Deezer.
- `playlists`: cualquier playlist pública de Deezer. El `id` es el número que aparece en el enlace, por ejemplo `deezer.com/playlist/1234567890`.

Reinicia el servidor después de cambiarlo (los destacados se guardan en caché 6 horas).

> Las vistas previas son de Deezer. El juego enlaza siempre a la canción en Deezer al revelarla, y es para uso no comercial entre amigos.
> Si algún día quieres cobrar o publicarlo a lo grande, revisa antes los términos de la API de Deezer.

## Opción B: archivos propios

Cada canción son **dos cosas**:

1. un archivo de audio en la carpeta `audio/`, y
2. una entrada en `catalog/catalog.json`.

## 1. Prepara el audio

- **Formatos:** `.mp3` (recomendado), `.ogg`, `.m4a`, `.wav` o `.webm`.
- **Qué parte suena:** el juego reproduce los **primeros 10 segundos** del archivo, así que recórtalo para que empiece en la parte reconocible.
- **Metadatos:** quítalos para que el archivo no delate el título.

Con ffmpeg puedes hacer las dos cosas a la vez. Este ejemplo empieza en el 0:45 y guarda 15 segundos:

```bash
ffmpeg -ss 45 -t 15 -i original.mp3 -map_metadata -1 -id3v2_version 0 -write_id3v1 0 -ac 2 -b:a 128k audio/mi-artista--mi-cancion.mp3
```

## 2. Añade la entrada al catálogo

En `catalog/catalog.json`, dentro de la lista `"tracks"`:

```json
{
  "id": "mi-artista--mi-cancion",
  "title": "Mi Canción",
  "artist": "Mi Artista",
  "collection": "Noche de Barrio",
  "file": "mi-artista--mi-cancion.mp3",
  "origin": "Jamendo – https://www.jamendo.com/track/123456 (autor: Nombre Apellido)",
  "license": "CC-BY-4.0",
  "licenseUrl": "https://creativecommons.org/licenses/by/4.0/"
}
```

| Campo | Para qué sirve |
| --- | --- |
| `id` | Identificador interno único. Nunca se muestra a los jugadores. |
| `title` | El título que aparece como opción de respuesta. |
| `artist` | Cada artista distinto crea su propia tarjeta en la pantalla de inicio. |
| `collection` | Cada colección distinta también crea su tarjeta. Puedes inventar colecciones como «Clásicos de los 90» o «Reggaetón 2020». |
| `file` | Nombre del archivo dentro de `audio/`. |
| `origin` | De dónde sale la pista: URL y autor. |
| `license` | La licencia: `CC0-1.0`, `CC-BY-4.0`, «Permiso del autor», etc. |
| `licenseUrl` | Opcional: enlace al texto de la licencia. |

## 3. Comprueba y reinicia

```bash
npm run check-catalog
```

Te dice qué archivos faltan o no son audio válido, y cuántas canciones tiene cada artista y cada colección.
**Un artista o una colección necesita al menos 10 canciones distintas para poder jugarse.** Si tiene menos, aparece como «faltan pistas».

Después **reinicia el servidor** (`npm start`, o `npm run dev` en desarrollo) para que cargue el catálogo nuevo.

## ¿De dónde sacar música que se pueda usar?

Solo usa pistas **propias**, **de dominio público** o **con una licencia que permita usarlas en la web**:

- **Jamendo** (jamendo.com): mucha música latina con licencias Creative Commons.
- **Free Music Archive** (freemusicarchive.org): se puede filtrar por licencia y por género.
- **Internet Archive** (archive.org): sellos independientes («netlabels») y grabaciones antiguas de dominio público.
- **ccMixter** (ccmixter.org).
- Música tuya o de amigos, con su permiso.

Sobre las licencias:
- **CC-BY:** obliga a citar al autor. Para eso están los campos `origin` y `license`.
- **«NC» (no comercial):** permite jugar entre amigos sin cobrar.
- **«ND» (sin derivadas):** evítala si vas a recortar el archivo.

Las canciones comerciales famosas tienen derechos de autor. No subas sus MP3 si no tienes permiso.

## Generar más pistas de demostración

Las pistas de demo se generan con `scripts/generate-audio.ts`. Para crear más:

1. Añade al catálogo una entrada con `"generator": { "style": "pop" | "cumbia" | "bolero" | "synth", "seed": <número> }`.
2. Ejecuta el generador:

   ```bash
   npm run generate-audio
   ```

   Para regenerar todas las pistas, añade `-- --force` al final.
