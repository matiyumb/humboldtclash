# Estado del proyecto (para retomar en un chat nuevo)

Última actualización: 18-11-2026. Lee también `AGENTS.md` (reglas) y `README.md` (cómo arrancar y probar).

## Hecho
- Juego completo: solo (práctica), salas 2–10 (privadas/públicas), competitivo 1v1 con MMR Glicko-2 **secreto**.
- Música: Deezer (artistas tendencia de la semana, playlists oficiales, enlace de playlist, importar lista texto/CSV de Exportify).
- Ajustes: 5–20 canciones, dificultad (general/mainstream/fan/nicho), fragmento 1–5 s o completo, instrumental, orden aleatorio.
- Puntos 0–10 por canción; easter egg «oído biónico» (≤ 0,4 s); rangos por victorias multijugador (Rookie 50, Conocedor 100, Fan 500, Melófano 5000).
- Cuentas (usuario + contraseña), perfiles, ranking, playlists propias, modo oscuro, volumen, sonidos, emblema propio (sin logo del colegio).
- Huecos de anuncios reservados (apagados, `ADS=1`). CI en GitHub Actions. Publicado en Render desde `main`.

## Pendiente
1. **Conectar Postgres (Neon) en Render** como `DATABASE_URL` — sin ella se borran cuentas/puntos en cada despliegue.
2. **Probar con Deezer real** en la web publicada (en el entorno de desarrollo de Claude, Deezer está bloqueado y se usó un Deezer simulado).
3. **SoundCloud** como fuente extra: requiere suscripción Artist Pro para obtener claves de API.
4. Valorar quitar el logo del colegio del historial antiguo de git (necesita reescribir historial).
5. Proteger la rama `main` en GitHub (PR + CI obligatorios) y añadir colaboradores.

## Decisiones (no repetir la discusión)
- **Spotify no**: su política prohíbe juegos/trivia y ya no da fragmentos ni playlists oficiales a apps nuevas.
- **Firebase no**: el servidor propio valida tiempos y puntos (anti-trampas).
- **MMR secreto**: solo para emparejar; nunca en la web ni en la API.
- El modo solo es práctica: no suma victorias ni se guarda.

## Skills
Las skills de diseño, animación, accesibilidad y pruebas están en `.claude/skills/` y se cargan solas en Claude Code.
