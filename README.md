# Mobile Preview

Live mobile device preview for local dev servers — like Chrome DevTools' device toolbar, but as an editor tab next to your code.

Click the phone icon in the editor tab bar to open "Mobile Preview" beside your current file. Point it at your dev server (`http://localhost:3000`, etc.) and it renders the page inside a real emulated mobile browser — not just a resized iframe.

## Features

- **Real device emulation**, not just a resized viewport. Uses a headless Chromium (via Playwright) with the actual user-agent, touch support, and pixel ratio of the selected device, so device-detection code (e.g. Ionic's `Platform.is('ios')`/`is('android')`) works correctly.
- **Device presets**: iPhone SE/12/14/15/16 Pro Max, Pixel 7/9 Pro, Galaxy S8/S24, iPad Mini, or a custom width/height.
- **Rotate**, **zoom** (manual or auto-fit to the available space), and **light/dark/"match VS Code theme"** color-scheme emulation.
- **Real touch gestures**: mouse interaction on the preview is forwarded as actual touch events (touchstart/touchmove/touchend), the same way Chrome DevTools treats your mouse as a finger — shown with a circular touch cursor.
- **Screenshot**: pixel-accurate capture of exactly what's in the emulated viewport, saved wherever you choose.
- Settings panel can be toggled hidden/shown, and its state (device, zoom, theme, URL) persists between sessions.

## Requirements

This extension uses [Playwright](https://playwright.dev/) to drive a real Chromium instance. The underlying browser binary (~150–300MB) is downloaded automatically the first time it's needed, which requires an internet connection and may take a minute or two. Subsequent launches are fast.

## Usage

1. Open any file in the editor.
2. Click the phone icon at the top-right of the editor tab bar ("Open Mobile Preview").
3. Enter the URL of your local dev server and press **Go**.
4. Use the settings icon (gear) to show/hide the device/zoom/theme controls.

## Known limitations

- Input is forwarded as touch events; sites that *only* listen for `touchstart`/`touchmove` without any mouse/click fallback should work, but exotic multi-touch gestures (pinch-zoom, multi-finger) aren't supported — only single-point taps and drags.
- The first load after opening VS Code launches a background Chromium process, which takes a few seconds ("Starting emulated browser…").

## License

MIT — see the LICENSE file included with this extension.
