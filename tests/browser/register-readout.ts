/** Parse the visible pitch endpoints without assuming a particular saved view. */
export function readPitchRange(text: string | null | undefined): number[] {
  const names = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  const pitches = Array.from(
    (text ?? "").matchAll(/([A-G](?:♯|#)?)(-?\d+)/g),
    (match) =>
      (Number(match[2]) + 1) * 12 + names.indexOf(match[1]!.replace("♯", "#")),
  );
  if (pitches.length !== 2)
    throw new Error(`Invalid register readout: ${text}`);
  return pitches;
}
