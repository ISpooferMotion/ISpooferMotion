# Contributing to ISpooferMotion V2

First off, thank you for considering contributing to ISpooferMotion! It's people like you that make ISpooferMotion such a great utility.

## Development Setup

1. Make sure you have [Node.js](https://nodejs.org/en/) (v18+), [Bun](https://bun.sh/) (v1.0+), and [Rust](https://rustup.rs/) installed.
2. Fork the repository and clone it to your local machine.
3. Be sure to clone submodules: `git clone --recurse-submodules https://github.com/<your-username>/ISpooferMotion-V2.git`
4. Run `bun install` to install dependencies.
5. Run `bun run tauri:dev` to spin up the local development server and Tauri app.

## Branching Strategy

We follow a simple Git Flow structure:

- `main` is our stable branch.
- For new features, branch off `main` using the format: `feature/your-feature-name`.
- For bug fixes, branch off `main` using the format: `fix/your-bug-name`.

## Commit Conventions

We enforce [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Please format your commit messages accordingly:

- `feat: [description]` for new features.
- `fix: [description]` for bug fixes.
- `docs: [description]` for documentation changes.
- `refactor: [description]` for code refactoring.
- `chore: [description]` for maintenance tasks.

## Quality Standards

Before submitting a Pull Request, you MUST run our comprehensive check suite:

```bash
bun run check
```

This command will:

1. Format your code with Prettier and StyLua.
2. Typecheck your TypeScript.
3. Run `cargo fmt`, `cargo clippy`, and `cargo test` for the backend.
4. Run ESLint and Vitest for the frontend.

**Pull Requests will automatically be blocked by GitHub Actions if `bun run check` fails.**

## Submitting a Pull Request

1. Ensure your code strictly follows the codebase's existing styling and architecture.
2. Use the standard Pull Request template provided in the repository.
3. Ensure your branch is up to date with `main`.
4. Submit your PR and await review!
