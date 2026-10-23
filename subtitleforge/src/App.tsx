/**
 * The application.
 *
 * It wires four things together and then stays out of the way: the backend
 * connection, the event stream, the keyboard, and the native menu. Every
 * menu item maps onto the same action a button in the interface calls, so
 * there is one code path per operation.
 */

import { useEffect } from 'react';
import { Spinner } from '@/components/common/Button';
import { Toasts } from '@/components/common/Toasts';
import { AppShell } from '@/components/layout/AppShell';
import { RightPanel } from '@/components/layout/RightPanel';
import { StatusBar } from '@/components/layout/StatusBar';
import { TitleBar } from '@/components/layout/TitleBar';
import { ProjectPanel } from '@/components/panels/ProjectPanel';
import { VideoPreview } from '@/components/preview/VideoPreview';
import { Timeline } from '@/components/timeline/Timeline';
import { BatchDialog } from '@/components/dialogs/BatchDialog';
import { ExportDialog } from '@/components/dialogs/ExportDialog';
import { AboutDialog, ShortcutsDialog } from '@/components/dialogs/HelpDialogs';
import { ProjectsDialog } from '@/components/dialogs/ProjectsDialog';
import { SettingsDialog } from '@/components/dialogs/SettingsDialog';
import { TranscribeDialog } from '@/components/dialogs/TranscribeDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { api } from '@/lib/api';
import { useAppStore } from '@/store/useAppStore';
import { useEditorStore } from '@/store/useEditorStore';
import { useJobStore } from '@/store/useJobStore';
import { useProjectStore } from '@/store/useProjectStore';

export function App() {
  const backend = useAppStore((state) => state.backend);
  const dialog = useAppStore((state) => state.dialog);
  const openDialog = useAppStore((state) => state.openDialog);

  useKeyboardShortcuts();

  useEffect(() => {
    void useAppStore.getState().initialise();
    return useJobStore.getState().attach();
  }, []);

  useEffect(() => {
    return window.sf.menu.onCommand(async (command) => {
      const projects = useProjectStore.getState();
      const editor = useEditorStore.getState();
      const app = useAppStore.getState();
      switch (command) {
        case 'project:new':
          await projects.newProject();
          break;
        case 'project:open':
          app.openDialog('projects');
          break;
        case 'project:save':
          await projects.saveBundle();
          break;
        case 'project:import-video': {
          const paths = await window.sf.dialog.openVideos();
          if (paths.length === 1) await projects.importVideo(paths[0]!);
          else if (paths.length > 1) app.openDialog('batch');
          break;
        }
        case 'project:import-subtitles': {
          const path = await window.sf.dialog.openSubtitles();
          if (path) await projects.importSubtitleFile(path);
          break;
        }
        case 'export:srt':
        case 'export:vtt':
        case 'export:ass':
        case 'export:burn':
          app.openDialog('export');
          break;
        case 'edit:undo':
          editor.undo();
          break;
        case 'edit:redo':
          editor.redo();
          break;
        case 'edit:split':
          await editor.splitAtPlayhead();
          break;
        case 'edit:merge':
          await editor.mergeSelected();
          break;
        case 'transcribe:start':
          app.openDialog('transcribe');
          break;
        case 'enhance:run':
          if (editor.trackId) {
            await editor.flush();
            await api.enhance({ trackId: editor.trackId });
          }
          break;
        case 'view:batch':
          app.openDialog('batch');
          break;
        case 'view:settings':
          app.openDialog('settings');
          break;
        case 'help:shortcuts':
          app.openDialog('shortcuts');
          break;
        case 'help:about':
          app.openDialog('about');
          break;
        default:
          break;
      }
    });
  }, []);

  // Save any pending edit before the window closes. The debounce means a
  // keystroke can be in flight when the user hits the close button.
  useEffect(() => {
    const flush = () => void useEditorStore.getState().flush();
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  if (backend.state === 'starting' || backend.state === 'restarting') {
    return <Starting status={backend} />;
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <AppShell left={<ProjectPanel />} center={<VideoPreview />} timeline={<Timeline />} right={<RightPanel />} />
      <StatusBar />

      <TranscribeDialog open={dialog === 'transcribe'} onClose={() => openDialog(null)} />
      <ExportDialog open={dialog === 'export'} onClose={() => openDialog(null)} />
      <BatchDialog open={dialog === 'batch'} onClose={() => openDialog(null)} />
      <SettingsDialog open={dialog === 'settings'} onClose={() => openDialog(null)} />
      <ProjectsDialog open={dialog === 'projects'} onClose={() => openDialog(null)} />
      <ShortcutsDialog open={dialog === 'shortcuts'} onClose={() => openDialog(null)} />
      <AboutDialog open={dialog === 'about'} onClose={() => openDialog(null)} />
      <Toasts />
    </div>
  );
}

function Starting({ status }: { status: { state: string; attempt?: number; reason?: string } }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-panel-950">
      <Spinner className="h-6 w-6 text-accent" />
      <div className="text-center">
        <p className="text-sm text-ink-200">
          {status.state === 'restarting' ? 'Restarting the subtitle engine' : 'Starting the subtitle engine'}
        </p>
        <p className="mt-1 max-w-sm text-2xs leading-relaxed text-ink-500">
          {status.state === 'restarting'
            ? `${status.reason ?? ''} Attempt ${status.attempt ?? 1}.`
            : 'Loading the local speech and video engine. Nothing leaves this computer.'}
        </p>
      </div>
      <Toasts />
    </div>
  );
}
