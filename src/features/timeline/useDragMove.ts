import { useRef, useState, type PointerEvent } from 'react';

const SNAP_MIN = 15;
const DRAG_THRESHOLD_PX = 5;

interface Options {
  enabled: boolean;
  pxPerMin: number;
  onCommit: (deltaMin: number) => void;
}

/**
 * Vertical drag with 15-minute snapping. Touch can only drag from the grip, so the page still scrolls
 * when you swipe over a block; mouse and pen can drag from anywhere on it.
 */
export function useDragMove({ enabled, pxPerMin, onCommit }: Options) {
  const startY = useRef<number | null>(null);
  const moved = useRef(false);
  const [offsetMin, setOffsetMin] = useState(0);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (!enabled || e.button !== 0) return;
    if (e.pointerType === 'touch' && !(e.target as HTMLElement).closest('[data-drag-handle]')) return;
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    startY.current = e.clientY;
    moved.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (startY.current === null) return;
    const dy = e.clientY - startY.current;
    if (!moved.current && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    moved.current = true;
    setOffsetMin(Math.round(dy / pxPerMin / SNAP_MIN) * SNAP_MIN);
  };

  const end = () => {
    if (startY.current === null) return;
    startY.current = null;
    const delta = offsetMin;
    setOffsetMin(0);
    if (moved.current && delta !== 0) onCommit(delta);
  };

  /** True once, right after a drag, so the click that follows it can be ignored. */
  const consumeDrag = (): boolean => {
    const was = moved.current;
    moved.current = false;
    return was;
  };

  return {
    offsetMin,
    consumeDrag,
    bind: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end },
  };
}
