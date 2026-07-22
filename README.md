# ScenePilot Studio

ScenePilot is a beat-aware music video editor that analyzes video or audio, places clips and effects against musical structure, and lets editors refine the generated arrangement.

## Development

```bash
npm install
npm run dev
```

## Validation

```bash
npm test
npm run lint
```

## macOS application

```bash
npm run desktop:dist
```

The desktop app checks the public GitHub Releases channel at startup and through **Help → Check for Updates**. Each push to `main` creates a new Apple Silicon DMG release automatically.
