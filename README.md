<div align="center">
  <h1>ISpooferMotion V2</h1>
  <p><strong>A Animation Spoofing Utility for Roblox</strong></p>

  <p>
    <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/releases"><img alt="Version" src="https://img.shields.io/github/v/release/ISpooferMotion/ISpooferMotion-V2?style=flat-square&color=blue" /></a>
    <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/ISpooferMotion/ISpooferMotion-V2?style=flat-square&color=green" /></a>
    <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/actions"><img alt="Build Status" src="https://img.shields.io/github/actions/workflow/status/ISpooferMotion/ISpooferMotion-V2/ci.yml?branch=main&style=flat-square" /></a>
  </p>
</div>

---

## 📥 Installation

You can download the latest compiled binaries for Windows from the [Releases](https://github.com/ISpooferMotion/ISpooferMotion-V2/releases) page.

1. Download `ISpooferMotion-V2-Installer.exe`.
2. Run the installer and follow the prompts.
3. Launch the application!

---

## 🛠️ Developer Setup

Interested in modifying ISpooferMotion V2? Getting the development environment up and running is easy.

### Prerequisites

- [Node.js](https://nodejs.org/en/) (v18+)
- [Bun](https://bun.sh/) (v1.0+)
- [Rust & Cargo](https://rustup.rs/)

### Building Locally

```bash
# Clone the repository and initialize submodules
git clone --recurse-submodules https://github.com/ISpooferMotion/ISpooferMotion-V2.git
cd ISpooferMotion-V2

# Install dependencies (This also sets up the UI submodule)
bun install

# Run the Tauri development server
bun run tauri:dev
```

### Formatting & Testing

Before submitting a Pull Request, ensure your code passes all checks:

```bash
bun run check
```

---

## 🤝 Contributing

We welcome contributions from the community! Please read our [Contributing Guidelines](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md) before submitting a Pull Request.

---

## 📄 License

This project is licensed under the **GPL-3.0 License**. See the [LICENSE](LICENSE) file for more information.
