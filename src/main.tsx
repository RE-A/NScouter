import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { windowLabelFrom } from "./features/xlog/detached/protocol";
// 디자인 토큰 + Tailwind. 이걸 빼면 var(--x) 와 유틸 클래스가 전부 무효가 된다.
// 판 배치(dockview) 기본 모양 → 우리 토큰 → 판 테마(색을 토큰으로 덮는다). 순서가 곧 덮는 순서다
import "dockview-react/dist/styles/dockview.css";
import "./styles/index.css";
import "./styles/dockview-theme.css";

// 떼어 낸 XLog 창이면 같은 앱을 **XLog 화면만** 띄운다 (`detached/protocol.ts`).
const windowLabel = windowLabelFrom(window.location.search);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App windowLabel={windowLabel ?? undefined} />
  </React.StrictMode>,
);
