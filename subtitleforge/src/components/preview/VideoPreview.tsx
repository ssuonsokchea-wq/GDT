/**
 * The video preview and transport.
 *
 * The video element is the clock. Everything else — the playhead, the cue
 * list's highlight, the overlay — reads its `currentTime` on each animation
 * frame rather than running a timer of its own, which is what keeps the
 * caption on the frame it belongs to during a scrub.
 */

import clsx from 'clsx';
import {
  Grid2x2,
  Maximize2,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/common/Button';
import { Badge, EmptyState } from '@/components/common/Controls';
import { mediaStreamUrl } from '@/lib/api';
import { cueAt, nextCue, previousCue, speakerColor } from '@/lib/subtitleText';
import { formatResolution, formatTimecode } from '@/lib/time';
import { useEditorStore } from '@/store/useEditorStore';
import { useProjectStore } from '@/store/useProjectStore';
import { SubtitleOverlay } from './SubtitleOverlay';

export function VideoPreview() {
  const project = useProjectStore((state) => state.project);
  const cues = useEditorStore((state) => state.cues);
  const playheadMs = useEditorStore((state) => state.playheadMs);
  const playing = useEditorStore((state) => state.playing);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const setPlaying = useEditorStore((state) => state.setPlaying);

  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameHeight, setFrameHeight] = useState(360);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [safeArea, setSafeArea] = useState(false);
  const [loopCue, setLoopCue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seekingFromStore = useRef(false);

  const media = project?.media ?? null;
  const style = project?.settings.style;
  const cue = cueAt(cues, playheadMs);

  // The frame's pixel height drives the overlay's scaling.
  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setFrameHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Read the video clock on every frame while it plays.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video && !video.paused && !video.seeking) {
        setPlayhead(video.currentTime * 1000);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [setPlayhead]);

  // A playhead move from elsewhere (timeline click, cue selection) seeks.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Math.abs(video.currentTime * 1000 - playheadMs) < 120) return;
    seekingFromStore.current = true;
    video.currentTime = playheadMs / 1000;
  }, [playheadMs]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => setPlaying(false));
    else video.pause();
  }, [setPlaying]);

  // The space bar is handled globally, so it works wherever focus is as long
  // as the user is not typing. The preview owns the element, so it listens.
  useEffect(() => {
    const handler = () => togglePlay();
    document.addEventListener('sf:toggle-play', handler);
    return () => document.removeEventListener('sf:toggle-play', handler);
  }, [togglePlay]);

  // Loop the cue under the playhead — how you judge whether timing reads well.
  useEffect(() => {
    if (!loopCue || !cue) return;
    const video = videoRef.current;
    if (!video) return;
    const check = window.setInterval(() => {
      if (video.currentTime * 1000 > cue.endMs) video.currentTime = cue.startMs / 1000;
    }, 60);
    return () => window.clearInterval(check);
  }, [loopCue, cue]);

  if (!project) {
    return (
      <EmptyState
        title="No project open"
        message="Create a project or open a recent one from the panel on the left. Everything from here on happens on this computer."
      />
    );
  }

  if (!media) {
    return (
      <EmptyState
        title="No video in this project"
        message="Import an MP4, MOV, MKV, AVI or WEBM file to see it here."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={frameRef} className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        <div className="relative h-full w-full">
          <video
            ref={videoRef}
            src={mediaStreamUrl(media.id)}
            className="h-full w-full object-contain"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onSeeked={() => {
              seekingFromStore.current = false;
              const video = videoRef.current;
              if (video) setPlayhead(video.currentTime * 1000);
            }}
            onError={() =>
              setError(
                media.exists === false
                  ? 'The video file has moved. Use Relink in the project panel.'
                  : 'This video could not be decoded for preview. Burning subtitles still works — FFmpeg reads more formats than the preview can.',
              )
            }
            onClick={togglePlay}
            preload="auto"
            playsInline
          />
          {style ? (
            <SubtitleOverlay
              cue={cue}
              style={style}
              containerHeight={frameHeight}
              showSafeArea={safeArea}
              showSpeaker={Boolean(cue?.speaker)}
              speakerColor={speakerColor(cue?.speaker, project.speakers.map((s) => ({ label: s.label, color: s.color })))}
            />
          ) : null}
          {error ? (
            <div className="absolute inset-x-4 bottom-4 rounded border border-signal-warn/40 bg-panel-900/95 p-3 text-xs text-signal-warn">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-panel-750 bg-panel-900 px-3">
        <IconButton
          label="Previous cue"
          onClick={() => {
            const target = previousCue(cues, playheadMs);
            if (target) setPlayhead(target.startMs);
          }}
        >
          <SkipBack className="h-4 w-4" />
        </IconButton>
        <IconButton label={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={togglePlay}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </IconButton>
        <IconButton
          label="Next cue"
          onClick={() => {
            const target = nextCue(cues, playheadMs);
            if (target) setPlayhead(target.startMs);
          }}
        >
          <SkipForward className="h-4 w-4" />
        </IconButton>

        <span className="ml-1 font-mono text-xs tabular-nums text-ink-200">{formatTimecode(playheadMs)}</span>
        <span className="font-mono text-2xs text-ink-500">/ {formatTimecode(media.duration_ms ?? 0)}</span>

        <div className="mx-auto flex items-center gap-2">
          {cue ? (
            <Badge tone={cue.cps > 27 ? 'error' : cue.cps > 21 ? 'warn' : 'ok'} title="Reading speed of the cue on screen">
              {cue.cps} cps
            </Badge>
          ) : (
            <span className="text-2xs text-ink-500">no caption at the playhead</span>
          )}
        </div>

        <IconButton
          label={loopCue ? 'Stop looping this cue' : 'Loop the cue at the playhead'}
          onClick={() => setLoopCue((value) => !value)}
          className={clsx(loopCue && 'bg-accent-soft text-accent-hover')}
        >
          <Repeat className="h-4 w-4" />
        </IconButton>
        <IconButton
          label={safeArea ? 'Hide safe areas' : 'Show title-safe guides'}
          onClick={() => setSafeArea((value) => !value)}
          className={clsx(safeArea && 'bg-accent-soft text-accent-hover')}
        >
          <Grid2x2 className="h-4 w-4" />
        </IconButton>
        <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted((value) => !value)}>
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </IconButton>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          aria-label="Volume"
          className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-panel-750 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink-300"
        />
        <span className="hidden font-mono text-2xs text-ink-500 xl:inline">
          {formatResolution(media.width, media.height)} · {media.fps ? `${media.fps.toFixed(2)} fps` : 'fps unknown'}
        </span>
        <IconButton label="Full screen" onClick={() => void window.sf.window.control('fullscreen')}>
          <Maximize2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}
