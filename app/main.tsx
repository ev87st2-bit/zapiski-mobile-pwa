import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import NotesApp from "./NotesApp";
import "./globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NotesApp />
  </StrictMode>,
);
