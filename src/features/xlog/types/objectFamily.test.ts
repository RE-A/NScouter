// 종류 → Family — **커스텀 종류의 WAS 를 놓치지 않는가.**
//
// 운영에서는 `monitoring_group_type` 에 시스템 이름(`ORDER-JVM`)을 넣는다. 이름 목록으로만
// 가르면 그런 서버가 WAS 로 안 잡혀 Active 탭·카운터에서 통째로 빠졌다.

import { afterEach, describe, expect, it } from 'vitest';
import {
  familyOfObjectType,
  isDatasourceObjectType,
  isHostObjectType,
  isJavaeeObjectType,
  learnFamiliesFromObjects,
  registerObjectTypeFamilies,
  resetObjectTypeFamilies,
} from './counter';

afterEach(() => resetObjectTypeFamilies());

const obj = (obj_type: string, detected?: string) => ({
  obj_type,
  tags: detected ? ([['detected', detected]] as [string, string][]) : [],
});

describe('종류 → Family', () => {
  it('콜렉터 표를 받기 전에는 이름 목록으로 가른다 — 지금까지와 같다', () => {
    expect(isJavaeeObjectType('tomcat')).toBe(true);
    expect(isHostObjectType('linux')).toBe(true);
    expect(isDatasourceObjectType('datasource')).toBe(true);
    expect(familyOfObjectType('ORDER-JVM')).toBeNull();
  });

  it('콜렉터가 알려 준 커스텀 종류를 WAS 로 가른다', () => {
    // 실측: monitoring_group_type=SHOP-JVM → 콜렉터 사이트 정의에 SHOP-JVM → javaee
    registerObjectTypeFamilies([{ name: 'SHOP-JVM', family: 'javaee' }]);
    expect(isJavaeeObjectType('SHOP-JVM')).toBe(true);
    expect(isHostObjectType('SHOP-JVM')).toBe(false);
  });

  it('커스텀 호스트 종류도 호스트로 가른다', () => {
    registerObjectTypeFamilies([{ name: 'ORDER-LINUX', family: 'host' }]);
    expect(isHostObjectType('ORDER-LINUX')).toBe(true);
  });

  it('WAS 도 호스트도 아닌 Family 는 그렇게 읽는다 — 지어내지 않는다', () => {
    registerObjectTypeFamilies([{ name: 'nightly', family: 'batch' }]);
    expect(familyOfObjectType('nightly')).toBe('batch');
    expect(isJavaeeObjectType('nightly')).toBe(false);
  });

  it('콜렉터 표를 못 받았으면 에이전트의 detected 태그로 배운다', () => {
    // 옛 콜렉터이거나 요청이 실패한 경우. 콜렉터가 하는 일을 그대로 한다.
    learnFamiliesFromObjects([obj('PAY-JVM', 'tomcat'), obj('PAY-LINUX', 'linux')]);
    expect(isJavaeeObjectType('PAY-JVM')).toBe(true);
    expect(isHostObjectType('PAY-LINUX')).toBe(true);
  });

  it('detected 도 없으면 모른다고 둔다', () => {
    learnFamiliesFromObjects([obj('MYSTERY')]);
    expect(familyOfObjectType('MYSTERY')).toBeNull();
  });

  it('콜렉터 표가 detected 로 배운 것을 이긴다', () => {
    // 사이트 정의를 사람이 손으로 고쳤다면 그게 정답이다.
    learnFamiliesFromObjects([obj('X-JVM', 'tomcat')]);
    registerObjectTypeFamilies([{ name: 'X-JVM', family: 'batch' }]);
    expect(familyOfObjectType('X-JVM')).toBe('batch');
  });

  it('이미 아는 종류는 detected 로 덮어쓰지 않는다', () => {
    registerObjectTypeFamilies([{ name: 'SHOP-JVM', family: 'javaee' }]);
    learnFamiliesFromObjects([obj('SHOP-JVM', 'linux')]);
    expect(familyOfObjectType('SHOP-JVM')).toBe('javaee');
  });

  it('접속이 바뀌면 비운다 — 콜렉터마다 사이트 정의가 다르다', () => {
    registerObjectTypeFamilies([{ name: 'SHOP-JVM', family: 'javaee' }]);
    learnFamiliesFromObjects([obj('PAY-JVM', 'tomcat')]);
    resetObjectTypeFamilies();
    expect(familyOfObjectType('SHOP-JVM')).toBeNull();
    expect(familyOfObjectType('PAY-JVM')).toBeNull();
  });
});
