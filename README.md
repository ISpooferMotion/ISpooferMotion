<div align="center">
  <img src="public/app_icon.png" alt="ISpooferMotion" width="88" />

  <h1>ISpooferMotion</h1>

  <p>
    Real-time animation spoofing for Roblox Studio.<br />
    Swap, preview, and push assets without touching your place files.
  </p>

  <p>
    <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/releases/latest"><img alt="Latest Release" src="https://img.shields.io/github/v/release/ISpooferMotion/ISpooferMotion-V2?style=flat-square&label=release&color=6366f1" /></a>
    <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/ISpooferMotion/ISpooferMotion-V2/ci.yml?branch=main&style=flat-square&label=ci" /></a>
    <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/ISpooferMotion/ISpooferMotion-V2?style=flat-square&color=22c55e" /></a>
    <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/ISpooferMotion/ISpooferMotion-V2/total?style=flat-square&color=0ea5e9" /></a>
  </p>

  <p>
    <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/releases/latest">⬇️ Download</a>
    ·
    <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/issues/new?template=bug_report.md">🐛 Report a Bug</a>
    ·
    <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/issues/new?template=feature_request.md">💡 Request a Feature</a>
    ·
    <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/discussions">💬 Discussions</a>
  </p>
</div>

---

## 🔍 Overview

ISpooferMotion connects a desktop app directly to a running Roblox Studio session via a companion Luau plugin. Once connected, you can replace animation IDs across your entire place in seconds - no manual editing.

**What you can do:**

- 🔁 Replace any `Animation`, `Sound`, `Decal`, `Mesh`, or `Video` in real time across a full place scan
- 🎬 Preview R6/R15 rig animations and listen to audio assets before committing
- 👤 Manage Roblox user and group profiles with per-profile cookie storage (backed by the OS credential store)
- 🌲 Browse your place's asset tree, inspect properties, and copy IDs
- 🔔 Receive desktop notifications on spoof success or failure

**Built with:** Tauri v2 · React 19 · Tailwind v4 · Rust · Luau

---

## 📦 Installation

Download the latest release for your platform:

| Platform   | Installer                                         |
| -----------| ------------------------------------------------- |
| Windows    |  `ISpooferMotion_x.x.x_x64-setup.exe`             |
| macOS      |  `ISpooferMotion_x.x.x_x64.dmg`                   |
| Linux      |  `ISpooferMotion_x.x.x_amd64.AppImage`            |

The Roblox Studio plugin (`ISpooferMotion.rbxmx`) is attached to every release.
Install it by dragging it into Studio or through **Plugins → Manage Plugins**.

> [!NOTE]
> Windows Defender or your antivirus may flag the installer. This is a false positive - the app is not code-signed yet. You can verify the build yourself from source.

---

## 🛠️ Building from source

**Prerequisites:** [Rust](https://rustup.rs/) · [Bun](https://bun.sh/) v1+ · [Node.js](https://nodejs.org/) v20+

On Linux, also install: `libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

```bash
# Clone with submodules
git clone --recurse-submodules https://github.com/ISpooferMotion/ISpooferMotion-V2.git
cd ISpooferMotion-V2

# Install dependencies
bun install

# Build the component library
cd ISM-Library/packages/ui && bun install && bun run build && cd ../../..

# Start the app in development mode
bun run tauri:dev
```

<details>
<summary>📋 Useful commands</summary>

| Command                | Description                                                      |
| ---------------------- | ---------------------------------------------------------------- |
| `bun run check`        | Run the full CI suite (format, typecheck, clippy, tests, build)  |
| `bun run tauri:dev`    | Start the desktop app in dev mode                                |
| `bun run build:plugin` | Build the Luau Studio plugin to `dist-plugin/`                   |
| `bun run format`       | Auto-format everything (Prettier, rustfmt, StyLua)               |
| `bun run test`         | Run frontend unit tests with Vitest                              |
| `bun run rust:test`    | Run Rust unit tests                                              |

</details>

---

## 🤝 Contributing

Contributions are welcome. Read [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) before opening a pull request.

The short version: branch off `main`, run `bun run check` before pushing, and follow [Conventional Commits](https://www.conventionalcommits.org/).

> [!IMPORTANT]
> Pull requests that fail `bun run check` are automatically blocked by CI and will not be reviewed until they pass.

---

## 📄 License

Licensed under **GPL-3.0-or-later**. See [`LICENSE`](LICENSE) for the full text.
