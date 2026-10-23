/**
 * The style panel.
 *
 * Presets first, because most users want the Netflix or TikTok look and
 * nothing else; controls below for everyone who does. Every control writes to
 * the project immediately and the preview updates, so the panel is a direct
 * manipulation of the thing on screen rather than a form you submit.
 */

import clsx from 'clsx';
import { AlertTriangle, Check, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/common/Button';
import { Badge, ColorInput, Field, SegmentedControl, Select, Slider } from '@/components/common/Controls';
import { api } from '@/lib/api';
import { useAppStore } from '@/store/useAppStore';
import { useEditorStore } from '@/store/useEditorStore';
import { useProjectStore } from '@/store/useProjectStore';
import type { StyleRecord, SubtitleStyle } from '@/types/api';

const ALIGNMENT_GRID: Array<{ value: number; title: string }> = [
  { value: 7, title: 'Top left' },
  { value: 8, title: 'Top centre' },
  { value: 9, title: 'Top right' },
  { value: 4, title: 'Middle left' },
  { value: 5, title: 'Middle centre' },
  { value: 6, title: 'Middle right' },
  { value: 1, title: 'Bottom left' },
  { value: 2, title: 'Bottom centre' },
  { value: 3, title: 'Bottom right' },
];

export function StylePanel() {
  const project = useProjectStore((state) => state.project);
  const updateStyle = useProjectStore((state) => state.updateStyle);
  const capabilities = useAppStore((state) => state.capabilities);
  const [styles, setStyles] = useState<StyleRecord[]>([]);

  useEffect(() => {
    if (!project) return;
    void api
      .listStyles(project.id)
      .then((response) => setStyles(response.styles))
      .catch(() => setStyles([]));
  }, [project?.id]);

  const style = project?.settings.style;
  const fonts = capabilities?.fonts ?? [];
  const fontMissing = useMemo(
    () => Boolean(style && fonts.length > 0 && !fonts.includes(style.fontFamily)),
    [style, fonts],
  );

  if (!project || !style) {
    return <div className="p-4 text-xs text-ink-500">Open a project to style its subtitles.</div>;
  }

  const set = (patch: Partial<SubtitleStyle>) => void updateStyle(patch);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="border-b border-panel-800 p-3">
        <h3 className="field-label mb-2">Presets</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {styles
            .filter((record) => record.isPreset)
            .map((record) => {
              const current = record.payload.name === style.name;
              return (
                <button
                  key={record.id}
                  type="button"
                  title={record.payload.description}
                  onClick={() => set(record.payload)}
                  className={clsx(
                    'rounded border px-2 py-1.5 text-left transition-colors duration-120',
                    current
                      ? 'border-accent bg-accent-soft text-ink-100'
                      : 'border-panel-700 bg-panel-850 text-ink-300 hover:border-panel-600 hover:text-ink-100',
                  )}
                >
                  <span className="flex items-center gap-1 text-xs font-medium">
                    {record.name}
                    {current ? <Check className="h-3 w-3 text-accent-hover" /> : null}
                  </span>
                  <span className="mt-0.5 block text-2xs leading-tight text-ink-500">
                    {record.payload.maxCharsPerLine} chars · {record.payload.maxLines} line
                    {record.payload.maxLines === 1 ? '' : 's'}
                  </span>
                </button>
              );
            })}
        </div>
        <div className="mt-2 flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            icon={<Save className="h-3 w-3" />}
            onClick={async () => {
              const name = window.prompt('Save this style as', `${project.name} look`);
              if (!name) return;
              await api.saveStyle({ name, projectId: project.id, payload: style });
              setStyles((await api.listStyles(project.id)).styles);
              useAppStore.getState().notify({ kind: 'success', title: `Saved "${name}"` });
            }}
          >
            Save style
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw className="h-3 w-3" />}
            onClick={async () => {
              const { defaults } = await api.listStyles(project.id);
              set(defaults);
            }}
          >
            Reset
          </Button>
        </div>
        {styles.some((record) => !record.isPreset) ? (
          <div className="mt-2">
            <span className="field-label">Saved styles</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {styles
                .filter((record) => !record.isPreset)
                .map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => set(record.payload)}
                    className="rounded border border-panel-700 bg-panel-850 px-2 py-0.5 text-2xs text-ink-300 hover:text-ink-100"
                  >
                    {record.name}
                  </button>
                ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 border-b border-panel-800 p-3">
        <h3 className="field-label">Type</h3>
        <Field label="Font">
          <Select
            value={style.fontFamily}
            onChange={(fontFamily) => set({ fontFamily })}
            options={
              fonts.length > 0
                ? fonts.map((font) => ({ value: font, label: font }))
                : [{ value: style.fontFamily, label: style.fontFamily }]
            }
          />
        </Field>
        {fontMissing ? (
          <p className="flex items-start gap-1.5 text-2xs text-signal-warn">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            This machine has no font called "{style.fontFamily}". The render will substitute another, which changes
            the look. Pick one from the list to be sure.
          </p>
        ) : null}
        <Slider
          label="Size"
          value={style.fontSize}
          min={16}
          max={160}
          onChange={(fontSize) => set({ fontSize })}
          unit=" px at 1080p"
        />
        <div className="flex gap-1.5">
          <StyleToggleButton label="B" active={style.bold} title="Bold" onClick={() => set({ bold: !style.bold })} bold />
          <StyleToggleButton label="I" active={style.italic} title="Italic" onClick={() => set({ italic: !style.italic })} italic />
          <StyleToggleButton label="U" active={style.underline} title="Underline" onClick={() => set({ underline: !style.underline })} underline />
          <StyleToggleButton label="AA" active={style.uppercase} title="Upper case" onClick={() => set({ uppercase: !style.uppercase })} />
        </div>
        <Slider
          label="Letter spacing"
          value={style.letterSpacing}
          min={-2}
          max={8}
          step={0.1}
          onChange={(letterSpacing) => set({ letterSpacing })}
        />
      </section>

      <section className="space-y-3 border-b border-panel-800 p-3">
        <h3 className="field-label">Colour</h3>
        <ColorInput label="Text" value={style.primaryColor} onChange={(primaryColor) => set({ primaryColor })} />
        <Slider
          label="Text opacity"
          value={style.textOpacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(textOpacity) => set({ textOpacity })}
        />
        <Field label="Edge treatment">
          <SegmentedControl
            value={style.borderStyle}
            onChange={(borderStyle) => set({ borderStyle })}
            options={[
              { value: 'outline', label: 'Outline', title: 'Outline and shadow, as broadcast captions use' },
              { value: 'box', label: 'Box', title: 'A solid box behind the text, as YouTube uses' },
            ]}
            className="w-full"
          />
        </Field>
        {style.borderStyle === 'outline' ? (
          <>
            <ColorInput label="Outline" value={style.outlineColor} onChange={(outlineColor) => set({ outlineColor })} />
            <Slider
              label="Outline width"
              value={style.outlineWidth}
              min={0}
              max={12}
              step={0.2}
              onChange={(outlineWidth) => set({ outlineWidth })}
            />
            <ColorInput label="Shadow" value={style.shadowColor} onChange={(shadowColor) => set({ shadowColor })} />
            <Slider
              label="Shadow depth"
              value={style.shadowDepth}
              min={0}
              max={12}
              step={0.2}
              onChange={(shadowDepth) => set({ shadowDepth })}
            />
            <Slider
              label="Shadow opacity"
              value={style.shadowOpacity}
              min={0}
              max={1}
              step={0.05}
              onChange={(shadowOpacity) => set({ shadowOpacity })}
            />
          </>
        ) : (
          <>
            <ColorInput label="Box" value={style.backColor} onChange={(backColor) => set({ backColor })} />
            <Slider
              label="Box opacity"
              value={style.boxOpacity}
              min={0}
              max={1}
              step={0.05}
              onChange={(boxOpacity) => set({ boxOpacity })}
            />
          </>
        )}
      </section>

      <section className="space-y-3 border-b border-panel-800 p-3">
        <h3 className="field-label">Position</h3>
        <div className="grid w-24 grid-cols-3 gap-1">
          {ALIGNMENT_GRID.map((cell) => (
            <button
              key={cell.value}
              type="button"
              title={cell.title}
              onClick={() => set({ alignment: cell.value })}
              className={clsx(
                'h-7 rounded border text-2xs transition-colors duration-120',
                style.alignment === cell.value
                  ? 'border-accent bg-accent text-white'
                  : 'border-panel-700 bg-panel-850 text-ink-500 hover:border-panel-600',
              )}
            >
              {cell.value}
            </button>
          ))}
        </div>
        <Slider
          label="Side margins"
          value={style.marginLeft}
          min={0}
          max={400}
          onChange={(value) => set({ marginLeft: value, marginRight: value })}
        />
        <Slider
          label="Distance from edge"
          value={style.marginVertical}
          min={0}
          max={400}
          onChange={(marginVertical) => set({ marginVertical })}
        />
      </section>

      <section className="space-y-3 p-3">
        <h3 className="field-label">Line breaking</h3>
        <p className="text-2xs leading-relaxed text-ink-500">
          These limits shape how captions are cut, not just how they look. Changing them offers to re-cut the whole
          track.
        </p>
        <Slider
          label="Characters per line"
          value={style.maxCharsPerLine}
          min={12}
          max={80}
          onChange={(maxCharsPerLine) => set({ maxCharsPerLine })}
        />
        <Slider
          label="Lines per caption"
          value={style.maxLines}
          min={1}
          max={4}
          onChange={(maxLines) => set({ maxLines })}
        />
        <ResegmentPrompt maxChars={style.maxCharsPerLine} maxLines={style.maxLines} />
      </section>
    </div>
  );
}

function StyleToggleButton({
  label,
  active,
  title,
  onClick,
  bold,
  italic,
  underline,
}: {
  label: string;
  active: boolean;
  title: string;
  onClick: () => void;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={clsx(
        'h-8 flex-1 rounded border text-xs transition-colors duration-120',
        active ? 'border-accent bg-accent text-white' : 'border-panel-700 bg-panel-850 text-ink-300 hover:text-ink-100',
        bold && 'font-bold',
        italic && 'italic',
        underline && 'underline',
      )}
    >
      {label}
    </button>
  );
}

/**
 * Offer to re-cut after the line limits change.
 *
 * Changing a limit does not silently rewrite the user's captions — some have
 * hand-placed breaks worth keeping. It offers, once, and says what it will do.
 */
function ResegmentPrompt({ maxChars, maxLines }: { maxChars: number; maxLines: number }) {
  const cues = useEditorStore((state) => state.cues);
  const resegment = useEditorStore((state) => state.resegment);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const key = `${maxChars}x${maxLines}`;

  const offending = cues.filter((cue) =>
    cue.text.split('\n').some((line) => line.length > maxChars) || cue.text.split('\n').length > maxLines,
  ).length;

  if (offending === 0 || dismissedFor === key) return null;

  return (
    <div className="rounded border border-accent/40 bg-accent-soft p-2">
      <p className="text-2xs leading-relaxed text-ink-200">
        {offending} cue{offending === 1 ? '' : 's'} no longer fit these limits.
      </p>
      <div className="mt-1.5 flex gap-1.5">
        <Button size="sm" variant="primary" onClick={() => void resegment(maxChars, maxLines)}>
          Re-cut captions
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDismissedFor(key)}>
          Leave as is
        </Button>
      </div>
      <p className="mt-1 text-2xs text-ink-500">
        Re-cutting uses the original word timings, so timing stays accurate. It replaces manual line breaks.
      </p>
      <Badge tone="neutral">Undo restores them</Badge>
    </div>
  );
}
