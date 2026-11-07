# TNCraft — Offline OMR Exam Grader PWA

**TNCraft** is an offline-capable Progressive Web App (PWA) built for iPhone and mobile browsers to design printable bubble sheets, scan and grade multiple-choice exams with the device camera, analyze item statistics, and export spreadsheets—100% on-device with zero backend servers.

## Features

- **Calibrated Printable Answer Sheets (A4 PNG & AirPrint)**
  - Standard sheets: **20, 40, 50, 60, 100, and 120 questions** (4 choices A–D or 5 choices A–E)
  - **BGD-2025 3-Part Sheet**: Part I multiple choice (up to 40), Part II 4-statement True/False (up to 8 with configurable 1/2/3/4-correct weights), Part III numeric short answers with minus & decimal comma bubbles (up to 6), plus optional Part IV essay score
  - Configurable **6- or 8-digit Student ID (SBD)** and **3- or 4-digit Exam Code**
- **On-Device Camera OMR Engine**
  - Bradley-Roth integral-image adaptive thresholding for uneven lighting and shadows
  - 4-corner square fiducial detection and 8-DOF homography perspective rectification
  - Adjustable pencil-erase smudge filtering and live auto-capture lock
  - Annotated visual review overlay + manual bubble/score repair
- **Classes, Answer Keys & Analytics**
  - Multi-code answer keys via manual grid, CSV import, or QR code sharing
  - Class rosters with automatic Student ID matching
  - Score distributions, item difficulty/discrimination analysis, and `.xls` / UTF-8 `.csv` export
- **100% Private & Offline**
  - Works completely offline once added to the iPhone Home Screen (`localStorage` + `IndexedDB` + Service Worker cache)

## Install on iPhone (Safari)

1. Open the live GitHub Pages URL in **Safari** on your iPhone.
2. Tap the **Share** button at the bottom of Safari.
3. Tap **Add to Home Screen** → **Add**.

## Local Development

```bash
npm install
npm test
npm run dev
```

Build for production:

```bash
npm run build
```
