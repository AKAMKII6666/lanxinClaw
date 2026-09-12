# LanxinClaw

LanxinClaw is the Windows desktop companion for Lanxin Phone. It connects a paired Lanxin Phone device to a local OpenClaw runtime, so the phone-side character can ask the computer to perform approved desktop tasks while the PC remains the permission and audit boundary.

The project does not replace OpenClaw. LanxinClaw owns pairing, local discovery, user confirmation, task state, and desktop UI. OpenClaw owns the execution engine that reads files, runs commands, opens managed browser work, and reports execution evidence back to LanxinClaw.

## Works With

- **Lanxin Phone**: the Raspberry Pi phone project that discovers and pairs with this desktop companion on the LAN.
- **OpenClaw**: bundled inside the Windows app as an isolated runtime. Users do not need to install OpenClaw globally.
- **Alibaba Cloud Model Studio / DashScope Qwen**: the default onboarding provider. Users paste their own DashScope API key on first launch.

## What It Does

- Advertises a desktop companion over the local network for paired Lanxin Phone devices.
- Stores pairing identity and permission grants locally under the app user data directory.
- Starts a bundled OpenClaw gateway on loopback with a random local port and token.
- Keeps OpenClaw state isolated under `userData/openclaw-runtime`.
- Requires desktop-side permission confirmation before privileged computer actions.
- Keeps the bundled runtime out of the system `PATH` and does not install OpenClaw globally.

## Windows Install

Download the latest `LanxinClaw-Setup-*-x64.exe` from GitHub Releases and run it.

The first Windows build is unsigned, so Windows may show a security prompt. Install per user when prompted. The installer does not require administrator privileges for the default path.

After installation:

1. Open LanxinClaw.
2. Choose the Qwen region and model in the onboarding form.
3. Paste your DashScope API key.
4. Wait for LanxinClaw to start the bundled OpenClaw runtime.
5. Pair from Lanxin Phone when the desktop companion appears on the LAN.

## Development

Requirements:

- Node.js `>=20` for this repository.
- npm with workspace support.

Install dependencies:

```bash
npm ci
```

Start the companion in development mode:

```bash
npm run dev:companion
```

Build and start the Electron shell:

```bash
npm run start:companion
```

Run the quality gate:

```bash
npm run quality
```

## Build A Windows Installer

The release build prepares a private runtime under `.release/runtime/`, then packages the Electron app with `electron-builder`.

```bash
npm run dist:win
```

This produces:

- `apps/companion/release/LanxinClaw-Setup-0.1.1-x64.exe`
- `apps/companion/release/SHA256SUMS.txt`
- electron-builder metadata such as `latest.yml` when generated

The bundled runtime contains:

- OpenClaw `2026.7.1-2`
- Node.js `24.15.0` for Windows x64
- `@openclaw/qwen-provider@2026.7.1` as a local provider seed

For a local pre-release verification run:

```bash
npm run release:win:local
```

## Publish A GitHub Release

Pushing a version tag triggers the Windows release workflow:

```bash
git tag -a v0.1.1 -m "LanxinClaw v0.1.1"
git push origin v0.1.1
```

The workflow runs `npm run quality`, builds the Windows x64 installer, writes checksums, and publishes a GitHub Release with the generated assets.

## Repository Layout

- `apps/companion/`: Electron desktop companion, local discovery, pairing, UI, and OpenClaw runtime wiring.
- `packages/protocol/`: protocol contracts shared across phone and companion code.
- `packages/openclaw-adapter/`: translation layer between Lanxin jobs and OpenClaw gateway runs.
- `schemas/`: JSON schemas for protocol messages.
- `docs/`: product and engineering notes used by maintainers.
- `scripts/release/`: release-time runtime preparation and checksum scripts.

## Privacy And Safety

LanxinClaw is designed around a local trust boundary:

- Phone devices do not directly execute computer actions.
- Desktop-side permission confirmation stays in LanxinClaw.
- OpenClaw runs on loopback with a random token and isolated state.
- Model API keys are stored through Electron safe storage and injected into the runtime process environment when needed.
- The app does not add OpenClaw or bundled Node.js to `PATH`.

## License

LanxinClaw is released under the MIT License. See [LICENSE](LICENSE).
