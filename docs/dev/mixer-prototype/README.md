# Mixer interaction prototypes

Four throwaway, interactive mixer studies. These files are isolated from the production mixer, document store, audio engine and saved projects. Values and illustrative meter levels are synthetic. Reload resets all edits.

Run from the project root:

```powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5194
```

Open `http://127.0.0.1:5194/docs/dev/mixer-prototype/index.html?variant=A`.

- A, Rotary rack: vertical channel faders over a compact horizontal bank of rotary effects.
- B, Control rows: shorter channels over full-width device rows with inline knobs and values.
- C, Touch panels: paired effect settings on draggable XY pads, with direct numeric EQ controls.
- D, Hybrid rack: A's rotary devices with wider Filter and EQ frequency-response plots. Drag F to set filter cutoff/resonance; drag C for low cut, L/H for shelf gains, and M for mid frequency/gain. Arrow keys on points and direct numeric fields are alternatives. The response uses disconnected Web Audio biquads in an offline context with the existing EQ topology. The gray spectrum is clearly labeled demo data, not live audio.

Click channel backgrounds or focus a channel and press Enter to select. Drag knobs up/down, use arrow keys on focused knobs, or type the visible values. Shift-drag gives finer adjustment. Double-click a knob to reset it. Try filter modes, delay divisions, bypass, reorder and remove. Remove an effect before adding a different effect on a track at capacity.

The bottom bar switches variants without losing temporary values. Left/right arrow keys also switch variants when no input or knob is focused. The theme button previews light mode. Auto Mix only demonstrates placement; there is no analysis or audio in this prototype.

## Design brief

Condense the lower FX area through controls suited to each parameter, not smaller rows of sliders. Make channel-card backgrounds select the instrument. Use the screen for controls, remove standing explanatory paragraphs, and keep every effect's controls exposed. Retain the current Bitbounce palette and typography as context.

Approved on 2026-09-21: D, Hybrid rack, with equal-height FX cards, larger controls that fill the available space, and compact selectable channel cards. This prototype remains a comparison reference; the approved design is implemented in the production Mixer.


## Flexible EQ study

Open eq.html?variant=D for the proposed next EQ. Up to eight addable/removable bands; every band can be Bell, Low shelf, High shelf, Low cut, High cut, Notch or Band pass. Frequency is free from 20 Hz to 20 kHz, with gain and Q enabled where the filter type supports them. Select a numbered node or tab, drag it, type values, or use arrow keys; Shift adjusts Q. Band bypass preserves its settings. This study uses in-memory demo state and has no audio or project writes. Approved on 2026-09-21: flexible zero-to-eight bands with interchangeable types and unrestricted node positions. Integrated into the production EQ schema, editor and DSP. Archive branch: codex/mixer-design-prototypes.

