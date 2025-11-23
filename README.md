# Billflow

Billflow is a personal budgeting companion that visualizes recurring expenses and income on an interactive calendar. It helps you understand what is due before your next paycheck, see weekly exposure, and log income or expenses from a single screen.

## Architecture Overview

- **Vite + React + TypeScript** – the UI is a single-page React app bootstrapped by Vite for fast local development and bundling.
- **Persistent local state** – the custom `usePersistentState` hook mirrors React state into `localStorage`, keeping bills, income, overrides, payments, and section collapse states durable across reloads.
- **Domain models** – Bills and income entries are normalized and expanded per visible month; helper utilities (e.g., `expandIncomeEntry`, `isBillDueInMonth`) control scheduling logic.
- **Collapsible views** – `CollapsibleSection` renders reusable cards for the calendar, income summary, weekly breakdown, forms, etc.
- **Mobile-first calendar** – the redesigned calendar shows iOS-like day cells with colored dots (amber for due, emerald for paid) and an income dot, and opens a modal with per-day details, editing shortcuts, and mark-paid controls.
- **Form flows** – expense and income forms support editing existing entries; editing routes through the modal to these forms with smooth scrolling.

## Tech Stack

| Layer | Tooling / Version |
| --- | --- |
| Language | TypeScript 5.9.x |
| Framework | React 19.1.1, React DOM 19.1.1 |
| Bundler/Dev Server | Vite 7.1.7 |
| Styling | Tailwind CSS 4.1.x via `@tailwindcss/postcss`, PostCSS 8.5.x, Autoprefixer 10.4.x |
| Linting | ESLint 9.36 + React Hooks / React Refresh plugins |
| Deployment | `gh-pages` (deploys `dist/` to GitHub Pages) |

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server
npm run dev
# Vite prints the local/Network URLs; open the local URL in a browser.

# 3. Lint (optional but recommended)
npm run lint

# 4. Build for production
npm run build

# 5. Preview the production build locally
npm run preview
```

To deploy to GitHub Pages, run `npm run deploy` (which builds + pushes `dist/` via `gh-pages`).

## Changelog (Lite)

- **2026-02-??** – Rebuilt the calendar to mirror iOS aesthetics, swapped bill text for dots, and added a per-day modal for expense/income review with edit/mark-paid controls. Also introduced income editing support and scroll-to-section helpers.
- **2026-02-??** – Renamed “Before Next Income” → “Due This Pay Period”, promoted the “Upcoming income” label, tweaked total-due colors, and added jump links from the overview cards.
- **Initial** – Added budgeting dashboard with collapsible overview, weekly totals, bill + income forms, and GitHub Pages deploy script.

> _Note: replace `??` with the actual date when you lock a release._

## Testing

No automated tests exist yet. Use `npm run lint` for static checks and manually verify key flows (calendar interactions, modal editing, add/edit/delete for bills and income) before shipping changes.

