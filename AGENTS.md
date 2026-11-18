# AGENTS.md — guía para agentes de código (Claude Code, Codex, Antigravity, Cursor…)

Este archivo es la fuente única de instrucciones para cualquier agente o persona que trabaje en el repo.
`CLAUDE.md` y `GEMINI.md` solo apuntan aquí.

## Qué es
Humboldtclash: juego web de adivinar canciones (fragmentos de Deezer), en español. Solo, salas con amigos y competitivo 1v1 con MMR.

## Pila
- Cliente: React 18 + TypeScript + Vite (`client/`)
- Servidor: Node 22 + Express + Socket.IO (`server/src/`)
- Tipos y reglas compartidas: `shared/types.ts` (puntos, rangos, ajustes) — **cámbialas aquí, no dupliques**
- Datos: Postgres si hay `DATABASE_URL`; si no, `data/humboldtclash.json` (`server/src/store.ts`)

## Comandos
```bash
npm install
npm run dev            # cliente (5173) + servidor (3000) con recarga
npm run typecheck      # obligatorio antes de abrir un PR
npm test               # pruebas unitarias (vitest)
npm run build          # compila cliente y servidor
```
Prueba E2E (navegador real, Deezer simulado): ver «Pruebas» en `README.md`.
Con Postgres local: `PG_TEST_URL=postgres://… npm test` también prueba la base de datos.

## Mapa del código
| Archivo | Qué hace |
| --- | --- |
| `server/src/game.ts` | Motor: salas, rondas, temporizador, puntos, reconexión, competitivo |
| `server/src/matchmaking.ts` | Cola 1v1 por rango y MMR |
| `server/src/glicko.ts` | MMR Glicko-2 |
| `server/src/library.ts` / `deezer.ts` | Catálogos: Deezer, playlists de usuarios, canciones propias |
| `server/src/store.ts` | Persistencia (JSON o Postgres) — si añades columnas, usa `ALTER TABLE … ADD COLUMN IF NOT EXISTS` |
| `server/src/accounts.ts` | Cuentas (scrypt) |
| `client/src/screens/*` | Pantallas; `client/src/styles.css` tokens de diseño (claro/oscuro) |

## Reglas del proyecto
1. **Juego limpio**: el servidor decide tiempos y puntos. Nunca envíes al cliente la respuesta correcta ni URLs que revelen la canción antes de la revelación.
2. **Música**: solo Deezer (vistas previas de 30 s) o archivos con licencia. **No uses la API de Spotify**: su política prohíbe juegos y trivia.
3. Textos de la interfaz en **español**. Accesible: teclado, `aria-*`, contraste en ambos temas.
4. Animaciones: `ease-out` (`var(--smooth)`), menos de 300 ms en la interfaz, nunca desde `scale(0)`, `:hover` solo con `@media (hover: hover)`.
5. Cada cambio de lógica lleva su prueba en `tests/`. No rompas `npm run typecheck` ni `npm test`.
6. No subas secretos (`.env`, claves). Variables de entorno documentadas en `README.md`.
7. Trabaja en una rama (`feat/…`, `fix/…`) y abre un Pull Request; `main` se publica sola en Render.

## Skills útiles (Claude Code)
Si están instaladas: `frontend-design`, `impeccable`, `emil-design-eng`, `animate`, `accessibility`, `webapp-testing`, `playwright-best-practices`, `security-and-hardening`.
