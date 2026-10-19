# chassis-web-ui

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
pnpm install
```

### Compile and Hot-Reload for Development

```sh
pnpm dev
```

### Type-Check, Compile and Minify for Production

```sh
pnpm build
```

## Mock and real data

The project supports both local Mock data and a real data service. The default
mode is `mock`, so the current demo remains available while the real interface
is being developed.

1. Copy `.env.example` to `.env.local`.
2. Keep `VITE_DATA_SOURCE=mock` to run the current Mock flow.
3. Set `VITE_DATA_SOURCE=real` and configure the HTTP and WebSocket URLs to
   switch to the real flow.
4. Restart `pnpm dev` after changing environment variables.

The real adapter currently expects:

- `GET /runtime/snapshot` for the first complete runtime snapshot.
- WebSocket messages with `type: "runtime_snapshot"` or
  `type: "runtime_update"` for complete runtime snapshots.

The detailed contract and file responsibilities are documented in
`src/api/README.md`.

### Lint with [ESLint](https://eslint.org/)

```sh
pnpm lint
```
