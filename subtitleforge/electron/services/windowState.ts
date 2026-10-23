/**
 * Window geometry across launches.
 *
 * Stored in userData as plain JSON rather than a dependency. The saved bounds
 * are checked against the current displays before use: a window restored onto
 * a monitor that has since been unplugged is invisible, and the user has no
 * way to recover it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserWindow, app, screen } from 'electron';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

const DEFAULTS: WindowState = { width: 1600, height: 980, maximized: false };
const MINIMUM = { width: 1180, height: 720 };

function statePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

function isOnSomeDisplay(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return false;
  return screen.getAllDisplays().some(({ workArea }) => {
    return (
      state.x! >= workArea.x - 64 &&
      state.y! >= workArea.y - 64 &&
      state.x! < workArea.x + workArea.width &&
      state.y! < workArea.y + workArea.height
    );
  });
}

export function loadWindowState(): WindowState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8')) as WindowState;
    const state: WindowState = {
      width: Math.max(MINIMUM.width, Math.round(parsed.width) || DEFAULTS.width),
      height: Math.max(MINIMUM.height, Math.round(parsed.height) || DEFAULTS.height),
      maximized: Boolean(parsed.maximized),
      ...(Number.isFinite(parsed.x) ? { x: Math.round(parsed.x!) } : {}),
      ...(Number.isFinite(parsed.y) ? { y: Math.round(parsed.y!) } : {}),
    };
    if (!isOnSomeDisplay(state)) {
      delete state.x;
      delete state.y;
    }
    return state;
  } catch {
    return { ...DEFAULTS };
  }
}

export function trackWindowState(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const bounds = window.getNormalBounds();
        const state: WindowState = {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          maximized: window.isMaximized(),
        };
        writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8');
      } catch {
        /* geometry is a convenience, never a failure */
      }
    }, 400);
  };
  window.on('resize', persist);
  window.on('move', persist);
  window.on('maximize', persist);
  window.on('unmaximize', persist);
  window.on('close', persist);
}

export const windowMinimum = MINIMUM;
