/**
 * Loads a local .env file for scripts and local development.
 *
 * On Vercel the platform injects environment variables directly, so dotenv is
 * skipped there. dotenv is also optional: if it is not installed the process
 * simply keeps whatever variables the shell already exported.
 */
const onVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

if (!onVercel) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dotenv = require("dotenv") as {
      config: (options?: { quiet?: boolean }) => unknown;
    };
    dotenv.config({ quiet: true });
  } catch {
    // dotenv is optional — environment variables may already be set.
  }
}

export {};
