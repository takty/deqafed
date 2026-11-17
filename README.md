# Deqafed

Deqafed is a Windows text editor for learning Java. It uses opticm's Java mode for editing.

## Prerequisites

Install Node.js, Yarn, and the Windows prerequisites described in the [Tauri 2 prerequisites guide](https://v2.tauri.app/start/prerequisites/). These include the Microsoft C++ Build Tools, WebView2, and Rust with the MSVC toolchain. Follow the [Rust installation instructions](https://rust-lang.org/tools/install/) to install Rust and Cargo.

After installing Rust, restart your terminal and verify that Cargo is available:

```powershell
cargo --version
```

If Cargo is not found, check that its installation directory, normally `%USERPROFILE%\.cargo\bin`, is on your `PATH` and restart the terminal or IDE. If Rust was installed in a different location, use that installation's `bin` directory instead.

## Development and build

```sh
yarn install
yarn tauri dev
```

The project uses Yarn's `node-modules` linker for compatibility with Vite on Windows. Run `yarn install` after changing linker settings so the dependencies are installed in `node_modules`.

Run `yarn tauri build` to create a distributable build.

## Usage

Use the File menu to create, open, save, and close tabs. Deqafed asks before closing a tab or window with unsaved changes. The Tools menu opens Command Prompt in the current file's directory; save a new file before using this command.

Files are read and written as UTF-8. If a file contains CRLF line endings, CRLF is used when saving it. Java completion and formatting are not yet implemented in opticm.

## Updating Opticm

Opticm is installed from `takty/opticm` on GitHub. To refresh the commit pinned in `yarn.lock`, run:

```sh
yarn up -R opticm
```

Run `yarn dev` or `yarn build` to refresh Vite's public assets from the installed package. The editor, stylesheet, workers, Wasm files, and licenses are copied together.
