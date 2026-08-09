# Hyros AI Monorepo Architecture

## Stack Summary

| Layer                     | Choice                                                                      |
|---------------------------|-----------------------------------------------------------------------------|
| Package manager / runtime | Bun                                                                         |
| Monorepo orchestration    | Turborepo                                                                   |
| Gateway framework         | Elysia (Bun-native)                                                         |
| Type-safe API client      | Eden Treaty                                                                 |
| Web app                   | React / Vite or Next.js                                                     |
| Website                   | Astro or Next.js (static-first)                                             |
| Desktop                   | Tauri v2                                                                    |
| Mobile                    | Expo (React Native)                                                         |
| CLI                       | Bun `--compile` native binary                                               |
| Gateway distribution      | npm wrapper + compiled binary                                               |
| Testing                   | `bun test` (gateway/CLI/packages), Vitest (web), Jest (mobile/Expo default) |
| Versioning/publishing     | Changesets                                                                  |

---

## Repo Structure

```
/apps
  /gateway        # Elysia API — single source of truth for types
    /src
      index.ts     # Elysia app instance, exported (type-only import target)
      server.ts    # listen() bootstrapping, separated from app definition
      cli.ts       # bin entrypoint for npm/binary distribution
    package.json    # "bin" field for npx/bunx distribution

  /web            # Main SaaS web app
  /website        # Marketing site, static-first
  /desktop        # Tauri v2 — wraps /web's frontend build
  /mobile         # Expo (React Native)
  /cli            # Bun-compiled native binary, imports /packages/api-client

/packages
  /domain         # Shared domain types & DTOs (mobile-safe, pure types)
  /client-runtime # Shared non-visual client logic: session manager, platform seams (mobile-safe)
  /api-client     # Eden Treaty client, typed against @hyros-ai/gateway
  /ui             # Shared component library (web + desktop; RN-Web split for mobile)
  /utils          # Shared pure utilities (mobile-safe)
  /config         # Shared eslint/tailwind/tsconfig presets

/tooling
  /tsconfig       # Base tsconfig.json composite presets
  /eslint-config
```

---

## Key Architectural Decisions

### 1. Gateway as the single contract source
Elysia's route/schema definitions are the source of truth. `packages/api-client` imports **only the type** of the Elysia app (`import type { App } from '@hyros-ai/gateway'`) and generates a fully-typed client via **Eden Treaty** — no codegen step, no OpenAPI/GraphQL generation pipeline. Web, desktop, mobile, and CLI all consume this same typed client.

```ts
// apps/gateway/src/index.ts
export const app = new Elysia()
  .get('/user/:id', ({ params }) => getUser(params.id))

export type App = typeof app
```

```ts
// packages/api-client
import { treaty } from '@elysiajs/eden'
import type { App } from '@hyros-ai/gateway'

export const api = treaty<App>(process.env.GATEWAY_URL!)
```

Keep `index.ts` (app definition, exported for types) separate from `server.ts` (actual `.listen()` call) and `cli.ts` (bin entrypoint) — this ensures importing the *type* elsewhere never pulls server/runtime code into web or mobile bundles.

### 2. TypeScript project references
Each package is a composite TS project (`"composite": true`), referenced from the root `tsconfig.json`. Enables incremental builds and cross-package go-to-definition without publishing packages.

### 3. UI sharing strategy
- **Web + Desktop** share ~100% of UI (Tauri wraps the web build directly).
- **Mobile** shares hooks/logic/types but not DOM components. Split shared logic into headless hooks in `packages/ui`, keep platform-specific presentation in each app — or use `react-native-web` if broader sharing is wanted later.

### 4. Runtime boundaries (where Bun is native vs. package-manager-only)
- **Gateway, CLI, tooling scripts**: Bun as full runtime — no build step needed in dev (`bun run src/index.ts`), TS executed directly.
- **Mobile (Expo/Metro)**: Bun used for `bun install` only; Metro/Expo scripts still run under Node semantics — don't fight this.
- **Desktop (Tauri)**: Bun builds the frontend bundle; Tauri's Rust shell wraps it.
- **Web/Website**: Bun as package manager; dev server compatibility with Vite is solid, verify Next.js middleware/edge-runtime paths if used.

### 5. Desktop: Tauri v2
Native OS webview (WebView2 / WKWebView / WebKitGTK) instead of bundled Chromium — 5–20MB binaries vs. Electron's 100MB+, lower memory/CPU footprint. Frontend is the existing web app (React/Vite); native bridge logic (file system, tray, notifications) written in Rust. v2 adds mobile targets from the same Rust core, but Expo remains the primary mobile path.

### 6. Mobile: Expo (not bare React Native)
Managed workflow avoids native tooling pain; EAS Build handles CI/CD for app store builds. Metro's monorepo support (`watchFolders`) needed for resolving workspace packages.

### 7. CLI: Bun-compiled native binary
```bash
bun build ./src/cli.ts --compile --outfile hyros-ai
```
Produces a standalone executable with the Bun runtime embedded — no Node/Bun install required by end users. Distributed via npm wrapper (postinstall downloads the right platform binary) and/or GitHub Releases, following the pattern used by esbuild/swc/turbo.

### 8. Gateway distribution (self-hosted / downloadable)
Same `bun build --compile` approach applied to `apps/gateway/src/cli.ts`:
```bash
bun build ./src/cli.ts --compile --outfile hyros-ai-gateway
```
Distribution options:
- **`bunx @hyros-ai/gateway`** — simplest, requires Bun on the consumer's machine.
- **Compiled binary via npm wrapper** — npm package's `postinstall` fetches the correct platform binary (linux-x64, darwin-arm64, etc.) from GitHub Releases; no runtime dependency for the end user at all. Recommended if the gateway is meant to be self-hosted/on-prem rather than purely internally hosted.

If the gateway is *only* ever run as your own hosted service, this distribution work is unnecessary — a `Dockerfile` + `turbo dev` covers local development.

### 9. Versioning & publishing
**Changesets** for anything published externally (CLI, gateway binary, and `ui` if open-sourced later). Internal-only packages stay `"private": true`, `"version": "0.0.0"`, resolved via `workspace:*`.

---

## Open Decisions
- [ ] Gateway distribution model: self-hosted/on-prem (npm + binary) vs. hosted-only (Docker/internal)
- [ ] Web/Website framework: Next.js for both vs. Astro for website + Vite/React for web
- [ ] UI sharing depth for mobile: headless-hooks split vs. `react-native-web`