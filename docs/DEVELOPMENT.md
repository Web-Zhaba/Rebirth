# Development and release flow

Rebirth uses a two-level branch model:

```
feature/* -> dev -> main -> GitHub Release -> Vercel Production
```

## Branches

- `main` is release-only. A merge to `main` is a production release candidate and triggers the production deployment on Vercel.
- `dev` is the integration branch for ongoing development.
- Work branches such as `feature/*`, `fix/*`, `perf/*`, and experimental branches should target `dev`.

Do not push day-to-day work directly to `main`.

## Vercel deployment budget

Automatic Preview Deployments are disabled for the Rebirth Vercel project. This is intentional: pushes to `dev` and work branches must not consume the daily deployment quota.

Production deployments remain tied to `main`. Preview deployments should be created manually only when a browser-accessible preview is actually needed.

## Pull requests

1. Create a work branch from `dev`.
2. Open a PR into `dev`.
3. CI must pass: tests and production build.
4. Prefer squash-merging work PRs into `dev`, using a Conventional Commit style PR title.
5. When `dev` is ready to release, open a PR from `dev` to `main`.
6. Merge `dev` into `main` with a regular merge commit rather than squash, so the individual Conventional Commits remain visible to Release Please.

## Commit convention

Use Conventional Commits. Prefer scopes for project areas rather than inventing new commit types.

Examples:

```
feat(map): add terrain quality selector
fix(terrain): prevent freeze around zoom 12.5
perf(water): reduce mesh allocations
refactor(rendering): split terrain pipeline
docs: update development guide
test(terrain): cover tile transition edge case
build: update Vite configuration
chore: update tooling
```

Versioning rules:

- `fix` -> patch
- `feat` -> minor
- `BREAKING CHANGE` or `!` -> major

## Releases

Release Please watches `main`. It maintains a release PR with the next version and `CHANGELOG.md`. Merging that release PR creates the Git tag and GitHub Release, and then runs the publish (below).

The repository starts from version `0.0.0`; the first releasable Conventional Commit will establish the first development release (for example, a feature normally leads to `0.1.0`).

## Publishing

One release goes to every portal under one version number (`package.json`, shown in «Об игре»). Each portal gets its
own build: `vite build --mode <portal>` reads `.env.<portal>` and picks the adapter in `src/platform`; the standalone
build (site, itch.io) has none. `scripts/pack.mjs <portal> <dir> [zip]` checks a build against that portal's archive
rules and writes the zip.

| Portal | Build | How it goes up |
|---|---|---|
| Site (Vercel) | `npm run build` | Vercel deploys `main` itself. |
| itch.io | `npm run build:itch` | `publish.yml` pushes it with butler. |
| Yandex Games | `npm run build:yandex` | By hand in the console: no upload API. |
| CrazyGames | `npm run build:crazygames` | By hand in the developer portal: no upload API. |

`.github/workflows/publish.yml` runs after each release (called from `release-please.yml`; a release made with
`GITHUB_TOKEN` fires no `release` event) or by hand from the Actions tab with a tag, e.g. to publish again. It tests,
builds the three portal zips, attaches them to the GitHub release and pushes itch.io. Its run summary lists the
manual steps with links to the zips and consoles:

1. Yandex Games: console → the game → new version → upload `rebirth-yandex.zip`, version = the release number → send
   for moderation (3–5 working days; one moderation at a time).
2. CrazyGames: developer portal → the game → upload `rebirth-crazygames.zip`.

Saves live in each portal's own origin, so players never move a save between portals, but a portal under moderation
lags behind the others: a save must load in any later version, not only the next one.

### One-time setup

- **itch.io**: create the project as an HTML game, then in the repository settings add the secret `BUTLER_API_KEY`
  (itch.io → settings → API keys) and the variable `ITCH_GAME` (`user/game`, as in the project URL). After the first
  push, tick "This file will be played in the browser" on the `html5` upload. Until `ITCH_GAME` is set the push is
  skipped. To approve each push by hand, add a required reviewer to the `itch` environment.
- **CrazyGames**: `.env.crazygames` turns the rewarded-ad offers off for the Basic Launch, where the portal serves no
  ads. Delete `VITE_REWARDED_ADS=off` there for the Full Launch.

## CI

CI runs on pull requests to `dev` and `main`, and on pushes to `dev`:

```
npm ci
npm test
npm run build
```

It also builds the Yandex Games and CrazyGames targets and runs the archive checks for all three portal builds.

Node.js 24 is used to match the Vercel project runtime.
