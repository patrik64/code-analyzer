# Code Analyzer

A local SvelteKit application that analyses a JavaScript / TypeScript project folder and turns the
result into an interactive report: code metrics per file, an import graph, external dependency usage,
git history statistics and quality hotspots.

Parsing is done with [tree-sitter](https://tree-sitter.github.io/) (native Node bindings with the
official JavaScript and TypeScript grammars); charts are rendered with [Chart.js](https://www.chartjs.org/).

## Running it

```sh
pnpm install
pnpm run dev --open
```

Enter the absolute path of a project on this machine, pick it from the folder list, or press
**Browse…** to choose it with the operating system's folder dialog, then press **Analyze**.
The analysis runs on the server side (the dev server or the built Node server), so it only works
for folders the machine running the app can read. The folder dialog likewise opens on the machine
running the app (macOS via AppleScript, Linux via `zenity` or `kdialog`, Windows via PowerShell) and
is therefore only offered to a browser on that same machine, via `localhost`.

For a production build:

```sh
pnpm run build
node build          # serves on http://localhost:3000
```

The report is also available as JSON: `GET /api/analyze?path=/abs/path/to/project` (add `&refresh=1`
to bypass the 10 minute in-memory cache). While an analysis runs, its progress is streamed as
server-sent events from `GET /api/analyze/progress?path=/abs/path/to/project` (one JSON object per
event: phase, label, overall fraction and, where known, items done / total); the home page's progress
bar is driven by it.

## What is analysed

**Files** — every `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, `.tsx` file, plus the
`<script>` blocks of `.svelte` and `.vue` components. Files are discovered through `git ls-files`
(so `.gitignore` is respected) and fall back to a directory walk for folders that are not git
repositories. `node_modules`, build output and similar folders are always skipped. Minified bundles
and files over 3 MB are counted but not parsed.

**Per file** — lines (total, code, comment-only, blank), functions (name, kind, line range, parameter
count, cyclomatic complexity, async/exported), classes, imports (static, dynamic, `require`,
re-exports; resolved to project files, external packages, Node built-ins or assets), exports, nesting
depth, TypeScript type definitions, JSX elements, `any` usage, `@ts-ignore` directives, `console`
calls, TODO/FIXME markers and tree-sitter syntax errors.

**Import graph** — vertices are files, edges are import directives. Relative paths, tsconfig
`paths`/`baseUrl`, package.json `imports` (`#lib/*`), SvelteKit `$lib`, and common aliases such as
`@/` are resolved. The report shows hubs (most imported), entry points, orphans, strongly connected
components (circular dependencies) and unresolved imports, and can overlay external packages.

**Dependencies** — external packages ranked by import count, cross-referenced with `package.json`
(declared but never imported, imported but not declared, devDependencies used by source files,
Node built-ins, framework virtual modules).

**Git** — commits over time, lines added/deleted, contributors (commits, churn, files touched and
owned, active days), weekday × hour activity heatmap, most changed files, recent commits, repository
age, tags, uncommitted changes and knowledge-concentration indicators (single-author files, top
contributor share). When the analysed folder is a sub-directory of a repository the history is
scoped to that folder.

**Hotspots & quality** — files that are both complex and frequently changed, longest and most
complex functions, deep nesting, many-parameter functions, `any` usage, suppressed type errors,
leftover `console` calls and TODOs.

## Project layout

```
src/lib/server/analyzer/   server-only analysis pipeline
  scan.ts        file discovery (git ls-files / directory walk)
  parser.ts      tree-sitter parser setup
  metrics.ts     AST walk: functions, imports, complexity, comments…
  resolve.ts     import specifier → file / package resolution (tsconfig paths, aliases)
  graph.ts       dependency graph, degrees, Tarjan SCC
  git.ts         git log parsing and aggregation
  project.ts     package.json, frameworks, config files
  index.ts       orchestration and summary
  progress.ts    phase weights / labels behind the progress stream
  service.ts     caching layer and progress fan-out used by the routes
src/lib/server/dialog.ts   the operating system's folder picker, behind /api/choose-folder
src/lib/components/        Chart.js wrapper, force-directed graph (d3-force), treemap, heatmap, table
src/routes/                home page (folder picker with live progress bar) and /report/* tabs
src/routes/api/            /api/analyze, /api/browse and /api/choose-folder JSON endpoints, /api/analyze/progress (SSE)
```

## Notes

* Cyclomatic complexity counts `if`, loops, `case`, `catch`, ternaries and `&&` / `||` / `??`
  operators; each function starts at 1. The file total also includes module-level branches.
* Comment lines are lines containing nothing but comments; a trailing comment on a code line
  counts as code.
* Circular-dependency detection ignores type-only imports because TypeScript erases them.
* Git history is capped at the most recent 25,000 commits and file discovery at 15,000 files
  (both reported as warnings when hit).
