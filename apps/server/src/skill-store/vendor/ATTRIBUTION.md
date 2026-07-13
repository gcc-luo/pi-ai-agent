# Vendored from `pi-skill-hub@0.3.0`

The TypeScript files under this `vendor/` directory are sourced verbatim from
the `pi-skill-hub` package (https://github.com/MasuRii/pi-skill-hub), MIT
licensed, copyright (c) 2026 MasuRii.

The upstream package only re-exports a Pi-agent extension entrypoint from its
`index.ts`, so deep imports of the pure-Node provider / download / preview
modules are not exposed via `package.json` `exports`. To reuse pi-skill-hub's
actual provider logic from this server (Node + tsx/tsc, no Pi runtime), the
relevant `.ts` files are copied here as the source of truth.

Only the files needed for search / preview / install (skills.sh + SkillsMP
providers, the skills.sh download module, the remote preview builder, and
their transitive non-Pi-runtime dependencies) are kept. The `modal/`, `ui/`,
`commands/register.ts`, `commands/runner.ts`, `commands/notify.ts`,
`commands/commands.ts`, `browser/browser-*.ts`, `browser/result-layout.ts`,
`browser/markdown-preview.ts`, and `index.ts` files from upstream are NOT
vendored — they depend on `@earendil-works/pi-tui` / `@earendil-works/pi-coding-agent`,
which this server does not host.

To update: re-extract the upstream tarball (`npm pack pi-skill-hub`), diff
against this directory, and copy in any changes that touch the vendored file
set.
