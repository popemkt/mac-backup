# kb ui — browser outliner (U2 read-only shell)

Vite+ (`vite-plus@0.2.8`) + React 19 + Tailwind 4 + Zustand + DataScript.

```bash
cd tools/kb/ui
npm install   # or: vp install
npm run dev   # proxies /api and /ws → 127.0.0.1:4321
npm test
npm run build
```

Force fixtures (no server): `VITE_USE_FIXTURES=1 npm run dev`

U3 wires `src/actions/mutations.ts`. U4 wires `src/api/ws.ts`.
