/**
 * Jobs and batches.
 *
 * The store listens to one event stream and keeps a map of jobs, so the status
 * bar, the queue panel and the batch list all read the same truth. Completion
 * of a job is also where follow-up work happens: a finished transcription
 * reloads the track, a finished waveform reloads the timeline.
 */

import { create } from 'zustand';
import { api } from '@/lib/api';
import { eventStream } from '@/lib/events';
import type { Batch, Job } from '@/types/api';
import { useAppStore } from './useAppStore';
import { useEditorStore } from './useEditorStore';
import { useProjectStore } from './useProjectStore';

interface JobState {
  jobs: Record<string, Job>;
  batches: Batch[];
  attach: () => () => void;
  refresh: () => Promise<void>;
  refreshBatches: () => Promise<void>;
  cancel: (jobId: string) => Promise<void>;
  cancelBatch: (batchId: string) => Promise<void>;
  activeJobs: () => Job[];
  jobOfType: (type: Job['type']) => Job | null;
}

const FRIENDLY: Record<Job['type'], string> = {
  probe: 'Reading video',
  extract_audio: 'Extracting audio',
  waveform: 'Analysing audio',
  transcribe: 'Generating subtitles',
  enhance: 'Enhancing text',
  export_subtitles: 'Exporting subtitles',
  render: 'Burning subtitles',
  batch_item: 'Batch item',
};

export function jobLabel(job: Job): string {
  return FRIENDLY[job.type] ?? job.type;
}

export const useJobStore = create<JobState>((set, get) => ({
  jobs: {},
  batches: [],

  attach() {
    void get().refresh();
    return eventStream.subscribe((event) => {
      if (event.type === 'hello') {
        void get().refresh();
        return;
      }
      if (event.type === 'job.progress') {
        const existing = get().jobs[event.jobId];
        if (!existing) return;
        set((state) => ({
          jobs: {
            ...state.jobs,
            [event.jobId]: { ...existing, progress: event.progress, stage: event.stage ?? existing.stage },
          },
        }));
        return;
      }
      if (event.type === 'batch.finished') {
        void get().refreshBatches();
        return;
      }
      if ('job' in event) {
        const job = event.job;
        set((state) => ({ jobs: { ...state.jobs, [job.id]: job } }));
        if (event.type === 'job.succeeded') void onSucceeded(job);
        if (event.type === 'job.failed') onFailed(job);
        if (job.batch_id) void get().refreshBatches();
      }
    });
  },

  async refresh() {
    try {
      const { jobs } = await api.listJobs();
      set({ jobs: Object.fromEntries(jobs.map((job) => [job.id, job])) });
    } catch {
      // The status bar simply shows nothing until the backend answers.
    }
  },

  async refreshBatches() {
    try {
      const { batches } = await api.listBatches();
      set({ batches });
    } catch {
      /* ignored */
    }
  },

  async cancel(jobId) {
    try {
      const job = await api.cancelJob(jobId);
      set((state) => ({ jobs: { ...state.jobs, [job.id]: job } }));
    } catch (error) {
      useAppStore.getState().reportError(error, 'Could not cancel that job');
    }
  },

  async cancelBatch(batchId) {
    try {
      await api.cancelBatch(batchId);
      await get().refreshBatches();
    } catch (error) {
      useAppStore.getState().reportError(error, 'Could not cancel the batch');
    }
  },

  activeJobs() {
    return Object.values(get().jobs)
      .filter((job) => job.status === 'running' || job.status === 'queued')
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  },

  jobOfType(type) {
    return (
      Object.values(get().jobs)
        .filter((job) => job.type === type && (job.status === 'running' || job.status === 'queued'))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
    );
  },
}));

async function onSucceeded(job: Job): Promise<void> {
  const app = useAppStore.getState();
  const projects = useProjectStore.getState();
  const result = (job.result_json ?? {}) as Record<string, unknown>;

  switch (job.type) {
    case 'transcribe': {
      await projects.refresh();
      const trackId = result['trackId'] as string | undefined;
      if (trackId) await projects.selectTrack(trackId);
      const cueCount = result['cueCount'] as number | undefined;
      const quality = result['quality'] as { averageCps?: number } | undefined;
      app.notify({
        kind: 'success',
        title: 'Subtitles ready',
        message: `${cueCount ?? 0} cues at ${quality?.averageCps ?? 0} characters per second, ${
          result['model'] ?? 'unknown model'
        } on ${result['device'] ?? 'cpu'}.`,
      });
      break;
    }
    case 'enhance': {
      const trackId = useEditorStore.getState().trackId;
      if (trackId) await useEditorStore.getState().loadTrack(trackId);
      app.notify({ kind: 'success', title: `Enhanced ${result['changed'] ?? 0} cues` });
      break;
    }
    case 'waveform': {
      await projects.loadWaveform();
      break;
    }
    case 'export_subtitles':
    case 'render': {
      const output = result['output_path'] as string | undefined;
      const fellBack = result['fellBackToSoftware'] === true;
      app.notify({
        kind: 'success',
        title: job.type === 'render' ? 'Video rendered' : 'Subtitles exported',
        message: output,
        hint: fellBack ? 'The hardware encoder failed, so this was rendered in software.' : undefined,
        ...(output
          ? { action: { label: 'Show file', run: () => void window.sf.files.reveal(output) } }
          : {}),
      });
      break;
    }
    case 'extract_audio': {
      const output = result['output_path'] as string | undefined;
      app.notify({ kind: 'success', title: 'Audio extracted', message: output });
      break;
    }
    default:
      break;
  }
}

function onFailed(job: Job): void {
  if (job.type === 'waveform') return; // the timeline degrades to a plain ruler
  useAppStore.getState().notify({
    kind: 'error',
    title: `${jobLabel(job)} failed`,
    message: job.error_json?.message ?? 'No further detail.',
    hint: job.error_json?.hint ?? null,
    sticky: true,
  });
}
