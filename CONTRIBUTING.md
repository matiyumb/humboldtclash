# Cómo colaborar

¡Gracias por ayudar! Da igual si programas tú o con un agente (Claude Code, Codex, Antigravity…): el flujo es el mismo.

## 1. Acceso
El dueño del repo te invita en GitHub: **Settings → Collaborators → Add people**.
(Si prefieres no dar acceso, haz un *fork* y abre el PR desde tu copia.)

## 2. Flujo de trabajo
```bash
git clone https://github.com/matiyumb/humboldtclash
cd humboldtclash
npm install
git checkout -b feat/mi-mejora
npm run dev
```
1. Haz cambios pequeños y con un objetivo claro.
2. Antes de subir: `npm run typecheck && npm test`.
3. `git push -u origin feat/mi-mejora` y abre un **Pull Request** hacia `main`.
4. La CI (GitHub Actions) comprueba tipos, pruebas (con Postgres) y compilación.
5. Otra persona revisa y aprueba. Al fusionar en `main`, Render publica solo.

## 3. Si usas un agente
- **Claude Code** lee `CLAUDE.md` → `AGENTS.md` automáticamente.
- **Codex** lee `AGENTS.md`.
- **Antigravity / Gemini** lee `GEMINI.md` → `AGENTS.md`.
- **En GitHub**: escribe `@claude` (o `@codex`) en un issue o en un comentario de un PR y el agente responde, revisa o propone cambios.
  `@claude` usa `.github/workflows/claude.yml`; `@codex` usa la app «ChatGPT Codex Connector».
- Pide al agente que trabaje en una rama, que añada pruebas y que **no** toque `main` directamente.
- Revisa siempre el diff antes de aprobar el PR: el agente puede equivocarse.

## 4. Reglas rápidas
- Textos en español; reglas del juego en `shared/types.ts`.
- Nada de secretos en el código. Nada de la API de Spotify (su política prohíbe juegos).
- Una función nueva = una prueba nueva.
