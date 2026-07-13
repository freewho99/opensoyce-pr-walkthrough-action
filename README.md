# OpenSoyce PR Walkthrough — GitHub Action

A thin wrapper around the **published** `opensoyce` npm CLI's `pr-walkthrough` command:

```txt
npx opensoyce@<version> pr-walkthrough <url> --provider <name> --out <path> --json
```

It generates a verified PR walkthrough (parse -> cluster -> excerpt -> risk -> verify) from a real GitHub PR on `pull_request` events, commits it into **your own repo**, and posts (or updates) a PR comment with a live, one-click viewer link — fetched directly by the viewer's browser, never through any OpenSoyce server.

## The CLI is the engine; this repo is auto-pilot

This repository adds a trigger. It does not add a second implementation, and it does not vendor any OpenSoyce source — it `npx`-runs the exact published `opensoyce` package, pinned to the version you choose. This repo owns exactly three things: the trigger (`action.yml`), PR-comment formatting (`comment-builder.mjs` — pure markdown templating over the CLI's own `--json` output shape), and comment dedup (`post-comment.sh`).

## Zero custody

```txt
OpenSoyce never stores, receives, or transits customer code or walkthroughs.
```

This is structural, not a policy statement:

1. This action commits the generated walkthrough into **your repo** (at `.opensoyce/walkthroughs/pr-<number>.json`), using the token your own workflow already has — never OpenSoyce's repo, never OpenSoyce-controlled storage.
2. The PR comment links to [opensoyce.com/pr-walkthrough](https://opensoyce.com/pr-walkthrough)`#src=<raw-url-of-that-file>`. The **viewer's own browser** fetches that file directly from `raw.githubusercontent.com`. The source URL lives in the fragment, which browsers do not send to OpenSoyce's server.
3. **Private repos**: `raw.githubusercontent.com` cannot serve a private file to an unauthenticated browser, so there's no one-click link yet for private repos. The comment says so plainly and gives the two paths that work today — never a broken link papering over the gap.

## Licensing

Public repos are free, forever — the published CLI never asks for anything on a public repo. Private repos require an active OpenSoyce License Record (`opensoyce-license.json`) checked into the repo this action runs in; the CLI itself verifies it fully offline (the public verification key ships baked into the npm package — nothing to configure) and fails closed with the exact reason (missing / invalid / expired) if it isn't active. See the `opensoyce` package's own docs for how to obtain one. This action does not duplicate that check — the CLI already does it, before any diff fetch or model call.

## Doctrine

```txt
The workflow may pass context.
The action may not sniff context.
```

This action takes explicit inputs only — the `github.*` expressions live in YOUR workflow, below. The only `github.*` reference inside this action is `github.action_path`, which locates the action's own files, not the run.

**Your key, your cost.** The provider API key is a secret YOU set on YOUR workflow. This action never ships, shares, or falls back to a key of its own.

**Never a partial result.** A verify-fail, a missing key, a missing/invalid/expired License Record on a private repo, or an unauthenticated `gh` all fail the Action run AND post a comment explaining why — never a silent no-op, never a half-generated walkthrough.

## Usage

```yaml
name: PR walkthrough

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: write
  pull-requests: write

jobs:
  pr-walkthrough:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          # Required so this action's commit-back step has a real branch to
          # push to -- the default pull_request checkout is a synthetic
          # merge ref, not the PR's own branch.
          ref: ${{ github.event.pull_request.head.ref }}

      - uses: freewho99/opensoyce-pr-walkthrough-action@v1
        with:
          opensoyce-version: '0.2.1' # pin to a real published version; bump on your own schedule
          pr-url: ${{ github.event.pull_request.html_url }}
          pr-number: ${{ github.event.pull_request.number }}
          repository: ${{ github.repository }}
          repo-private: ${{ github.event.repository.private }}
          provider: openai
          api-key: ${{ secrets.OPENAI_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          run-url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
```

## Inputs

| Input | Required | Meaning |
|---|---|---|
| `pr-url` | yes | The PR to generate a walkthrough for — pass `github.event.pull_request.html_url` explicitly |
| `opensoyce-version` | yes | The exact published `opensoyce` npm version to run, e.g. `0.2.1`. No default — pin deliberately |
| `pr-number` | yes | The bare PR number — pass `github.event.pull_request.number` explicitly. Names the committed file (`pr-<number>.json`) |
| `repository` | yes | `owner/repo` — pass `github.repository` explicitly. Used to build the raw.githubusercontent.com link |
| `repo-private` | yes | `"true"`/`"false"` — pass `github.event.repository.private` explicitly. Selects the public one-click-link comment vs. the private honest-limitation comment |
| `provider` | yes | `anthropic` \| `openai` \| `gemini` |
| `api-key` | yes | The selected provider's API key — store as an encrypted secret, pass its value here |
| `github-token` | yes | Used by the CLI's own `gh pr diff`/`gh pr view` calls, this action's comment step, and the commit-back push — pass `secrets.GITHUB_TOKEN` explicitly |
| `out` | no (default `walkthrough.json`) | Output path for the generated walkthrough |
| `comment` | no (default `'true'`) | Set `'false'` to skip posting/updating a PR comment (the commit + artifact upload still happen) |
| `run-url` | no (default `''`) | This run's own URL, for the success comment's secondary artifact link — pass it explicitly (see the usage example); omitted from the comment if blank |

## What this action will never do

- Store, host, or transit your code or walkthrough on any OpenSoyce-controlled server. See "Zero custody" above.
- Vendor or duplicate OpenSoyce's proprietary implementation. It `npx`-runs the published `opensoyce` package at the version you pin — nothing is built, checked out, or copied from a private source tree.
- Auto-trigger on repos that didn't add this workflow themselves. You opt in by adding the workflow file to your own repo; OpenSoyce does not turn this on remotely.
- Throttle or restrict which PRs trigger it. If you want to skip bot PRs, forked PRs, or PRs under a certain size, that's a condition in YOUR workflow file (e.g. `if: github.event.pull_request.user.login != 'dependabot[bot]'`), not logic this action builds in.
- Auto-follow new `opensoyce` releases. `opensoyce-version` has no default; you choose when to bump it.

## Comment format and idempotency

Comments carry a hidden marker (`<!-- opensoyce-pr-walkthrough -->`). On re-runs of the same PR (e.g. pushing a new commit), the existing comment is found by that marker and edited in place — never stacked as a new comment.

Risk tags in the comment (and in the walkthrough itself) are blast-radius / review-priority signals, never code-quality verdicts.

## Fork PRs

Two separate things break on a forked PR, for two separate reasons:

1. **The comment.** This action needs `pull-requests: write`. A workflow using the plain `pull_request` trigger (as in the example above) gets a **read-only** token on forked-PR runs, so the comment step fails there.
2. **The commit-back.** Even with more permissions, committing into "this repo" is fundamentally a same-repo-PR feature — a fork's branch lives in a *different* repository that the base repo's token has no write access to. No permissions tweak changes that.

The artifact upload still works either way, since it only needs `contents: read`/`write` on the base repo.

## Prerequisites

- The runner has `gh` and its own `GITHUB_TOKEN` available automatically on GitHub-hosted runners.
- Node.js >= 18.17 (GitHub-hosted `ubuntu-latest` runners qualify) — `npx` fetches the pinned `opensoyce` version at run time; nothing needs to be pre-installed or checked out beyond your own repo.
- The calling workflow has already run `actions/checkout` (with `ref: ${{ github.event.pull_request.head.ref }}` — see Usage) so there's a real branch to commit the walkthrough onto, and so the private-repo License Record (if any) is present in the checkout.
