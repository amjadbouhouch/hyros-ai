#!/usr/bin/env bun
/**
 * Hyros AI CLI entrypoint.
 *
 * For now this is a minimal "hello world" — the architecture reserves this
 * app for a Bun `--compile` native binary (see architecture.md §7).
 *
 *   bun run src/cli.ts            # dev
 *   bun build ./src/cli.ts \
 *     --compile --outfile hyros-ai # produce a standalone executable
 */
console.log("hello world");