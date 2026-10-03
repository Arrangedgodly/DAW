import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import {
  CHARACTER_GROUPS,
  SOUND_CATALOG,
  filterSounds,
  type SoundCharacter,
} from "../audio/soundCatalog";
import { type LaneId } from "../document/schema";
import { getSession } from "../engine/session";
import {
  rememberSound,
  rememberSoundPosition,
  soundBrowserPreferences,
  toggleFavorite,
} from "../state/soundBrowser";
import "../styles/sound-browser.css";

interface SoundBrowserProps {
  lane: LaneId;
  currentId: string;
  onUse: (id: string, results: readonly string[]) => void;
  onClose: () => void;
}
export default function SoundBrowser(props: SoundBrowserProps): JSX.Element {
  const session = getSession();
  const drums = props.lane === "drums";
  const sounds = SOUND_CATALOG.filter((s) => s.drums === drums);
  const current = () => sounds.find((s) => s.id === props.currentId);
  const previous =
    soundBrowserPreferences().positions[drums ? "drums" : "pitched"];
  const [category, setCategory] = createSignal(
    previous?.category ?? current()?.category ?? "",
  );
  const [view, setView] = createSignal<"Browse" | "Favorites" | "Recent">(
    "Browse",
  );
  const [query, setQuery] = createSignal("");
  const [characters, setCharacters] = createSignal<SoundCharacter[]>(
    previous?.characters ?? [],
  );
  const [candidate, setCandidate] = createSignal<string>();
  const [candidateResults, setCandidateResults] = createSignal<
    readonly string[]
  >([]);
  const [status, setStatus] = createSignal(
    "Tap a sound to preview. Your track stays unchanged.",
  );
  const [loading, setLoading] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  let request = 0;
  let dialog!: HTMLDialogElement;
  let resultsPanel!: HTMLDivElement;
  let closeButton!: HTMLButtonElement;
  const categories = [...new Set(sounds.map((s) => s.category))].sort((a, b) =>
    a.localeCompare(b),
  );
  const results = createMemo(() =>
    filterSounds(sounds, {
      category: view() === "Browse" && !query().trim() ? category() : undefined,
      characters: characters(),
      query: query(),
      ids:
        view() === "Favorites"
          ? soundBrowserPreferences().favorites
          : view() === "Recent"
            ? soundBrowserPreferences().recent
            : undefined,
    }),
  );
  const selected = () => sounds.find((s) => s.id === candidate());
  const availableTags = createMemo(
    () =>
      new Set(
        filterSounds(sounds, {
          category:
            view() === "Browse" && !query().trim() ? category() : undefined,
        }).flatMap((s) => s.characters),
      ),
  );

  const savePosition = () => {
    if (view() === "Browse" && !query().trim())
      rememberSoundPosition(
        drums,
        category(),
        resultsPanel?.scrollTop ?? 0,
        characters(),
      );
  };
  const close = () => {
    savePosition();
    session.stopSoundPreview();
    props.onClose();
  };
  onMount(() => {
    dialog.showModal();
    closeButton.focus();
    if (previous && resultsPanel) resultsPanel.scrollTop = previous.scroll;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const viewport = window.visualViewport;
    const sizeViewport = () => {
      dialog.style.setProperty(
        "--sound-browser-viewport-height",
        `${viewport?.height ?? innerHeight}px`,
      );
    };
    sizeViewport();
    viewport?.addEventListener("resize", sizeViewport);
    onCleanup(() => {
      request++;
      session.stopSoundPreview();
      document.body.style.overflow = bodyOverflow;
      viewport?.removeEventListener("resize", sizeViewport);
      dialog.close();
    });
  });
  const resetResults = () => {
    if (resultsPanel) resultsPanel.scrollTop = 0;
  };
  const chooseCategory = (name: string) => {
    setCategory(name);
    setQuery("");
    setCharacters([]);
    setView("Browse");
    resetResults();
  };
  const preview = async (id: string) => {
    const thisRequest = ++request;
    setCandidate(id);
    setCandidateResults(results().map((s) => s.id));
    setLoading(true);
    setReady(false);
    setStatus("Loading preview…");
    try {
      await session.previewSound(props.lane, id);
      if (request !== thisRequest) return;
      setReady(true);
      setStatus(
        drums
          ? "Playing a kit rhythm. Your track is unchanged."
          : "Playing a short phrase. Your track is unchanged.",
      );
    } catch {
      if (request !== thisRequest) return;
      setStatus("Preview could not play. Tap the sound to retry.");
    } finally {
      if (request === thisRequest) setLoading(false);
    }
  };
  const toggleTag = (tag: SoundCharacter) => {
    const group = CHARACTER_GROUPS.find((g) =>
      (g as readonly string[]).includes(tag),
    )!;
    setCharacters((tags) =>
      tags.includes(tag)
        ? tags.filter((x) => x !== tag)
        : [
            ...tags.filter((x) => !(group as readonly string[]).includes(x)),
            tag,
          ],
    );
    resetResults();
  };
  return (
    <Portal>
      <dialog
        ref={(el) => {
          dialog = el;
        }}
        class="sound-browser"
        aria-label={drums ? "Browse drum kits" : "Browse instrument sounds"}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <header class="sound-browser-header">
          <div>
            <h2>{drums ? "Drum kits" : "Instrument sounds"}</h2>
            <p>Current: {current()?.name}</p>
          </div>
          <button
            ref={(el) => {
              closeButton = el;
            }}
            type="button"
            onClick={close}
          >
            Close
          </button>
        </header>
        <div class="sound-browser-tools">
          <label class="sound-search">
            Search sounds
            <input
              type="search"
              placeholder={
                drums
                  ? "Name, family or character"
                  : "Try dark bass or soft bells"
              }
              value={query()}
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                resetResults();
              }}
            />
          </label>
          <nav class="sound-browser-views" aria-label="Sound library views">
            <For each={["Browse", "Favorites", "Recent"] as const}>
              {(name) => (
                <button
                  type="button"
                  aria-pressed={view() === name}
                  onClick={() => {
                    setView(name);
                    setQuery("");
                    setCharacters([]);
                    resetResults();
                  }}
                >
                  {name}
                </button>
              )}
            </For>
          </nav>
        </div>
        <div class="sound-browser-body">
          <nav
            class="sound-categories"
            aria-label="Sound categories"
            classList={{
              "show-categories":
                view() === "Browse" && !category() && !query().trim(),
            }}
          >
            <button
              type="button"
              class="sound-all-categories"
              aria-pressed={!category()}
              onClick={() => chooseCategory("")}
            >
              All categories
            </button>
            <For each={categories}>
              {(name) => (
                <button
                  type="button"
                  aria-pressed={category() === name && view() === "Browse"}
                  onClick={() => chooseCategory(name)}
                >
                  <span>{name}</span>
                  <span>
                    {sounds.filter((s) => s.category === name).length}
                  </span>
                </button>
              )}
            </For>
          </nav>
          <section
            class="sound-results"
            classList={{
              "hide-results":
                view() === "Browse" && !category() && !query().trim(),
            }}
            aria-label="Sound results"
          >
            <div class="sound-results-heading">
              <Show when={view() === "Browse" && !query().trim()}>
                <button
                  type="button"
                  class="sound-category-back"
                  onClick={() => chooseCategory("")}
                >
                  Categories
                </button>
              </Show>
              <h3>
                {query().trim()
                  ? "Search results"
                  : view() !== "Browse"
                    ? view()
                    : category() || "All sounds"}
              </h3>
              <span>{results().length} sounds</span>
            </div>
            <div
              class="sound-filters"
              role="group"
              aria-label="Sound character"
            >
              <For each={CHARACTER_GROUPS}>
                {(group) => (
                  <div>
                    <For each={group.filter((tag) => availableTags().has(tag))}>
                      {(tag) => (
                        <button
                          type="button"
                          aria-pressed={characters().includes(tag)}
                          onClick={() => toggleTag(tag)}
                        >
                          {tag}
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </For>
              <Show when={characters().length}>
                <button
                  type="button"
                  onClick={() => {
                    setCharacters([]);
                    resetResults();
                  }}
                >
                  Clear filters
                </button>
              </Show>
            </div>
            <div
              ref={(el) => {
                resultsPanel = el;
              }}
              class="sound-result-list"
            >
              <Show
                when={results().length}
                fallback={
                  <p class="sound-empty">
                    {view() === "Favorites"
                      ? "No favorites match. Save sounds with the favorite button beside a result."
                      : view() === "Recent"
                        ? "No recent sounds match. Sounds appear here after you choose Use sound."
                        : "No sounds match. Clear a filter or change your search."}
                  </p>
                }
              >
                <For each={results()}>
                  {(sound) => (
                    <div
                      class="sound-result"
                      classList={{ "is-candidate": candidate() === sound.id }}
                    >
                      <button
                        type="button"
                        class="sound-preview"
                        aria-label={`Preview ${sound.name}`}
                        aria-pressed={candidate() === sound.id}
                        onClick={() => void preview(sound.id)}
                      >
                        <span class="sound-result-name">
                          {sound.name}
                          <Show when={props.currentId === sound.id}>
                            <span class="sound-current">Current</span>
                          </Show>
                        </span>
                        <span class="sound-result-description">
                          {query().trim() || view() !== "Browse"
                            ? `${sound.category} · `
                            : ""}
                          {sound.description}
                        </span>
                      </button>
                      <button
                        type="button"
                        class="sound-favorite"
                        aria-label={`${soundBrowserPreferences().favorites.includes(sound.id) ? "Remove" : "Save"} ${sound.name} ${soundBrowserPreferences().favorites.includes(sound.id) ? "from" : "to"} favorites`}
                        aria-pressed={soundBrowserPreferences().favorites.includes(
                          sound.id,
                        )}
                        onClick={() => toggleFavorite(sound.id)}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="20"
                          height="20"
                          aria-hidden="true"
                        >
                          <path
                            d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-2.9-5.6 2.9 1-6.2L2.9 9.6l6.3-.9Z"
                            fill={
                              soundBrowserPreferences().favorites.includes(
                                sound.id,
                              )
                                ? "currentColor"
                                : "none"
                            }
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </section>
        </div>
        <footer class="sound-browser-footer">
          <div>
            <strong>
              {selected()
                ? `Preview: ${selected()!.name}`
                : "Choose a sound to preview"}
            </strong>
            <p role="status" aria-live="polite">
              {status()}
            </p>
          </div>
          <Show when={candidate()}>
            <button
              type="button"
              onClick={() => {
                request++;
                setLoading(false);
                session.stopSoundPreview();
                setStatus("Preview stopped. Your track is unchanged.");
              }}
            >
              Stop preview
            </button>
          </Show>
          <button
            type="button"
            class="sound-use"
            disabled={!ready() || loading() || !candidate()}
            onClick={() => {
              const id = candidate();
              if (!id || !ready()) return;
              savePosition();
              session.stopSoundPreview();
              rememberSound(id);
              props.onUse(id, candidateResults());
              props.onClose();
            }}
          >
            {loading() ? "Loading…" : "Use sound"}
          </button>
        </footer>
      </dialog>
    </Portal>
  );
}
