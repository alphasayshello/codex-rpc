# Versioning

codex-rpc follows Semantic Versioning. The current release candidate is 0.3.0; the initial source version was 0.1.0.

- Patch: compatible bug fixes, parser coverage, asset corrections, docs.
- Minor: additive commands/settings/metrics and integrations. Before 1.0, breaking changes may appear in a minor with migration notes.
- Major: incompatible stable CLI, config or on-disk schema changes after 1.0.

`package.json`, `codex-rpc version`, and the optional Electron package share the release version. Aggregate schema starts at `schemaVersion: 1`; incompatible changes require an explicit migration or a documented cache rebuild. Cache files are derivable from source logs. Config and analytics survive upgrades; do not silently discard user preferences.

Prices are dated estimates and may be updated in patch releases. Asset filenames and state names are stable public interfaces. A mascot redraw preserving those names is compatible. New lifecycle log shapes are best-effort parser additions, never grounds to fabricate missing metrics.

Release checklist: regenerate assets; run `npm run check` and `npm test`; inspect the dashboard and all 19 scenes and approval waiting; run `npm pack --dry-run`; build/test SEA using an official SEA-enabled Node; update verification notes and release changes; bump all versions; commit and tag `vX.Y.Z`. Test OS-specific installers on target platforms before claiming installed-service coverage. Publish npm/packages and public Git remotes only as a separate, explicit release action. This release uses GitHub downloads only; the unscoped npm name is owned by another project. Package metadata is private to prevent accidental npm publication. See docs/RELEASE.md for archive preparation and manual publication.

The latest release receives security fixes. Older 0.x versions are not maintained separately. Keep source logs if you need to rebuild analytics after a schema migration.
