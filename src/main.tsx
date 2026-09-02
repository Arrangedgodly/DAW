/* @refresh reload */
import "./styles/base.css";
import { render } from "solid-js/web";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("root element #root not found");

render(() => <App />, root);
