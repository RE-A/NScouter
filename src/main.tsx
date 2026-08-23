import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// 디자인 토큰 + Tailwind. 이걸 빼면 var(--x) 와 유틸 클래스가 전부 무효가 된다.
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
