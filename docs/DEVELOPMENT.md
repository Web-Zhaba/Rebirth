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

Release Please watches `main`. It maintains a release PR with the next version and `CHANGELOG.md`. Merging that release PR creates the Git tag and GitHub Release.

The repository starts from version `0.0.0`; the first releasable Conventional Commit will establish the first development release (for example, a feature normally leads to `0.1.0`).

## CI

CI runs on pull requests to `dev` and `main`, and on pushes to `dev`:

```
npm ci
npm test
npm run build
```

Node.js 24 is used to match the Vercel project runtime.
