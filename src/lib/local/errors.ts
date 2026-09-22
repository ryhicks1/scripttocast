/**
 * Failures on the private path that we can explain to the user.
 *
 * The private path has no fallback, by design: when local analysis cannot be
 * done, the request fails. So the quality of these messages is the whole of the
 * user's recovery path — each one should say what broke and what to type next.
 */
export class LocalAnalysisError extends Error {
  constructor(
    message: string,
    readonly status: number = 502,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "LocalAnalysisError";
  }
}
