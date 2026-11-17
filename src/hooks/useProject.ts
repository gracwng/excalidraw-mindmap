import { useEffect, useState } from "react";
import { projectStorage } from "../services/projectStorage";
import type { Project } from "../types/project";

export type ProjectLoadState =
  | { status: "loading" }
  | { status: "ready"; project: Project }
  | { status: "missing" }
  | { status: "error"; message: string };

type Settled = Exclude<ProjectLoadState, { status: "loading" }>;

/** Loads one complete project (metadata, scene, files) once per id. */
export function useProject(projectId: string | undefined): ProjectLoadState {
  // Results are tagged with the id they belong to, so a stale result for a
  // previous id is never shown — it simply reads as "loading".
  const [result, setResult] = useState<{ id: string; state: Settled } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    projectStorage
      .loadProject(projectId)
      .then((project) => {
        if (cancelled) return;
        setResult({
          id: projectId,
          state: project ? { status: "ready", project } : { status: "missing" },
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error(err);
        setResult({ id: projectId, state: { status: "error", message: "Couldn't open this project." } });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!projectId) return { status: "missing" };
  if (!result || result.id !== projectId) return { status: "loading" };
  return result.state;
}
