# Hyros AI

Monorepo for the Hyros AI platform — gateway, web app, desktop app, and CLI.

## Stack

| Layer                     | Choice                        |
|---------------------------|-------------------------------|
| Package manager / runtime | Bun                           |
| Monorepo orchestration    | Turborepo                     |
| Gateway framework         | Elysia (Bun-native)           |
| Type-safe API client      | Eden Treaty                   |
| Web app                   | React / Vite                  |
| Desktop                   | Tauri v2                      |
| CLI                       | Bun `--compile` native binary |

See [`architecture.md`](./architecture.md) for the full architecture.

## Prerequisites

- [Bun](https://bun.sh) >= 1.3
- [Node.js](https://nodejs.org) >= 20 (for Vite/Tauri tooling)
- [Rust](https://rustup.rs) stable (for the Tauri desktop shell)
- Xcode Command Line Tools (macOS): `xcode-select --install`

## Getting started

```bash
bun install
```

### Run everything (gateway + web + desktop)

```bash
bun run dev
```

### Run a single app

```bash
bun run --filter @hyros-ai/gateway dev
bun run --filter @hyros-ai/web dev
bun run --filter @hyros-ai/desktop dev
bun run --filter @hyros-ai/cli dev
```

## Workspace layout

```
/apps
  /gateway   # Elysia API — single source of truth for types
  /web       # Main SaaS web app (React + Vite)
  /desktop   # Tauri v2 desktop shell
  /cli       # Bun-compiled native binary
/packages
  /ui          # Shared component library (web + desktop)
  /types       # Shared domain types, DTOs
  /api-client  # Eden Treaty client, typed against @hyros-ai/gateway
  /utils
/tooling
  /tsconfig       # Base tsconfig.json composite presets
  /eslint-config