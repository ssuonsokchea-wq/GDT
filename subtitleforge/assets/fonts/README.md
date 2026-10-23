# Bundled fonts

Two font files belong here. They are not in version control: both are
redistributable, but a repository is a poor place for binaries that change on
someone else's release schedule.

| File | Family | Source | Licence |
| --- | --- | --- | --- |
| `Inter-Variable.woff2` | Inter | <https://github.com/rsms/inter/releases> (`Inter.var.woff2`) | SIL Open Font License 1.1 |
| `JetBrainsMono-Variable.woff2` | JetBrains Mono | <https://github.com/JetBrains/JetBrainsMono/releases> | SIL Open Font License 1.1 |

Download both, rename them to the names above, and place them in this folder
before `npm run build`. Without them the interface falls back to the system
sans and monospace faces: it is legible, and slightly less even in its
spacing.

Fonts for *subtitles* are a separate question. The styling presets name Arial,
Roboto, Montserrat, Georgia and Inter; libass resolves them from the operating
system's installed fonts at render time, and the Style panel warns when the
machine has no font by the name the style asks for. To guarantee a look across
machines, drop the subtitle font's `.ttf` or `.otf` into this folder as well —
`electron-builder.yml` copies them into the packaged application, and the
renderer passes the folder to FFmpeg as `fontsdir`.
