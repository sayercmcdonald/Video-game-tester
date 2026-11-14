# Moving Sunday Division into its own repository — evaluation

Status: **evaluated with a local dry run. Nothing has been migrated.** Each step below waits for your approval.

## Where things stand

| | |
|---|---|
| Repository | `sayercmcdonald/Video-game-tester` holds three unrelated projects, one per branch: Game QA Lab (`claude/game-qa-lab`, the default branch), Mission Trips (`claude/mission-trip-platform`) and Sunday Division (`claude/awesome-mccarthy-bic3ux`). |
| Sunday Division history | 12 commits. Every one touches only `sunday-division/`, apart from the CI workflow (`.github/workflows/sunday-division.yml`). |
| Coupling | None in code: no file under `sunday-division/` refers to anything outside it. The only shared things are the repository itself, its default branch and the root `.github/` folder. |
| Merged into Game QA? | No. Sunday Division has never been merged into the default branch, so separating it changes nothing in Game QA Lab's history. |

## Recommendation

Create a new, private repository whose `main` branch is Sunday Division's own history, extracted with `git subtree split`, and **do not merge PR #1 into the Game QA default branch**. Merging it there would couple the projects permanently, which is exactly what we want to avoid.

### Dry run (done, on a scratch clone; nothing pushed)

* `git subtree split --prefix=sunday-division` → 12 commits, one root commit. Authors, dates and messages are preserved; commit IDs change (they always do when history is rewritten).
* The split's final tree is **byte-identical** to `sunday-division/` at the branch tip (same tree hash).
* In the split checkout: `npm ci` and `npm test` → **120 / 120 pass**, 0 skipped.
* The split history contains no file from Game QA Lab or Mission Trips, no `.env`, database, upload or VAPID key, and no secret patterns.

### Steps, each needing your go-ahead

1. **You** create an empty private repository (suggested: `sayercmcdonald/sunday-division`, no README or licence, so the first push is clean) and give the Claude GitHub App access to it. This session cannot create repositories.
2. From a fresh clone, run `git subtree split --prefix=sunday-division <approved commit> -b main` and check the tree hash matches.
3. Add the CI workflow at the new repository's root: the same job as today, without `working-directory: sunday-division` and the path filters. Push `main`, then confirm CI is green there.
4. Set up the new repository: branch protection on `main` with the CI check required, and deployment secrets in its environment settings, not in code.
5. Point deployment (Docker build context, hosting service) at the new repository. The Dockerfile already sits at the project root, so it needs no changes.
6. Only after steps 2–5 are verified, in this repository: close PR #1 with a link to the new repository, and delete `claude/awesome-mccarthy-bic3ux` (or keep it read-only as an archive).

**Rollback.** Nothing is deleted from this repository until the new one is verified, so stopping at any point leaves everything as it is today.

### Alternatives considered

| Option | Why not |
|---|---|
| `git filter-repo --subdirectory-filter` | Same result here, because the commits never mix projects. It also isn't installed in this environment. Prefer it if you later need to strip files from history. |
| Copy the files into a new repository without history | Loses the record of why things were built. |
| Merge into this repository first, split later | Couples Sunday Division to Game QA Lab's default branch for no benefit. |
| Git submodule or monorepo | Keeps the coupling you want to remove. |

## Decisions for you

* Repository name, owner (personal or an organisation for the studio) and visibility. Private is recommended.
* Whether review continues on PR #1 here and the split is taken from the approved commit (recommended), or review moves to the new repository first.
