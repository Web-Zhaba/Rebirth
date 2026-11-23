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
own build: `vite build --mode <portal>` reads `env/.env.<portal>` and picks the adapter in `src/platform`; the standalone
build (site, itch.io) has none. `npm run build:portals [portal ...]` type-checks once, builds `release/<portal>/` for each
portal (all of them with no names) and packs `release/rebirth-<portal>.zip` through `scripts/pack.mjs`, which checks the
portal's archive rules and that the bundle carries its own portal's SDK and no other's: one build never talks to two
portals.

| Portal | How it goes up |
|---|---|
| Site (Vercel) | Vercel deploys `main` itself. |
| itch.io | `publish.yml` pushes it with butler. |
| Poki | `publish.yml` uploads a version with the Poki CLI; the review is requested in Poki for Developers. |
| VK Games | `publish.yml` deploys it to VK hosting. |
| Yandex Games | By hand in the console: no upload API. |
| CrazyGames | By hand in the developer portal: no upload API. |
| GameDistribution | By hand in the developer portal: no upload API. |
| GamePix | By hand in the partners portal: no upload API. |
| GameMonetize | Upload the ZIP in Game Management, run Verify Game, then select Request Activation. |
| Y8 | Upload the ZIP on the game's Builds tab, add media, and submit for review. |

`.github/workflows/publish.yml` runs after each release (called from `release-please.yml`; a release made with
`GITHUB_TOKEN` fires no `release` event) or by hand from the Actions tab with a tag, e.g. to publish again. It tests,
builds every portal zip, attaches them to the GitHub release and runs the pushes whose variables are set. Its run
summary lists the manual steps with links to the zips and consoles:

1. Yandex Games: console → the game → new version → upload `rebirth-yandex.zip`, version = the release number → send
   for moderation (3–5 working days; one moderation at a time).
2. CrazyGames: developer portal → the game → new build → upload the files of `rebirth-crazygames.zip` unzipped (the
   portal takes no archives; locally they are `release/crazygames/`), index.html at the top level.
3. GameDistribution: developer portal → the game → upload `rebirth-gamedistribution.zip`.
4. GamePix: partners portal → the game → upload `rebirth-gamepix.zip`.

Saves live in each portal's own origin, so players never move a save between portals, but a portal under moderation
lags behind the others: a save must load in any later version, not only the next one.

### One-time setup

Variables and secrets go in the repository settings (Secrets and variables → Actions). A push is skipped until its
variable is set. To approve a portal's pushes by hand, add a required reviewer to its environment (`itch`, `poki`,
`vk`).

- **itch.io**: create the project as an HTML game; secret `BUTLER_API_KEY` (itch.io → settings → API keys), variable
  `ITCH_GAME` (`user/game`, as in the project URL). After the first push, tick "This file will be played in the
  browser" on the `html5` upload.
- **Poki**: variable `POKI_GAME` (the game id from its Poki for Developers page), secret `POKI_UPLOAD_TOKEN` (an upload
  token from Poki for Developers). Request approval for the exact map, terrain, place-search and Wikipedia URLs under
  Settings → CSP. Poki also requires a published privacy policy linked in the game when using approved external services.
- **VK Games**: variable `VK_APP_ID`, secret `VK_DEPLOY_TOKEN` (the app's service token from its settings in VK).
  Deploys go to the `production` environment of VK hosting.
- **GameDistribution**: variable `GD_GAME_ID` (the game id from developer.gamedistribution.com; public, it ships in
  the bundle). Without it the GameDistribution build is skipped. Turn rewarded ads on in the game's settings there.
- **GameMonetize**: variable `GM_GAME_ID`, the public GameId from [Game Management](https://gamemonetize.com/account).
  The SDK requests one ad when a town first starts running and pauses the simulation and audio during the ad.
- **Y8**: variable `Y8_APP_ID` from SDK Initialization in the [developer portal](https://developer.y8.com/).
  Set `Y8_GAME_ID` as well to enable rewarded ads. Both IDs are public. The review requires
  [screenshots and a gameplay video](https://docs.y8.com/studio/media/).
- **CrazyGames**: choose **Yes, using the Data Module from the CrazyGames SDK** under Progress Save from the first
  submission. Build `crazygames` for Basic Launch and `crazygames-full` for Full Launch with rewarded ads.
  Both modes use the same compressed town save in the SDK, whose data limit is 1 MiB.

For local builds, put the public IDs in `env/.env.<portal>.local` or set the corresponding `VITE_*`
environment variables. Running `npm run build:portals -- <portal>` prints the required variable if the ID is missing.
The standalone archive `release/rebirth-itch.zip` also works as the upload format for Game Jolt and Newgrounds.
Newgrounds requires notice and opt-out for third-party APIs, so confirm requirements for the streamed map before submitting there.
Test WebGPU, map streaming and saves in each portal's preview before sending the build for review.

## CI

CI runs on pull requests to `dev` and `main`, and on pushes to `dev`:

```
npm ci
npm test
npm run build
```

It also runs `npm run build:portals`: every portal build and its archive checks.

Node.js 24 is used to match the Vercel project runtime.
