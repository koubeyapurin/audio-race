import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStage, GOAL_X } from '../game/stage';
import { courseRecordId, readBestScore, recordBestScore, scoreRecordRevision } from './resultRecords';

let values: Map<string, string>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
beforeEach(() => {
  values = new Map();
  storage = { getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) };
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('操作モード・コースごとの自己ベスト', () => {
  it('初回・更新・同点・未更新を区別し、同点以下では保存し直さない', () => {
    expect(readBestScore('mic')).toEqual({ best: null, available: true });
    const initialRevision = scoreRecordRevision();
    expect(recordBestScore('mic', 100)).toMatchObject({ best: 100, previous: null, status: 'first' });
    expect(recordBestScore('mic', 300)).toMatchObject({ best: 300, previous: 100, status: 'improved' });
    expect(recordBestScore('mic', 300)).toMatchObject({ best: 300, previous: 300, status: 'tied' });
    expect(recordBestScore('mic', 200)).toMatchObject({ best: 300, previous: 300, status: 'unchanged' });
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(scoreRecordRevision()).toBe(initialRevision + 2);
  });

  it('モードとコースを混ぜず、以前の保存値を読み出せる', () => {
    recordBestScore('mic', 1000, 'course-A');
    recordBestScore('keyboard', 300, 'course-A');
    recordBestScore('mic', 200, 'course-B');
    expect(readBestScore('mic', 'course-A').best).toBe(1000);
    expect(readBestScore('keyboard', 'course-A').best).toBe(300);
    expect(readBestScore('mic', 'course-B').best).toBe(200);
    expect(readBestScore('keyboard', 'course-B').best).toBeNull();
    // モジュール内のスコアキャッシュではなく、ブラウザに残る値を読む。
    storage.getItem.mockReturnValueOnce('700');
    expect(readBestScore('mic', 'course-A').best).toBe(700);
  });

  it('モード不明の旧記録を引き継いだり削除したりしない', () => {
    const oldKey = 'voice-terrain-runner:best-score'; values.set(oldKey, '9999');
    expect(readBestScore('mic').best).toBeNull();
    recordBestScore('keyboard', 0);
    expect(readBestScore('keyboard').best).toBe(0);
    expect(values.get(oldKey)).toBe('9999');
    expect(storage.getItem).not.toHaveBeenCalledWith(oldKey);
  });

  it.each(['', ' ', 'NaN', 'Infinity', '-1', '1.5', '1e3', 'garbage', '9007199254740992'])(
    '破損した保存値%sを記録なしとして扱い、次の結果で修復できる', (value) => {
      storage.getItem.mockReturnValue(value);
      expect(readBestScore('mic')).toEqual({ best: null, available: true });
      expect(recordBestScore('mic', 100)).toMatchObject({ best: 100, status: 'first' });
      expect(storage.setItem).toHaveBeenCalledTimes(1);
    });

  it('不正なスコアを保存しない', () => {
    recordBestScore('mic', 100); storage.setItem.mockClear();
    for (const score of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(recordBestScore('mic', score)).toMatchObject({ best: 100, status: 'unchanged' });
    }
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('取得拒否・容量超過でも例外を外へ出さず、未保存の記録を保存済みと扱わない', () => {
    storage.getItem.mockImplementationOnce(() => { throw new Error('denied'); });
    expect(readBestScore('mic')).toEqual({ best: null, available: false });
    recordBestScore('mic', 100);
    storage.setItem.mockImplementationOnce(() => { throw new Error('quota'); });
    const previousRevision = scoreRecordRevision();
    expect(recordBestScore('mic', 300)).toEqual({ best: 100, previous: 100, status: 'unavailable', available: false });
    expect(scoreRecordRevision()).toBe(previousRevision);
    expect(readBestScore('mic').best).toBe(100);
    vi.stubGlobal('localStorage', undefined);
    expect(recordBestScore('mic', 500).available).toBe(false);
  });

  it('コースの配置・種類・寸法・ゴールが違えば記録を分ける', () => {
    const stage = buildStage(); const id = courseRecordId(stage);
    expect(courseRecordId(buildStage())).toBe(id);
    for (const changed of [{ x: stage[0].x + 1 }, { y: stage[0].y + 1 }, { w: stage[0].w + 1 },
      { h: stage[0].h + 1 }, { kind: 'obstacle' as const }, { id: 'changed' }]) {
      expect(courseRecordId([{ ...stage[0], ...changed }, ...stage.slice(1)])).not.toBe(id);
    }
    expect(courseRecordId(stage, GOAL_X + 1)).not.toBe(id);
    expect(stage).toEqual(buildStage());
  });
});
