/**
 * The caption overlay.
 *
 * It draws the current cue over the video using CSS the backend derived from
 * the same style object it will hand to libass. That is the reason the preview
 * can be trusted: both sides read one model, and the translation into CSS lives
 * in the backend next to the translation into ASS, so the two cannot drift.
 *
 * Sizes are expressed against a 1080-pixel reference frame and scaled to the
 * element's real height, so the preview matches the burned output at any
 * window size.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { wrapPreview } from '@/lib/subtitleText';
import type { Cue, SubtitleStyle } from '@/types/api';

interface Props {
  cue: Cue | null;
  style: SubtitleStyle;
  containerHeight: number;
  showSafeArea?: boolean;
  speakerColor?: string;
  showSpeaker?: boolean;
}

export function SubtitleOverlay({
  cue,
  style,
  containerHeight,
  showSafeArea,
  speakerColor,
  showSpeaker,
}: Props) {
  const css = useStyleCss(style, containerHeight);

  const lines = useMemo(() => {
    if (!cue?.text.trim()) return [];
    // Honour the author's own line breaks; wrap only what has none.
    return cue.text.includes('\n')
      ? cue.text.split('\n')
      : wrapPreview(cue.text, style.maxCharsPerLine, style.maxLines);
  }, [cue?.text, style.maxCharsPerLine, style.maxLines]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {showSafeArea ? <SafeArea /> : null}
      <div
        className="absolute inset-0 flex"
        style={{
          justifyContent: css.justifyContent,
          alignItems: css.alignItems,
          marginLeft: css.marginLeft,
          marginRight: css.marginRight,
          marginTop: css.marginTop,
          marginBottom: css.marginBottom,
          flexDirection: 'column',
        }}
      >
        {lines.length > 0 ? (
          <div
            className="max-w-full text-center"
            style={{
              fontFamily: css.fontFamily,
              fontSize: css.fontSize,
              fontWeight: css.fontWeight,
              fontStyle: css.fontStyle,
              textDecoration: css.textDecoration,
              letterSpacing: css.letterSpacing,
              textTransform: css.textTransform as 'none' | 'uppercase',
              transform: css.transform,
              lineHeight: 1.22,
            }}
          >
            {showSpeaker && cue?.speaker ? (
              <div
                className="mb-1 text-center font-semibold"
                style={{ color: speakerColor ?? '#38BDF8', fontSize: `calc(${css.fontSize} * 0.62)` }}
              >
                {cue.speaker}
              </div>
            ) : null}
            {lines.map((line, index) => (
              <div
                key={`${index}-${line}`}
                style={{
                  color: css.color,
                  textShadow: css.textShadow,
                  backgroundColor: css.backgroundColor,
                  padding: css.padding,
                  display: 'inline-block',
                  // Each line gets its own box so a background box hugs the
                  // text, exactly as libass draws BorderStyle 3.
                  marginBottom: '0.08em',
                }}
              >
                {line}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Title-safe and action-safe guides.
 *
 * The 10% / 5% insets broadcasters use. They matter to anyone cutting for a
 * platform that overlays its own interface — a caption inside TikTok's bottom
 * third is hidden behind the description, and this is where you see that.
 */
function SafeArea() {
  return (
    <>
      <div className="absolute inset-[5%] border border-dashed border-white/15" />
      <div className="absolute inset-[10%] border border-dashed border-white/25" />
      <span className="absolute left-[10%] top-[10%] -translate-y-full pb-1 text-[10px] text-white/40">
        title safe
      </span>
    </>
  );
}

/**
 * Ask the backend to translate the style into CSS.
 *
 * Debounced, because the style panel's sliders fire continuously and the
 * translation is a round trip. Between replies the last CSS stays on screen,
 * so dragging a slider looks smooth rather than flickering to a default.
 */
function useStyleCss(style: SubtitleStyle, containerHeight: number): Record<string, string> {
  const [css, setCss] = useState<Record<string, string>>({});
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    const timer = window.setTimeout(async () => {
      try {
        const preview = await api.stylePreview(style, Math.max(240, Math.round(containerHeight)));
        if (request === latest.current) setCss(preview.css);
      } catch {
        // Keep the previous CSS; a failed preview must not blank the overlay.
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [style, containerHeight]);

  return css;
}
