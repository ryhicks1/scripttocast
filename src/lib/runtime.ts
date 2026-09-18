/**
 * True when this process is hosted on Vercel (production or preview).
 * Vercel sets VERCEL=1. Local `npm run dev` / `next start` do not.
 */
export function isVercelHosted(): boolean {
  return Boolean(process.env.VERCEL);
}
