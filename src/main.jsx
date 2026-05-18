import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { LoginGate } from "./components/LoginGate.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <LoginGate>
      <App />
    </LoginGate>
  </StrictMode>
);
