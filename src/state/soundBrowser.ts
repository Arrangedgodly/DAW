import { createSignal } from "solid-js";
import {
  CHARACTER_GROUPS,
  SOUND_CATALOG,
  type SoundCharacter,
} from "../audio/soundCatalog";

const KEY = "bitbounce.sound-browser.v1";
const validIds = new Set(SOUND_CATALOG.map((s) => s.id));
interface Preferences {
  favorites: string[];
  recent: string[];
  positions: Record<
    string,
    { category: string; scroll: number; characters: SoundCharacter[] }
  >;
}
function initial(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const ids = (list: unknown) =>
      Array.isArray(list)
        ? [
            ...new Set(
              list.filter(
                (id): id is string =>
                  typeof id === "string" && validIds.has(id),
              ),
            ),
          ]
        : [];
    const positions: Preferences["positions"] = {};
    for (const key of ["drums", "pitched"]) {
      const p = value?.positions?.[key];
      if (
        p &&
        typeof p.category === "string" &&
        Number.isFinite(p.scroll) &&
        p.scroll >= 0
      )
        positions[key] = {
          category: p.category,
          scroll: p.scroll,
          characters: CHARACTER_GROUPS.flatMap((group) => {
            const tag = group.find(
              (tag) =>
                Array.isArray(p.characters) && p.characters.includes(tag),
            );
            return tag ? [tag] : [];
          }),
        };
    }
    return {
      favorites: ids(value?.favorites),
      recent: ids(value?.recent).slice(0, 20),
      positions,
    };
  } catch {
    return { favorites: [], recent: [], positions: {} };
  }
}
const [soundBrowserPreferences, setPreferences] = createSignal(initial());
export { soundBrowserPreferences };
function save(value: Preferences): void {
  setPreferences(value);
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* Session preferences still work. */
  }
}
export function toggleFavorite(id: string): void {
  if (!validIds.has(id)) return;
  const p = soundBrowserPreferences();
  save({
    ...p,
    favorites: p.favorites.includes(id)
      ? p.favorites.filter((x) => x !== id)
      : [...p.favorites, id],
  });
}
export function rememberSound(id: string): void {
  if (!validIds.has(id)) return;
  const p = soundBrowserPreferences();
  save({
    ...p,
    recent: [id, ...p.recent.filter((x) => x !== id)].slice(0, 20),
  });
}
export function rememberSoundPosition(
  drums: boolean,
  category: string,
  scroll: number,
  characters: readonly SoundCharacter[],
): void {
  const p = soundBrowserPreferences();
  save({
    ...p,
    positions: {
      ...p.positions,
      [drums ? "drums" : "pitched"]: {
        category,
        scroll,
        characters: [...characters],
      },
    },
  });
}
