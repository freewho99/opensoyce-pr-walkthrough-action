// Pure PR-comment builders for the pr-walkthrough GitHub Action.
//
// Pure builder + a marker-based dedupe anchor, so repeated runs UPDATE one
// comment instead of stacking new ones. The dedupe DECISION itself (marker
// lookup -> PATCH-or-create) lives in post-comment.sh via `gh api ... --jq`,
// since `gh` is already a hard dependency of the CLI command this action
// wraps.
//
// Deliberately built from the CLI's own `--json` summary shape (result/repo/
// prNumber/clusters/risks/verified), not by re-deriving from the full
// walkthrough.json -- the comment's job is a headline + a link to the
// uploaded artifact, not a reproduction of the walkthrough itself.

export const PR_WALKTHROUGH_COMMENT_MARKER = '<!-- opensoyce-pr-walkthrough -->';

const VIEWER_URL = 'https://opensoyce.com/pr-walkthrough';

/**
 * Pure. `result` is the CLI's own `pr-walkthrough --json` success object:
 *   { result: 'allow', repo, prNumber, out, clusters, risks: {level: count}, verified: true }
 *
 * PHASE0-WIRE-0 (zero custody): the walkthrough is committed into the
 * CUSTOMER's own repo, never OpenSoyce's — this comment's job is to point at
 * THAT copy, not to host or reproduce it. Exactly one of two shapes:
 *   - Public repo + a committed raw.githubusercontent.com copy (opts.rawUrl):
 *     a real, one-click `#src=` link. The viewer's own browser fetches it
 *     directly from the customer's repo; the source URL stays in the fragment
 *     so OpenSoyce's server never receives it in the HTTP request.
 *   - Private repo (opts.isPrivate): raw.githubusercontent.com won't serve a
 *     private file to an unauthenticated browser, so there is no one-click
 *     link yet -- stated plainly, with the two paths that work today, not
 *     papered over with a broken link.
 * `opts.runUrl` (optional): the workflow run's own URL, always safe to add
 * regardless of public/private, as a secondary way to find the artifact.
 */
export function buildSuccessComment(result, opts = {}) {
  const riskEntries = Object.entries(result?.risks || {});
  const riskSummary = riskEntries.length ? riskEntries.map(([level, n]) => `${n} ${level}`).join(', ') : 'none';
  const clusters = result?.clusters ?? 0;
  const lines = [
    PR_WALKTHROUGH_COMMENT_MARKER,
    '## OpenSoyce — PR walkthrough generated',
    '',
    `A verified walkthrough was generated for this PR: ${clusters} cluster(s), risks: ${riskSummary}.`,
    '',
  ];
  if (opts.isPrivate) {
    lines.push(
      "**This is a private repository** — OpenSoyce never stores or transits your code, so there's no automatic one-click link for a private repo yet.",
      '',
      'Two ways to view it now:',
      `1. Download \`${opts.committedPath || 'the committed walkthrough file'}\` from this repo (you already have access), then open [opensoyce.com/pr-walkthrough](${VIEWER_URL}) → "Load PR JSON".`,
      '2. *(coming later)* self-host the static viewer inside your own infrastructure — zero custody preserved either way; never OpenSoyce-side storage.',
      '',
    );
  } else if (opts.rawUrl) {
    lines.push(
      `**View it:** [opensoyce.com/pr-walkthrough](${VIEWER_URL}#src=${encodeURIComponent(opts.rawUrl)}) — your browser fetches this directly from this repo; the source URL stays in the URL fragment, so OpenSoyce's server never sees or stores it.`,
      '',
    );
  }
  if (opts.runUrl) {
    lines.push(`**Artifact:** also available from [this workflow run](${opts.runUrl}).`);
    lines.push('');
  }
  lines.push('_Risk tags are blast-radius / review-priority signals, not code-quality verdicts — open the walkthrough for the reasoning behind each one._');
  lines.push('');
  return lines.join('\n');
}

/**
 * Pure. `reason` is a short human-readable cause ("verification failed",
 * "missing provider API key", "gh CLI not authenticated", ...); `detail`
 * (optional) is the tool's own verbatim error output. Never posts a partial
 * or best-effort walkthrough — this comment exists specifically to say none
 * was produced, and why.
 */
export function buildFailureComment(reason, detail) {
  const lines = [
    PR_WALKTHROUGH_COMMENT_MARKER,
    '## OpenSoyce — PR walkthrough could not be generated',
    '',
    `**Reason:** ${reason}`,
    '',
  ];
  if (detail) {
    lines.push('```');
    lines.push(String(detail).trim());
    lines.push('```');
    lines.push('');
  }
  lines.push('_No walkthrough was generated for this run — nothing partial or best-effort was posted._');
  lines.push('');
  return lines.join('\n');
}

// CLI mode: `node prCommentBuilder.mjs success <cli-json-result-file> [runUrl]`
//           `node prCommentBuilder.mjs failure "<reason>" [detail-file]`
// Prints the markdown body to stdout; the calling workflow redirects it to a
// file and hands that file to `gh`.
//
// The success mode's WIRE-0 options (rawUrl/isPrivate/committedPath) come from
// environment variables, not more positional args -- action.yml already passes
// everything else to its steps via env:, and a long positional CLI arg list
// gets fragile fast once there's more than one optional value.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , mode, a, b] = process.argv;
  if (mode === 'success') {
    const result = JSON.parse(fs.readFileSync(a, 'utf8'));
    process.stdout.write(buildSuccessComment(result, {
      runUrl: b || undefined,
      rawUrl: process.env.PRW_RAW_URL || undefined,
      isPrivate: process.env.PRW_IS_PRIVATE === 'true',
      committedPath: process.env.PRW_COMMITTED_PATH || undefined,
    }));
  } else if (mode === 'failure') {
    const detail = b && fs.existsSync(b) ? fs.readFileSync(b, 'utf8') : undefined;
    process.stdout.write(buildFailureComment(a, detail));
  } else {
    console.error('Usage: node prCommentBuilder.mjs success <cli-json-result-file> [runUrl]');
    console.error('       node prCommentBuilder.mjs failure "<reason>" [detail-file]');
    process.exit(1);
  }
}
