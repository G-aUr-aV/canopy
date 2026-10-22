import React from "react";
import { createRoot } from "react-dom/client";
import { AuthGate } from "./Auth.tsx";
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import "./app.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthGate />
  </React.StrictMode>,
);
