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
  /** The released version, from package.json. */
  version: string;
  /** Short commit hash, or null when neither source is available. */
  commit: string | null;
  /** When that commit landed in this checkout, as YYYY-MM-DD. */
  date: string | null;
}

export function appVersion(): AppVersion {
  // Read every time. A long-running `next dev` otherwise keeps the version it
  // saw on the first request, and the footer keeps saying 3.1.1 after the
  // checkout has moved on — the exact confusion this label exists to prevent.
  const git = process.env.VERCEL_GIT_COMMIT_SHA
    ? { commit: process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7), date: null }
    : fromGitDirectory();
  return { version: packageVersion(), ...git };
}

/**
 * Read rather than import, so this file works the same in the app and in a
 * plain node script. Importing JSON needs an import attribute in one and not
 * the other, and the version is not worth that.
 */
function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function fromGitDirectory(): Omit<AppVersion, "version"> {
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

/**
 * "v3.0.0 · 22 Sept 2026" — what to show in a footer.
 *
 * Both halves earn their place. The version is the thing to say out loud when
 * reporting a problem; the date answers the question the version cannot, which
 * is whether this checkout has been updated recently. Between releases the
 * version holds still while the date moves.
 *
 * The commit is kept in versionDetail for a tooltip, where it is available
 * when something needs pinning down exactly and invisible the rest of the time.
 */
export function versionLabel(): string {
  const { version, date } = appVersion();
  if (!date) return `v${version}`;
  const when = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `v${version} · ${when}`;
}

/** The exact build, for a title attribute. */
export function versionDetail(): string {
  const { version, commit } = appVersion();
  return commit ? `Version ${version}, build ${commit}` : `Version ${version}`;
}
