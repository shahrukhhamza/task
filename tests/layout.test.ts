import { describe, expect, it } from 'vitest';
import { layoutLanes } from '../src/lib/layout';

describe('layoutLanes', () => {
  it('keeps separate items in a single lane', () => {
    expect(layoutLanes([{ start: 0, end: 10 }, { start: 10, end: 20 }])).toEqual([
      { lane: 0, lanes: 1 },
      { lane: 0, lanes: 1 },
    ]);
  });

  it('puts overlapping items side by side with equal lane counts', () => {
    expect(layoutLanes([{ start: 0, end: 30 }, { start: 10, end: 20 }])).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
    ]);
  });

  it('reuses a free lane inside a cluster', () => {
    const lanes = layoutLanes([
      { start: 0, end: 30 },
      { start: 5, end: 15 },
      { start: 20, end: 30 },
    ]);
    expect(lanes.map((l) => l.lane)).toEqual([0, 1, 1]);
    expect(lanes.every((l) => l.lanes === 2)).toBe(true);
  });

  it('handles input that is not sorted', () => {
    const lanes = layoutLanes([{ start: 50, end: 60 }, { start: 0, end: 10 }]);
    expect(lanes).toEqual([{ lane: 0, lanes: 1 }, { lane: 0, lanes: 1 }]);
  });
});
