# Tally

A simple dark-themed desktop spreadsheet, built with Electron. Sheets are plain files you organise into project folders.

## What it does

- Grid of up to 2,000 rows by 702 columns (A to ZZ), with cell and range selection, keyboard navigation, and copy, cut, paste and clear.
- Formulas typed with a leading `=`: `ADD`, `SUBTRACT`, `MULTIPLY` and `DIVIDE`, with cell references (for example `=ADD(A1,B1)`). Errors such as `#DIV/0!`, `#REF!` and `#NAME?` are shown in the cell.
- Number formats: General, Time, Date, Date + Time, and currency (USD, CAD, EUR, GBP) with 0, 1 or 2 decimals.
- Cell styling: text alignment, font size, fill colour and font colour.
- A project sidebar: add folders as projects, create subfolders and sheets, and open sheets from the tree.
- File menu with New/Open/Save/Save As for sheets and projects, and a prompt before closing with unsaved changes.

Not built: charts, undo/redo, other file formats such as CSV or XLSX, and formulas beyond the four above.

## Getting started

Prerequisites: [Node.js](https://nodejs.org/) and npm.

```
npm install
npm start
```

To package a Windows (x64) build into `dist/`:

```
npm run pack
```

The pack script targets `win32` only; edit the `pack` script in `package.json` for other platforms.

## Where files are stored

- Each sheet is a `.sheet` file (JSON: `{ "version": 1, "cells": { ... } }`) that you save wherever you choose.
- A project is any folder you open or create from the File menu. Tally lists its subfolders and `.sheet` files in the sidebar; it does not move or copy them.
- The list of open projects is kept in `config.json` in Electron's per-user data folder for the app (on Windows, under `%APPDATA%`).

## Tech stack

Electron, with a plain HTML, CSS and JavaScript interface (no framework, no bundler). `@electron/packager` is used for packaging.

## Shortcuts

Ctrl+N new sheet, Ctrl+Shift+N new project, Ctrl+O open sheet, Ctrl+Shift+O open project, Ctrl+S save, Ctrl+Shift+S save as, Ctrl+Q quit.

## Status

Version 1.0.0, early and small in scope. It has only been set up for Windows packaging; no tests are included.
