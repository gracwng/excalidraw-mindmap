/**
 * Turning sync failures into messages a person can act on.
 *
 * Supabase returns errors as plain objects ({ message, code, details, hint }),
 * not `Error`s, so they're wrapped in `RemoteError` at the source with the step
 * that failed (e.g. "uploading a project").
 */
export class RemoteError extends Error {
  readonly step: string;
  readonly code?: string;
  readonly details?: string;
  readonly hint?: string;
  readonly status?: number;

  constructor(step: string, raw: unknown) {
    const info = errorInfo(raw);
    super(`${step}: ${info.message}${info.code ? ` (${info.code})` : ""}`);
    this.name = "RemoteError";
    this.step = step;
    this.code = info.code;
    this.details = info.details;
    this.hint = info.hint;
    this.status = info.status;
  }
}

interface ErrorInfo {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
}

function errorInfo(raw: unknown): ErrorInfo {
  if (raw instanceof RemoteError) {
    return { message: raw.message, code: raw.code, details: raw.details, hint: raw.hint, status: raw.status };
  }
  if (raw && typeof raw === "object") {
    const e = raw as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const message =
      str(e.message) ?? str(e.error_description) ?? str(e.error) ?? safeJson(raw) ?? "Unknown error";
    const status = typeof e.status === "number" ? e.status : typeof e.statusCode === "string" ? Number(e.statusCode) : undefined;
    return { message, code: str(e.code), details: str(e.details), hint: str(e.hint), status };
  }
  return { message: String(raw) };
}

function safeJson(value: unknown) {
  try {
    const json = JSON.stringify(value);
    return json && json !== "{}" ? json : undefined;
  } catch {
    return undefined;
  }
}

/** Every bit of text an error carries, for matching known problems. */
function allText(err: unknown) {
  const info = errorInfo(err);
  return [info.message, info.code, info.details, info.hint].filter(Boolean).join(" ");
}

const SCHEMA = "run supabase/schema.sql in the Supabase SQL Editor";

/** A short explanation of what went wrong and what to do about it. */
export function describeSyncError(err: unknown): string {
  const text = allText(err);
  if (/'tabs' column|column .*tabs|tabs.*does not exist/i.test(text)) {
    return `The cloud database needs updating for tabs — re-${SCHEMA}.`;
  }
  if (/PGRST205|relation .*projects.* does not exist|Could not find the table/i.test(text)) {
    return `The cloud database isn't set up yet — ${SCHEMA}.`;
  }
  if (/PGRST204|Could not find the '.*' column/i.test(text)) {
    return `The cloud database is out of date — re-${SCHEMA}.`;
  }
  if (/Bucket not found/i.test(text)) {
    return `Image storage isn't set up yet — ${SCHEMA}.`;
  }
  if (/42501|permission denied|row-level security/i.test(text)) {
    return `The cloud database refused access — re-${SCHEMA}, then sign out and back in.`;
  }
  if (/JWT expired|invalid JWT|refresh token|PGRST30[0-3]/i.test(text)) {
    return "Your session expired — sign out and sign in again.";
  }
  if (/Failed to fetch|NetworkError|Load failed|ERR_NAME_NOT_RESOLVED/i.test(text)) {
    return "Can't reach the sync server. If this keeps happening, check that your Supabase project isn't paused.";
  }
  if (/project.*paused|is paused/i.test(text)) {
    return "Your Supabase project is paused — restore it from the Supabase dashboard.";
  }
  const info = errorInfo(err);
  return info.details ? `${info.message} — ${info.details}` : info.message;
}
