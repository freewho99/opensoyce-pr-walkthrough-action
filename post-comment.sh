#!/usr/bin/env bash
# Post-or-update a PR comment, deduped by the marker below. Mirrors
# .github/workflows/opensoyce-scan.yml's existing marker + `gh api`/`gh pr
# comment` dedup pattern exactly (find-by-marker -> PATCH existing or create),
# parameterized here instead of reading github.* context directly, per this
# action's "explicit inputs only" doctrine (see action.yml's header comment).
#
# Usage: post-comment.sh <pr-url> <body-file>
# Requires GH_TOKEN in the environment (gh reads it automatically).
#
# BEST-EFFORT ON PURPOSE: a comment-posting hiccup (a transient API error, an
# unparseable URL) must never be what makes the Action run read as failed --
# that signal belongs ONLY to the walkthrough-generation step itself. This
# script warns and continues rather than propagating its own exit code.
set -uo pipefail

PR_URL="$1"
BODY_FILE="$2"
MARKER='<!-- opensoyce-pr-walkthrough -->'

# Parse https://github.com/<owner>/<repo>/pull/<number>[...] -- the CLI itself
# already validated this URL before the action ever got this far; this is a
# second, defensive parse, not the first line of defense.
if [[ ! "$PR_URL" =~ ^https://github\.com/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
  echo "::warning::post-comment.sh: \"$PR_URL\" doesn't look like a GitHub PR URL -- skipping comment."
  exit 0
fi
OWNER="${BASH_REMATCH[1]}"
REPO_NAME="${BASH_REMATCH[2]}"
PR_NUMBER="${BASH_REMATCH[3]}"
REPO="$OWNER/$REPO_NAME"

BODY=$(cat "$BODY_FILE")
EXISTING_ID=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments" \
  --jq ".[] | select(.body | contains(\"$MARKER\")) | .id" \
  2>/dev/null | head -n1)

if [ -n "$EXISTING_ID" ]; then
  gh api -X PATCH "repos/$REPO/issues/comments/$EXISTING_ID" -f body="$BODY" \
    || echo "::warning::post-comment.sh: failed to update the existing PR comment ($EXISTING_ID)."
else
  gh pr comment "$PR_NUMBER" --repo "$REPO" --body "$BODY" \
    || echo "::warning::post-comment.sh: failed to post a new PR comment."
fi
exit 0
