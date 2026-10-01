# Canada Pay Calculator — installable web app

This is the free browser/PWA companion to the native SwiftUI application. It runs the same Manitoba payroll methodology locally and uses decimal arithmetic. It does not need an account, backend, or paid Apple developer membership. The native iOS app remains in the repository.

Annual salary and base hourly wage are visible together. Editing either updates the other using the configured weekly hours and recurring overtime. The last edited amount drives the payroll calculation; choosing an input tab alone preserves the existing estimate. Gross and net hourly equivalents average annual amounts over actual working hours, including overtime.

The top-right **ENG / 简体中文** controls switch the full interface and save your language choice locally. In Simplified Chinese, explanations appear only next to the seven contribution types inside **Pension & other deductions**, on hover, keyboard focus, or by tapping their help buttons.

**Find gross pay** is a separate calculator with its own take-home target, pay schedule, optional deductions, and result. It estimates annual gross salary for a selected paycheque, an average month, or the full year, using the existing forward payroll engine. It does not change the forward calculator's salary or deductions. Cent rounding can prevent exact matches. Extremely high percentage deductions that prevent reliable reverse estimation are reported rather than guessed.

On phones, the dark take-home card follows the income inputs immediately, before the pay schedule and optional deductions. On wider screens, it stays in the existing right-hand results column.

## Run and check locally

Install Node.js **22.12 or newer** and Python **3.10 or newer** (used to check the export of the existing Swift configuration), then run from `Web/`:

```sh
npm ci
npm run check
npm test
npm run build
npm run preview
```

The preview serves the production build at `http://127.0.0.1:4173/CanadaPayCalculator/`, including the project subpath used by GitHub Pages.

Browser integration tests run against this production build:

```sh
npx playwright install chromium
npm run test:e2e
```

To verify a deployed site with the same browser checks, set `PLAYWRIGHT_BASE_URL` to its full, slash-terminated HTTPS project URL before running `npm run test:e2e`.

On Windows, the tests use installed Chrome if available. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use a specific Chromium executable. The browser checks cover input persistence, validation, hourly pay, independent employer contributions, phone layout, installation assets, and offline reload. They complement the native regression cases ported to the Web engine. The Pages workflow runs these checks before publishing.

Open the preview URL. The development server is useful for editing, but service workers are deliberately enabled only in the production build. A service worker requires HTTPS or localhost. Opening `dist/index.html` directly with a `file:` URL does not support installation or offline caching.

The production files are in `Web/dist/`. Relative asset paths support GitHub Pages project URLs such as `https://yunfeiWu97.github.io/CanadaPayCalculator/` and other static hosts that serve the folder over HTTPS.

## Free GitHub Pages deployment

GitHub Pages is available on GitHub Free for public repositories. The repository must remain public to use that free option. [GitHub Pages availability and custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

1. Push this repository, including `Web/package-lock.json` and `.github/workflows/pages.yml`, to GitHub.
2. In the repository, open **Settings → Pages**. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Push a web change to `main`, or run **Deploy Canada Pay Calculator to GitHub Pages** manually from **Actions**.
4. Wait for the build and deploy jobs to complete. The deployment job publishes the URL in its environment output and **Settings → Pages**.
5. Visit the deployed URL once while online before using the app offline.

The workflow runs TypeScript/configuration checks, payroll/PWA tests, and production browser checks before it publishes. It uploads only `Web/dist/`, without personal settings or local development files. It requires `pages: write` and `id-token: write` in the deployment job. Repository or organization approval rules can require an administrator to enable Actions or approve the `github-pages` environment. [Configure the publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site), [official deployment workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Add to an iPhone Home Screen

1. Open the deployed HTTPS URL in **Safari**.
2. Tap **Share**. With some Safari layouts, open the **Page Menu** first, then **Share**.
3. Choose **Add to Home Screen**. If missing, use **Edit Actions** to add the action.
4. Leave **Open as Web App** enabled if Safari offers that switch, then tap **Add**.
5. Open **Canada Pay** from the Home Screen. It uses an app-style window and works offline after its first successful online load and cache installation.

These steps follow [Apple's iPhone instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios). On browsers supporting an install prompt, the app also shows an **Install** button when the browser makes it available. Safari installation is performed through the Share menu.

## Offline use and updates

A versioned service worker precaches the app HTML, bundled JavaScript/CSS, manifest, and icons. Cache names are scoped to the site's path so this project does not clear caches belonging to other sites on the same GitHub Pages origin. Navigation tries the network first and uses the cached app when offline. External government reference pages require their own internet connection and are not cached by this app.

When a new app version is ready, the app offers an update button. Updating activates the waiting worker and reloads after the user accepts. Initial installation does not force a reload. Local preferences survive app updates. Browsers can reclaim storage, especially after prolonged inactivity or when clearing website data; visit online again if the offline copy is removed.

`public/sw.js` is a build template. The production build replaces `__APP_VERSION__` with a content-derived version and `__PRECACHE_ASSETS__` with the complete relative asset list. Always deploy the built `dist/` folder, never `public/` alone. The manifest and service worker use relative scope/start paths; do not change them to `/` for a GitHub Pages project site.

## Local settings and privacy

Salary, hours, deductions, and the selected pay period are saved in this browser on this device. There are no analytics, trackers, sign-in flows, or salary uploads. GitHub Pages still serves the site and handles ordinary hosting requests. Safari and the installed Home Screen app can have separate storage depending on the iOS version; enter your settings again if needed. Clearing website data removes saved settings and the offline copy.

## Tax data and limitations

The current tax year is visible in the app. Native Swift tax configuration remains the maintained source, and the web tax-data generation/check step prevents the browser implementation from silently drifting. See the [repository README](../README.md) for authoritative CRA/Manitoba sources, assumptions, and payroll limitations. This app estimates payroll withholding for a steady full-year income schedule; it does not file a tax return or replace an employer's payroll system.

Before relying on a release, run the web checks and compare the default $65,000 semi-monthly scenario with the native reference fixture. Test installation and offline launch on a real iPhone; desktop browsers cannot establish all iOS Home Screen behavior.
