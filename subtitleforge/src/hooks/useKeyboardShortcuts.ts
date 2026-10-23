/**
 * Keyboard shortcuts.
 *
 * The rule that matters: a shortcut never fires while the user is typing. An
 * editor full of textareas and timecode fields makes "Space plays the video"
 * actively hostile unless the handler checks where focus is first.
 */

import { useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { useEditorStore } from '@/store/useEditorStore';
import { useProjectStore } from '@/store/useProjectStore';

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const editor = useEditorStore.getState();
      const app = useAppStore.getState();
      const modifier = event.ctrlKey || event.metaKey;
      const typing = isTyping(event.target);

      // Shortcuts that work even inside a text field, because they are
      // unambiguous with a modifier held.
      if (modifier && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        editor.undo();
        return;
      }
      if (modifier && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
        event.preventDefault();
        editor.redo();
        return;
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void editor.splitAtPlayhead();
        return;
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        void editor.mergeSelected();
        return;
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        app.openDialog('export');
        return;
      }
      if (modifier && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        app.openDialog('transcribe');
        return;
      }
      if (modifier && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        app.openDialog('batch');
        return;
      }
      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void useProjectStore.getState().saveBundle();
        return;
      }
      if (modifier && event.key === '/') {
        event.preventDefault();
        app.openDialog('shortcuts');
        return;
      }

      if (typing) return;

      switch (event.key) {
        case ' ': {
          event.preventDefault();
          // Toggling through the store would need a video reference; the
          // preview owns the element, so it listens for this instead.
          document.dispatchEvent(new CustomEvent('sf:toggle-play'));
          break;
        }
        case 'ArrowLeft':
          event.preventDefault();
          editor.setPlayhead(editor.playheadMs - (event.shiftKey ? 1000 : 100));
          break;
        case 'ArrowRight':
          event.preventDefault();
          editor.setPlayhead(editor.playheadMs + (event.shiftKey ? 1000 : 100));
          break;
        case 'j':
        case 'J': {
          const previous = [...editor.cues].reverse().find((cue) => cue.endMs < editor.playheadMs);
          if (previous) editor.setPlayhead(previous.startMs);
          break;
        }
        case 'l':
        case 'L': {
          const next = editor.cues.find((cue) => cue.startMs > editor.playheadMs);
          if (next) editor.setPlayhead(next.startMs);
          break;
        }
        case 'n':
        case 'N':
          editor.addCueAtPlayhead();
          break;
        case 'Delete':
        case 'Backspace':
          if (editor.selection.length > 0) {
            event.preventDefault();
            void editor.deleteSelected();
          }
          break;
        case 'a':
        case 'A':
          if (modifier) {
            event.preventDefault();
            editor.selectAll();
          }
          break;
        case 'Escape':
          editor.select(null);
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
