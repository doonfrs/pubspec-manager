# Pubspec Manager

Visual GUI editor for `pubspec.yaml` — browse, search, update, and manage your Dart & Flutter dependencies with ease.

## Features

- **Visual Editor** — Full GUI for editing pubspec.yaml instead of raw YAML
- **Metadata Editing** — Edit name, description, version, homepage, repository, SDK constraints
- **Dependencies View** — Visual cards showing all dependencies with version status
- **Outdated Detection** — Automatically checks pub.dev for newer versions with color-coded badges
- **One-Click Updates** — Update individual packages or all outdated packages at once
- **Search & Add** — Search pub.dev and add packages without leaving VS Code
- **Remove Packages** — Remove dependencies with one click
- **Pub Get** — Run `dart pub get` / `flutter pub get` from the toolbar
- **Round-Trip Safe** — Edits preserve your YAML comments and formatting
- **Dart & Flutter** — Auto-detects project type and uses the correct commands

## How to Use

1. Open any `pubspec.yaml` file in VS Code
2. Click the **package icon** in the editor title bar (top-right), or:
   - Right-click the file → **Open Pubspec Manager**
   - Right-click in the editor → **Open With...** → **Pubspec Manager**
3. Use the tabs to navigate between Metadata, Dependencies, Dev Dependencies, and Search

## Requirements

- VS Code 1.85.0 or later
- Dart SDK or Flutter SDK installed and available in PATH
# pubspec-manager
