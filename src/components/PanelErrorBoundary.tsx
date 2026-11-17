// 판 하나의 오류를 그 판 안에 가둔다
//
// 판이 여럿(최대 16)인데 하나가 그리다 넘어지면 React 는 앱 전체를 내린다 — 화면이 통째로 빈다.
// 그 판 자리에만 «이 판을 그리지 못했습니다» 와 까닭을 적고 `다시 그리기` 를 둔다.

import { Component, type ReactNode } from 'react';
import { t } from '../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  error: string | null;
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(e: unknown): State {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-small">
        <span className="text-danger">{t('이 판을 그리지 못했습니다')}</span>
        <span className="max-w-full break-all text-micro text-fg-dim">{this.state.error}</span>
        <button type="button" className="btn-ghost px-2 py-0.5 text-micro" onClick={() => this.setState({ error: null })}>
          {t('다시 그리기')}
        </button>
      </div>
    );
  }
}
