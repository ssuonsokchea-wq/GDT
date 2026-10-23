import clsx from 'clsx';
import { Gauge, ListOrdered, Palette } from 'lucide-react';
import { SubtitleEditor } from '@/components/editor/SubtitleEditor';
import { QualityPanel } from '@/components/panels/QualityPanel';
import { StylePanel } from '@/components/style/StylePanel';
import { useAppStore } from '@/store/useAppStore';
import { useEditorStore } from '@/store/useEditorStore';

const TABS = [
  { id: 'editor', label: 'Editor', icon: ListOrdered },
  { id: 'style', label: 'Style', icon: Palette },
  { id: 'quality', label: 'Quality', icon: Gauge },
] as const;

export function RightPanel() {
  const tab = useAppStore((state) => state.rightPanelTab);
  const setTab = useAppStore((state) => state.setRightPanelTab);
  const quality = useEditorStore((state) => state.quality);
  const findings = (quality?.counts.error ?? 0) + (quality?.counts.warn ?? 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-panel-750 px-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={clsx(
              'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors duration-120',
              tab === id ? 'bg-panel-800 text-ink-100' : 'text-ink-400 hover:text-ink-200',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {id === 'quality' && findings > 0 ? (
              <span
                className={clsx(
                  'rounded px-1 text-2xs',
                  (quality?.counts.error ?? 0) > 0
                    ? 'bg-signal-error/20 text-signal-error'
                    : 'bg-signal-warn/20 text-signal-warn',
                )}
              >
                {findings}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {tab === 'editor' ? <SubtitleEditor /> : tab === 'style' ? <StylePanel /> : <QualityPanel />}
    </div>
  );
}
