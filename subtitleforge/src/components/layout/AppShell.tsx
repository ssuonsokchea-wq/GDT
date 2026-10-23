/**
 * The window layout.
 *
 * Project panel left, video centre, timeline across the bottom, editor and
 * style controls right — the arrangement every video editor uses, because the
 * eye travels from source to canvas to time, and controls sit where the
 * dominant hand rests.
 *
 * The two dividers are draggable and their widths persist, because a user
 * styling captions wants a wide right panel and a user reviewing timing wants
 * a tall timeline, and neither should have to ask twice.
 */

import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'sf.layout.v1';

interface Layout {
  left: number;
  right: number;
  timeline: number;
}

const DEFAULTS: Layout = { left: 264, right: 380, timeline: 232 };
const LIMITS = { left: [200, 420], right: [300, 560], timeline: [150, 520] } as const;

function load(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Layout | null;
    if (!saved) return DEFAULTS;
    return {
      left: clampTo('left', saved.left ?? DEFAULTS.left),
      right: clampTo('right', saved.right ?? DEFAULTS.right),
      timeline: clampTo('timeline', saved.timeline ?? DEFAULTS.timeline),
    };
  } catch {
    return DEFAULTS;
  }
}

function clampTo(key: keyof Layout, value: number): number {
  const [min, max] = LIMITS[key];
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function AppShell({
  left,
  center,
  timeline,
  right,
}: {
  left: ReactNode;
  center: ReactNode;
  timeline: ReactNode;
  right: ReactNode;
}) {
  const [layout, setLayout] = useState<Layout>(load);
  const dragging = useRef<keyof Layout | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      /* a non-persistent layout is not worth an error */
    }
  }, [layout]);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const key = dragging.current;
    if (!key) return;
    setLayout((current) => {
      if (key === 'left') return { ...current, left: clampTo('left', event.clientX) };
      if (key === 'right') return { ...current, right: clampTo('right', window.innerWidth - event.clientX) };
      return { ...current, timeline: clampTo('timeline', window.innerHeight - event.clientY - 32) };
    });
  }, []);

  const stop = useCallback(() => {
    dragging.current = null;
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stop);
  }, [onPointerMove]);

  const start = (key: keyof Layout) => (event: React.PointerEvent) => {
    event.preventDefault();
    dragging.current = key;
    document.body.style.cursor = key === 'timeline' ? 'ns-resize' : 'ew-resize';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside style={{ width: layout.left }} className="flex min-h-0 shrink-0 flex-col bg-panel-900">
        {left}
      </aside>
      <Divider orientation="vertical" onPointerDown={start('left')} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 bg-panel-950">{center}</div>
        <Divider orientation="horizontal" onPointerDown={start('timeline')} />
        <div style={{ height: layout.timeline }} className="shrink-0 bg-panel-900">
          {timeline}
        </div>
      </div>

      <Divider orientation="vertical" onPointerDown={start('right')} />
      <aside style={{ width: layout.right }} className="flex min-h-0 shrink-0 flex-col bg-panel-900">
        {right}
      </aside>
    </div>
  );
}

function Divider({
  orientation,
  onPointerDown,
}: {
  orientation: 'vertical' | 'horizontal';
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      onPointerDown={onPointerDown}
      className={clsx(
        'group relative shrink-0 bg-panel-750 transition-colors duration-120 hover:bg-accent',
        orientation === 'vertical' ? 'w-px cursor-ew-resize' : 'h-px cursor-ns-resize',
      )}
    >
      {/* A one-pixel divider is impossible to grab; the hit area is wider. */}
      <span
        className={clsx(
          'absolute',
          orientation === 'vertical' ? '-left-1 -right-1 inset-y-0' : '-top-1 -bottom-1 inset-x-0',
        )}
      />
    </div>
  );
}
