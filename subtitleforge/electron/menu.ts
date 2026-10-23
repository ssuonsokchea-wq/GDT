/**
 * The application menu.
 *
 * Menu items send the same commands the UI's own buttons send, so a shortcut
 * and a click take exactly one code path. Items the user cannot act on yet are
 * not hidden — they are disabled by the renderer, which knows whether a
 * project is open.
 */

import { type BrowserWindow, Menu, app, shell } from 'electron';

export type MenuCommand =
  | 'project:new'
  | 'project:open'
  | 'project:save'
  | 'project:import-video'
  | 'project:import-subtitles'
  | 'export:srt'
  | 'export:vtt'
  | 'export:ass'
  | 'export:burn'
  | 'edit:undo'
  | 'edit:redo'
  | 'edit:split'
  | 'edit:merge'
  | 'transcribe:start'
  | 'enhance:run'
  | 'view:batch'
  | 'view:settings'
  | 'help:shortcuts'
  | 'help:about';

export function buildMenu(window: BrowserWindow, send: (command: MenuCommand) => void): Menu {
  const isMac = process.platform === 'darwin';
  const item = (label: string, command: MenuCommand, accelerator?: string) => ({
    label,
    accelerator,
    click: () => send(command),
  });

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.getName(),
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              item('Settings…', 'view:settings', 'Cmd+,'),
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        item('New project', 'project:new', 'CmdOrCtrl+N'),
        item('Open project…', 'project:open', 'CmdOrCtrl+O'),
        item('Save project', 'project:save', 'CmdOrCtrl+S'),
        { type: 'separator' },
        item('Import video…', 'project:import-video', 'CmdOrCtrl+I'),
        item('Import subtitles…', 'project:import-subtitles', 'CmdOrCtrl+Shift+I'),
        { type: 'separator' },
        {
          label: 'Export',
          submenu: [
            item('SRT…', 'export:srt'),
            item('WebVTT…', 'export:vtt'),
            item('ASS…', 'export:ass'),
            { type: 'separator' },
            item('Video with burned subtitles…', 'export:burn', 'CmdOrCtrl+Shift+E'),
          ],
        },
        { type: 'separator' },
        ...(isMac ? [] : [item('Settings…', 'view:settings', 'Ctrl+,'), { type: 'separator' as const }]),
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        item('Undo', 'edit:undo', 'CmdOrCtrl+Z'),
        item('Redo', 'edit:redo', isMac ? 'Shift+Cmd+Z' : 'Ctrl+Y'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        item('Split cue at playhead', 'edit:split', 'CmdOrCtrl+Shift+S'),
        item('Merge selected cues', 'edit:merge', 'CmdOrCtrl+Shift+M'),
      ],
    },
    {
      label: 'Subtitles',
      submenu: [
        item('Generate subtitles…', 'transcribe:start', 'CmdOrCtrl+G'),
        item('Enhance text', 'enhance:run', 'CmdOrCtrl+E'),
        { type: 'separator' },
        item('Batch processing', 'view:batch', 'CmdOrCtrl+B'),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'help',
      submenu: [
        item('Keyboard shortcuts', 'help:shortcuts', 'CmdOrCtrl+/'),
        item('About SubtitleForge AI', 'help:about'),
        { type: 'separator' },
        {
          label: 'Open logs folder',
          click: () => void shell.openPath(app.getPath('logs')),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  void window;
  return menu;
}
