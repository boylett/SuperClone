# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.5] - 2026-05-15

### Changed

- README images now load from the public [boylett.github.io](https://github.com/boylett/boylett.github.io/tree/assets) `assets` branch (was the previous repo's raw URLs)

## [0.0.4] - 2026-05-15

### Changed

- README images now reference absolute `raw.githubusercontent.com` URLs so they render on the VS Code Marketplace page (vsce's relative-path rewriter skips over `<img>` tags inside HTML block elements like `<div align="center">`)

## [0.0.3] - 2026-05-13

### Changed

- Aligned README, CHANGELOG, and `package.json` structure with the other extensions in this collection

## [0.0.2] - 2026-04-30

### Added

- GitHub repository picker with search, powered by VS Code's built-in GitHub authentication
- Clones all branches of a repository into individual folders
- Opens all cloned branches together as a VS Code multi-folder workspace
- Progress notification with per-branch status and a progress bar driven by received object count

[Unreleased]: https://github.com/boylett/SuperClone/compare/v0.0.5...HEAD
[0.0.5]: https://github.com/boylett/SuperClone/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/boylett/SuperClone/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/boylett/SuperClone/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/boylett/SuperClone/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/boylett/SuperClone/releases/tag/v0.0.1
