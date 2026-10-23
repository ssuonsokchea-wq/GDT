/**
 * The job queue, in the corner of the project panel.
 *
 * Long work in a desktop application should be visible without being modal.
 * This shows what is running and what is waiting, with a stop button on each,
 * and collapses to a single line when nothing is happening.
 */

import clsx from 'clsx';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '@/components/common/Button';
import { ProgressBar } from '@/components/common/Controls';
import { jobLabel, useJobStore } from '@/store/useJobStore';

export function JobQueue() {
  const jobs = useJobStore((state) => state.activeJobs());
  const cancel = useJobStore((state) => state.cancel);
  const [open, setOpen] = useState(true);

  if (jobs.length === 0) {
    return <div className="px-3 py-2 text-2xs text-ink-500">No jobs running</div>;
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-panel-850"
      >
        <span className="field-label">
          {jobs.length} job{jobs.length === 1 ? '' : 's'}
        </span>
        <span className="ml-auto text-ink-500">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </span>
      </button>
      {open ? (
        <ul className="max-h-40 space-y-1.5 overflow-y-auto px-3 pb-2">
          {jobs.map((job) => (
            <li key={job.id}>
              <div className="flex items-baseline gap-2">
                <span className="truncate text-2xs text-ink-200">{jobLabel(job)}</span>
                <span className="ml-auto shrink-0 font-mono text-2xs tabular-nums text-ink-500">
                  {job.status === 'queued' ? 'queued' : `${Math.round(job.progress * 100)}%`}
                </span>
                <IconButton label="Stop this job" onClick={() => void cancel(job.id)} className="h-5 w-5">
                  <X className="h-3 w-3" />
                </IconButton>
              </div>
              <ProgressBar
                value={job.status === 'queued' ? 0 : job.progress}
                className={clsx('mt-1', job.status === 'queued' && 'opacity-40')}
              />
              {job.stage ? <p className="mt-0.5 truncate text-2xs text-ink-500">{job.stage}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
