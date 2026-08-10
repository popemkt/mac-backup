# kb ui — browser outliner

Vite+ (`vite-plus@0.2.8`) + React 19 + Tailwind 4 + Zustand + DataScript.

```bash
cd tools/kb/ui
npm install   # or: vp install
npm run dev   # proxies /api and /ws → 127.0.0.1:4321 (or $KB_UI_API_PORT)
npm test
npm run build
```

`kb ui` (repo root) auto-builds this package into gitignored `ui/dist` when it
is missing or stale (source fingerprint vs `dist/.kb-build-hash`); `kb ui --dev`
spawns `vp dev` here with `KB_UI_API_PORT` set to the backend port. The Vite
server port is `KB_UI_DEV_PORT` (default 5173) and the proxy target is
`KB_UI_API_PORT` (default 4321).

Force fixtures (no server): `VITE_USE_FIXTURES=1 npm run dev`

U3: optimistic mutations (`src/actions/mutations.ts`), props/tags editors,
`[[ref]]` autocomplete, backlinks. U4 wires `src/api/ws.ts` onto
`outlineStore.applyTx`.
