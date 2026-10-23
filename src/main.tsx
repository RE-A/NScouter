import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { windowLabelFrom } from "./features/xlog/detached/protocol";
// 디자인 토큰 + Tailwind. 이걸 빼면 var(--x) 와 유틸 클래스가 전부 무효가 된다.
import "./styles/index.css";

// 떼어 낸 XLog 창이면 같은 앱을 **XLog 화면만** 띄운다 (`detached/protocol.ts`).
const windowLabel = windowLabelFrom(window.location.search);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App windowLabel={windowLabel ?? undefined} />
  </React.StrictMode>,
);
