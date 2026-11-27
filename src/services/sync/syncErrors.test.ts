import { describe, expect, it } from "vitest";
import { RemoteError, describeSyncError } from "./syncErrors";

// Shapes of real Supabase errors: PostgREST returns plain objects, not Errors.
const missingTabsColumn = {
  code: "PGRST204",
  details: null,
  hint: null,
  message: "Could not find the 'tabs' column of 'projects' in the schema cache",
};
const missingTable = {
  code: "PGRST205",
  details: null,
  hint: "Perhaps you meant the table 'public.profiles'",
  message: "Could not find the table 'public.projects' in the schema cache",
};
const rls = {
  code: "42501",
  details: null,
  hint: null,
  message: 'new row violates row-level security policy for table "projects"',
};

describe("sync error messages", () => {
  it("wraps plain Supabase error objects with the step that failed", () => {
    const err = new RemoteError("uploading changes", missingTabsColumn);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(
      "uploading changes: Could not find the 'tabs' column of 'projects' in the schema cache (PGRST204)",
    );
    expect(err.code).toBe("PGRST204");
  });

  it("explains a database set up before tabs existed", () => {
    expect(describeSyncError(new RemoteError("uploading changes", missingTabsColumn))).toMatch(
      /needs updating for tabs.*schema\.sql/,
    );
    // Also when the raw object reaches it unwrapped.
    expect(describeSyncError(missingTabsColumn)).toMatch(/needs updating for tabs/);
  });

  it("explains a database that was never set up", () => {
    expect(describeSyncError(new RemoteError("listing your mindboards", missingTable))).toMatch(
      /isn't set up yet/,
    );
  });

  it("explains row-level security refusals", () => {
    expect(describeSyncError(new RemoteError("uploading a new mindboard", rls))).toMatch(
      /refused access/,
    );
  });

  it("explains a missing image bucket", () => {
    const storage = { name: "StorageApiError", message: "Bucket not found", status: 400 };
    expect(describeSyncError(new RemoteError("uploading an image", storage))).toMatch(
      /Image storage isn't set up/,
    );
  });

  it("explains network failures", () => {
    expect(describeSyncError(new TypeError("Failed to fetch"))).toMatch(/Can't reach the sync server/);
  });

  it("never shows [object Object]", () => {
    const odd = { code: "XX000", message: "", details: "something odd happened" };
    const text = describeSyncError(new RemoteError("uploading changes", odd));
    expect(text).not.toContain("[object Object]");
    expect(text).toContain("uploading changes");
  });
});
