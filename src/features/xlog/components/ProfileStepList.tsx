// src/features/xlog/components/ProfileStepList.tsx
// XLog 프로파일 Step 목록 렌더링

import React, { memo } from 'react';
import type { ProfileStep } from '../types/profile';

interface ProfileStepListProps {
  steps: ProfileStep[];
  texts: Record<number, string>;
}

export const ProfileStepList = memo(function ProfileStepList({
  steps,
  texts,
}: ProfileStepListProps) {
  if (steps.length === 0) {
    return <div style={emptyStyle}>프로파일 데이터 없음</div>;
  }

  return (
    <div style={listStyle}>
      {steps.map((step, i) => (
        <StepRow key={i} step={step} texts={texts} />
      ))}
    </div>
  );
});

function StepRow({ step, texts }: { step: ProfileStep; texts: Record<number, string> }) {
  if (step.kind === 'Unknown') {
    return null; // 미지원 Step 타입은 숨김
  }

  const indent = Math.max(0, step.parent) * 12;

  switch (step.kind) {
    case 'Method': {
      const name = texts[step.hash] ?? `[0x${step.hash.toString(16)}]`;
      const hasElapsed = step.elapsed > 0;
      return (
        <div style={rowStyle('#3c3c5a')}>
          <div style={{ paddingLeft: indent }}>
            <span style={kindBadge('#6c7aad')}>M</span>
            <span style={nameStyle}>{name}</span>
            {hasElapsed && (
              <span style={timeStyle(step.elapsed)}>{step.elapsed}ms</span>
            )}
          </div>
        </div>
      );
    }

    case 'Sql': {
      const query = texts[step.hash] ?? `[0x${step.hash.toString(16)}]`;
      const errorText = step.error !== 0 ? (texts[step.error] ?? `ERR:${step.error}`) : null;
      return (
        <div style={rowStyle(step.error !== 0 ? '#3a1818' : '#1a3a1a')}>
          <div style={{ paddingLeft: indent }}>
            <span style={kindBadge('#e6a030')}>SQL</span>
            <span style={timeStyle(step.elapsed)}>{step.elapsed}ms</span>
            {step.updated > 0 && (
              <span style={metaStyle}>{step.updated}rows</span>
            )}
            <div style={queryStyle}>{query}</div>
            {step.param && <div style={paramStyle}>{step.param}</div>}
            {errorText && <div style={errorTextStyle}>{errorText}</div>}
          </div>
        </div>
      );
    }

    case 'ApiCall': {
      const url = texts[step.hash] ?? `[0x${step.hash.toString(16)}]`;
      const addr = step.address || url;
      const errorText = step.error !== 0 ? (texts[step.error] ?? `ERR:${step.error}`) : null;
      return (
        <div style={rowStyle(step.error !== 0 ? '#3a1818' : '#1a2a3a')}>
          <div style={{ paddingLeft: indent }}>
            <span style={kindBadge('#4fc3f7')}>API</span>
            <span style={timeStyle(step.elapsed)}>{step.elapsed}ms</span>
            <div style={queryStyle}>{addr}</div>
            {errorText && <div style={errorTextStyle}>{errorText}</div>}
          </div>
        </div>
      );
    }

    case 'Message': {
      const text = step.message || (step.hash !== 0 ? (texts[step.hash] ?? `[0x${step.hash.toString(16)}]`) : '');
      return (
        <div style={rowStyle('#2a2a3a')}>
          <div style={{ paddingLeft: indent }}>
            <span style={kindBadge('#888')}>MSG</span>
            <span style={nameStyle}>{text}</span>
          </div>
        </div>
      );
    }

    case 'Socket': {
      return (
        <div style={rowStyle('#2a2a3a')}>
          <div style={{ paddingLeft: indent }}>
            <span style={kindBadge('#ab47bc')}>SOCK</span>
            <span style={nameStyle}>{step.ipaddr}:{step.port}</span>
            <span style={timeStyle(step.elapsed)}>{step.elapsed}ms</span>
          </div>
        </div>
      );
    }
  }
}

// ─── 스타일 ────────────────────────────────────────────────────

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
};

const emptyStyle: React.CSSProperties = {
  padding: '12px',
  fontSize: 12,
  color: '#555',
  textAlign: 'center',
};

function rowStyle(bg: string): React.CSSProperties {
  return {
    background: bg,
    borderRadius: 3,
    padding: '4px 8px',
    fontSize: 11,
    lineHeight: 1.6,
  };
}

function kindBadge(color: string): React.CSSProperties {
  return {
    display: 'inline-block',
    background: color,
    color: '#fff',
    fontSize: 9,
    fontWeight: 700,
    padding: '1px 4px',
    borderRadius: 2,
    marginRight: 6,
    verticalAlign: 'middle',
  };
}

function timeStyle(elapsed: number): React.CSSProperties {
  const color = elapsed > 1000 ? '#ef5350' : elapsed > 300 ? '#ffb74d' : '#81c784';
  return {
    color,
    fontWeight: 600,
    marginRight: 6,
    fontSize: 11,
  };
}

const metaStyle: React.CSSProperties = {
  color: '#888',
  fontSize: 10,
  marginRight: 6,
};

const nameStyle: React.CSSProperties = {
  color: '#ccc',
  wordBreak: 'break-all',
};

const queryStyle: React.CSSProperties = {
  color: '#b0bec5',
  fontFamily: 'monospace',
  fontSize: 10,
  marginTop: 2,
  wordBreak: 'break-all',
  whiteSpace: 'pre-wrap',
};

const paramStyle: React.CSSProperties = {
  color: '#78909c',
  fontFamily: 'monospace',
  fontSize: 10,
  marginTop: 2,
};

const errorTextStyle: React.CSSProperties = {
  color: '#ef9a9a',
  fontSize: 10,
  marginTop: 2,
};
