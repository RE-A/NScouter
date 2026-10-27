// 버튼 한 벌 — `.btn` 계열 클래스(index.css «누를 수 있는 것»)를 고르는 얇은 껍데기.
//
// **모양은 CSS 가 갖고 있다.** 여기서는 종류와 크기를 이름으로 고르게만 한다 — 화면마다
// `rounded border px-1.5 py-0.5 text-micro text-fg-dim hover:…` 를 손으로 적다 보니 같은 «보조 버튼» 이
// 화면마다 크기·테두리·호버가 달랐다.
//
//   default  늘 윤곽이 있다. 툴바·헤더처럼 찾아서 누르는 자리
//   ghost    평상시 조용하고 닿으면 윤곽. 목록 안의 보조 버튼, 닫기(✕)
//   primary  그 화면의 주된 일 하나 (저장·찾기·적용)
//   danger   되돌릴 수 없는 것 (지우기·GC·연결 해제)

import type { ButtonHTMLAttributes, Ref } from 'react';

export type ButtonVariant = 'default' | 'ghost' | 'primary' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  default: 'btn',
  ghost: 'btn-ghost',
  primary: 'btn btn-primary',
  danger: 'btn btn-danger',
};

const SIZE: Record<ButtonSize, string> = {
  xs: 'px-1.5 py-0.5 text-micro',
  sm: 'px-2 py-0.5 text-micro',
  md: 'px-3 py-1 text-small',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

/** 버튼 클래스 — `<a>`·`<label>` 처럼 버튼이 아닌 것을 버튼 모양으로 그릴 때 */
export function buttonClass(variant: ButtonVariant = 'default', size: ButtonSize = 'sm', extra = ''): string {
  return [VARIANT[variant], SIZE[size], extra].filter(Boolean).join(' ');
}

export function Button({ variant = 'default', size = 'sm', className = '', type = 'button', ref, ...rest }: ButtonProps) {
  return <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...rest} />;
}
