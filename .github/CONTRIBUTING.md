# Contributing

Thanks for taking the time to contribute. Here's everything you need to know to get started.

## Getting set up

**Prerequisites:**

- [Rust](https://rustup.rs/) (stable)
- [Bun](https://bun.sh/) v1.0+
- [Node.js](https://nodejs.org/) v20+
- On Linux: `libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

**Clone and run:**

```bash
git clone --recurse-submodules https://github.com/ISpooferMotion/ISpooferMotion-V2.git
cd ISpooferMotion-V2
bun install
cd ISM-Library/packages/ui && bun install && bun run build && cd ../../..
bun run tauri:dev
```

## Making changes

Branch off `main`:

- `feat/your-feature-name` for new features
- `fix/what-you-fixed` for bug fixes
- `docs/what-you-updated` for documentation only

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat: add batch animation replace
fix: crash when cookie store is empty
docs: update build instructions
chore: bump uuid to 1.23.4
```

## Before you push

Run the full check suite:

```bash
bun run check
```

This runs Prettier, rustfmt, StyLua, TypeScript, Clippy, Cargo tests, ESLint, Vitest, and a full production build. If it passes locally it'll pass in CI.

Individual commands if you need them:

| Command              | What it runs          |
| -------------------- | --------------------- |
| `bun run format`     | Format everything     |
| `bun run typecheck`  | TS type checking      |
| `bun run rust:lint`  | Cargo Clippy          |
| `bun run rust:test`  | Cargo unit tests      |
| `bun run test`       | Vitest unit tests     |

## Submitting a pull request

1. Make sure your branch is up to date with `main`
2. Open a PR with a clear title and description - use the template provided
3. CI will run automatically; the PR can't be merged if checks fail
4. Wait for a review before merging

## Project layout

```text
src/                   React frontend
src-tauri/src/         Rust backend (Tauri commands, Studio bridge)
src-tauri/plugin/      Luau Studio plugin source
ISM-Library/           Shared component library (submodule)
scripts/               Build and dev tooling
```

The Luau plugin is built from source using `bun run build:plugin` - it concatenates the individual source files in `src-tauri/plugin/src/` into a single `ISpooferMotion.rbxmx`. If you're modifying the plugin, run that after your changes to verify the bundle builds cleanly.
