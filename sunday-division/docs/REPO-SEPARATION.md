# Moving Sunday Division into its own private repository — migration plan

**Status:** planned and dry-run on 15 Nov 2026. **Nothing has been migrated.** The original project is not modified or deleted until the new repository exists and has been verified (steps 1–6). Each step marked **You** needs you; the others are run from this plan.

## Why

`sayercmcdonald/Video-game-tester` holds three unrelated projects, one per branch:
- Game QA Lab, on the default branch `claude/game-qa-lab`;
- Mission Trips;
- Sunday Division, on `claude/awesome-mccarthy-bic3ux`.

Nothing in Sunday Division refers to anything outside `sunday-division/`. The only thing outside that folder it uses is its CI workflow. Sunday Division has never been merged into the default branch. **PR #1 should not be merged here**: that would couple the projects permanently.

## Dry run: `sunday-division/scripts/split-repo.sh HEAD`

The script works on a fresh clone in a temporary folder and pushes nothing unless given `--push <url>`. On the current branch tip it reports:

| Check | Result |
|---|---|
| History | 16 commits extracted with `git subtree split`. Authors, dates and messages are kept; commit IDs change, as with any history rewrite. |
| Content | The final tree is **byte-identical** to `sunday-division/` (tree `d6f17bf…`). |
| CI | Rewritten for the repository root: no subfolder, no path filters, runs on `main`. |
| Isolation | No Game QA or Mission Trips files anywhere in the history; no `.env`, database or VAPID key; no key-shaped secrets. |
| Tests | `npm ci` and `npm test` in the new tree: **130 / 130 pass**, 0 skipped. |

## Runbook

**1. You: create the repository.**
- Create an **empty private** repository: no README, licence or `.gitignore`. Suggested name: `sayercmcdonald/sunday-division`, or one under a studio organisation.
- Give the Claude GitHub App access to it. This session cannot create repositories.
- Decide its visibility and who else has access.

**2. Freeze the commit.** Use the commit you approve on PR #1. Review stays on PR #1 until then, and nothing new lands on the branch during the move.

**3. Split and push.** Run `sunday-division/scripts/split-repo.sh <approved-commit> --push <new-repo-url>`.
- It repeats every dry-run check, and stops if any fails.
- It refuses to push if the target repository is not empty.
- It pushes only `main`.

**4. Verify the new repository.** Do not continue until all of these hold:
- CI on `main` is green there (tests, audit, production boot);
- `git rev-parse main^{tree}` in a fresh clone matches the tree recorded above. The CI commit adds only `.github/workflows/ci.yml` on top.
- A fresh clone, `npm ci`, `npm test` passes on a second machine or CI runner;
- `README.md`, `docs/` and the screenshots are present; links inside `docs/` are relative, so they still work.

**5. You: settings on the new repository.**
- Protect `main`: require the CI check and a pull request.
- Add deployment secrets as environment secrets, never in code: Stripe, `ANTHROPIC_API_KEY`, VAPID, INDEX V3 and FORM tokens.
- Enable secret scanning.

**6. Point deployment at it.** The Docker build context is the repository root; the Dockerfile is already there and needs no change. Nothing is deployed until you approve a deployment.

**7. Only after 4–6 are verified, tidy up here.**
- Close PR #1 with a link to the new repository.
- Keep `claude/awesome-mccarthy-bic3ux` as a read-only archive, or delete it, your call.
- Optionally remove `.github/workflows/sunday-division.yml` from this repository in a separate PR.
- Game QA Lab and Mission Trips are untouched throughout.

**Rollback.** Until step 7, this repository is exactly as it is today. To abandon the move, delete the new repository. Nothing here needs undoing.

## Alternatives considered

| Option | Why not |
|---|---|
| `git filter-repo --subdirectory-filter` | Gives the same result, because the commits never mix projects. It isn't installed here. Prefer it later if files ever need stripping from history. |
| Copy the files into a new repository without history | Loses the record of why things were built. |
| Merge into this repository first, split later | Couples Sunday Division to Game QA's default branch for no benefit. |
| Submodule or monorepo | Keeps the coupling the move is meant to remove. |

## Decisions for you

- The repository's name and owner (personal account or a studio organisation). Private is recommended.
- The commit to move: the approved head of PR #1 (recommended).
