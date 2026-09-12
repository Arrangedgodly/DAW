# Mobile grid navigation

Verified locally on 2026-09-12.

The original grid reserved horizontal cell gestures for editing. The first new regression test failed because a held horizontal drag left the grid at scrollLeft 0. It passes with the hold-to-pan implementation.

## Behavior

- Back and Forward navigate by up to 16 steps, with overlap at narrow widths, and disable at the scroll limits.
- The step readout follows button navigation, panning, resizing and zoom geometry.
- Draw mode keeps taps and quick pulls for note editing. A 320ms hold with less than 8px of movement starts panning and displays a static outline and "Drag to scroll" cue.
- Scroll mode pans immediately on touch. Navigation never writes the document.
- Cancellation, lost pointer capture, external sync and disposal clear the pending hold or pan. Pinch zoom retains priority when it takes over.

## Checks

- 10 browser tests passed across grid-navigation.test.tsx, drag-notes-trusted.test.tsx and register-pinch-zoom-trusted.test.tsx.
- Coverage includes four-bar panning, eight-bar pitched and drum grids, both navigation limits, explicit Scroll mode, quick draw and resize, cancellation, lost capture, and trusted Chromium touch over empty cells and existing notes.
- TypeScript and targeted ESLint passed. Production Vite build passed. Bundle gate passed against that build using SKIP_BUILD=1 because its default npm subprocess is unavailable on this Windows host.
- Complete-app screenshots at 320×740, 390×844, 844×390 and 1440×900 are saved here. layout.json records no page-wide horizontal overflow and mobile navigation targets at least 44px tall. Desktop with a fine pointer hides the added controls.
- scripts/verify-grid-navigation.mjs captures the app served at http://127.0.0.1:5194/.

Touch verification uses Chromium's real input pipeline through CDP. Physical iPhone and Android validation has not been performed. No deployment was made.
