// Rust `task_이름_규칙` 시험과 같은 표
import { describe, expect, it } from 'vitest';
import { picksByRule, taskMatch } from './taskRule';

describe('Task 이름 규칙', () => {
  it('별표·물음표·포함', () => {
    expect(taskMatch('shop-app-*', 'shop-app-ip-10-1-2-3')).toBe(true);
    expect(taskMatch('shop-app-*', 'my-shop-app-1')).toBe(false);
    expect(taskMatch('*shop*', 'my-shop-app-1')).toBe(true);
    expect(taskMatch('shop-?', 'shop-1')).toBe(true);
    expect(taskMatch('shop-?', 'shop-12')).toBe(false);
    expect(taskMatch('shop', 'my-shop-app')).toBe(true);
    expect(taskMatch('a*b*c', 'axxbyyc')).toBe(true);
    expect(taskMatch('a*b*c', 'axxbyy')).toBe(false);
    expect(taskMatch('a.b*', 'axb1'), '점은 글자 그대로').toBe(false);
  });

  it('끝 마디에 맞추고 대소문자를 가리지 않는다', () => {
    expect(picksByRule(['Shop-App-*'], '/13fc079be9ec/shop-app-ip-10-0-0-1')).toBe(true);
    expect(picksByRule(['shop-app-*'], '/h/order-app-1')).toBe(false);
    expect(picksByRule([], '/h/shop')).toBe(false);
  });
});
