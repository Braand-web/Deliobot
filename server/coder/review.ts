export const REVIEW_DIFF_LIMIT = 60_000;

export interface ReviewVerdict { verdict: "approve" | "changes"; notes: string }

/** What the reviewing engine reads: the request, the change and the checks that passed. */
export function reviewPrompt(input: { request: string; diff: string; checks: readonly string[]; previewUrl?: string }): string {
  const diff = input.diff.length > REVIEW_DIFF_LIMIT ? `${input.diff.slice(0, REVIEW_DIFF_LIMIT)}\n… (diff cut at ${REVIEW_DIFF_LIMIT} characters)` : input.diff;
  return [
    "You are reviewing a code change another engine made in this folder. Do not edit any file: read, run read-only commands if useful, and judge.",
    "",
    "What the person asked for:",
    input.request.trim() || "(not recorded)",
    "",
    input.checks.length ? `These checks already pass: ${input.checks.join(", ")}.` : "The project has no automatic checks.",
    ...(input.previewUrl ? ["", `Open ${input.previewUrl} with the browser tools, take a screenshot, and check the page matches the request. Attach the screenshot.`] : []),
    "",
    "Look for bugs, missed parts of the request, security problems, data loss and broken edge cases. Ignore style preferences.",
    "End your answer with exactly one block:",
    '<review verdict="approve">one line saying why it is right</review>',
    "or",
    '<review verdict="changes">each blocking problem on its own line, with the file and what to fix</review>',
    "",
    "The change:",
    "```diff",
    diff || "(empty diff)",
    "```",
  ].join("\n");
}

/** The reviewer's verdict; an answer without the block counts as approved, so a confused reviewer never loops the bot. */
export function parseReview(text: string): ReviewVerdict {
  const matches = [...text.matchAll(/<review\s+verdict="(approve|changes)"\s*>([\s\S]*?)<\/review>/gi)];
  const last = matches.at(-1);
  if (!last) return { verdict: "approve", notes: "" };
  return { verdict: last[1]!.toLowerCase() === "changes" ? "changes" : "approve", notes: last[2]!.trim().slice(0, 6_000) };
}

/** What the coding bot reads when the review asks for changes. */
export function reviewFixMessage(reviewer: string, notes: string): string {
  return [
    `${reviewer} reviewed your change and asks for these fixes:`,
    notes,
    "",
    "Fix them, then stop: the checks and the review run again on their own.",
  ].join("\n");
}
