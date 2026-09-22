import { readFileSync } from "fs";
import { join } from "path";

/**
 * Which build is actually running, for the footer.
 *
 * Someone running this on their own Mac updates by pulling, and nothing on
 * screen said whether they had. Several rounds of this project were spent
 * diagnosing output from code that had already been replaced — the page looked
 * the same either way. A short commit and a date settle it in one glance.
 *
 * Read from .git directly rather than by running git: no subprocess, and it
 * works the same whether started by the launcher or by hand. On Vercel there is
 * no .git, so the commit comes from the environment instead.
 */
export interface AppVersion {
  /** Short commit hash, or null when neither source is available. */
  commit: string | null;
  /** When that commit landed in this checkout, as YYYY-MM-DD. */
  date: string | null;
}

let cached: AppVersion | null = null;

export function appVersion(): AppVersion {
  if (cached) return cached;
  cached = process.env.VERCEL_GIT_COMMIT_SHA
    ? { commit: process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7), date: null }
    : fromGitDirectory();
  return cached;
}

function fromGitDirectory(): AppVersion {
  const gitDir = join(process.cwd(), ".git");

  try {
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    const ref = head.startsWith("ref: ") ? head.slice(5).trim() : null;
    const commit = ref
      ? readFileSync(join(gitDir, ref), "utf8").trim()
      : head;

    // The reflog's last entry is when this checkout arrived at that commit,
    // which is what someone actually wants to know: not when the commit was
    // written, but when they last updated.
    let date: string | null = null;
    try {
      const log = readFileSync(join(gitDir, "logs", "HEAD"), "utf8").trimEnd();
      const last = log.slice(log.lastIndexOf("\n") + 1);
      const seconds = Number(/\s(\d{10})\s[+-]\d{4}\t/.exec(last)?.[1]);
      if (Number.isFinite(seconds)) {
        date = new Date(seconds * 1000).toISOString().slice(0, 10);
      }
    } catch {
      // A checkout without a reflog still has a commit worth showing.
    }

    return { commit: commit.slice(0, 7), date };
  } catch {
    return { commit: null, date: null };
  }
}

/** "a1b2c3d · 22 Sep 2026", or null when there is nothing to show. */
export function versionLabel(): string | null {
  const { commit, date } = appVersion();
  if (!commit) return null;
  if (!date) return commit;
  const when = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${commit} · ${when}`;
}
