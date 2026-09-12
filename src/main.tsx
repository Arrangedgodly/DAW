/* @refresh reload */
import "./styles/base.css";
import { render } from "solid-js/web";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("root element #root not found");

// Disposable visual study, available only on the development server.
if (
  import.meta.env.DEV &&
  new URLSearchParams(location.search).has("variant")
) {
  const frame = document.createElement("iframe");
  frame.src = `/src/prototypes/living-instrument.html${location.search}`;
  frame.title = "Bitbounce living instrument visual prototypes";
  frame.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:9999;background:#080b0d";
  root.append(frame);
} else {
  render(() => <App />, root);
}
