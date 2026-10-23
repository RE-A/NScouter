import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DetachedXLog } from "./features/xlog/detached/DetachedXLog";
import { detachedKeyFrom } from "./features/xlog/detached/wire";
// 디자인 토큰 + Tailwind. 이걸 빼면 var(--x) 와 유틸 클래스가 전부 무효가 된다.
import "./styles/index.css";

// 떼어 낸 XLog 창이면 그 탭 하나만 그린다. 메인 창의 앱을 또 띄우면 접속·저장을 두 벌로 하게 된다.
const detachedKey = detachedKeyFrom(window.location.search);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {detachedKey !== null ? <DetachedXLog tabKey={detachedKey} /> : <App />}
  </React.StrictMode>,
);
