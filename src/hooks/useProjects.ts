import { useCallback, useEffect, useRef, useState } from "react";
import { projectStorage } from "../services/projectStorage";
import { subscribeProjectsChanged } from "../lib/projectEvents";
import type { ProjectMeta } from "../types/project";

export interface ProjectListItem extends ProjectMeta {
  thumbnailUrl: string | null;
}

/** Lists all projects with object URLs for their thumbnails; refreshes on change. */
export function useProjects() {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cache object URLs by thumbnail identity so we don't leak or re-create them.
  const urlCache = useRef(new Map<string, { updatedAt: number; url: string }>());

  const refresh = useCallback(async () => {
    try {
      const [metas, thumbs] = await Promise.all([
        projectStorage.listProjects(),
        projectStorage.listThumbnails(),
      ]);
      const cache = urlCache.current;
      const thumbById = new Map(thumbs.map((t) => [t.projectId, t]));
      const items = metas.map((meta) => {
        const thumb = thumbById.get(meta.id);
        let url: string | null = null;
        if (thumb) {
          const cached = cache.get(meta.id);
          if (cached && cached.updatedAt === thumb.updatedAt) {
            url = cached.url;
          } else {
            if (cached) URL.revokeObjectURL(cached.url);
            url = URL.createObjectURL(thumb.blob);
            cache.set(meta.id, { updatedAt: thumb.updatedAt, url });
          }
        }
        return { ...meta, thumbnailUrl: url };
      });
      for (const [id, entry] of cache) {
        if (!thumbById.has(id)) {
          URL.revokeObjectURL(entry.url);
          cache.delete(id);
        }
      }
      setProjects(items);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Couldn't load your projects. Your browser may be blocking storage.");
      setProjects((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribe = subscribeProjectsChanged(() => void refresh());
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const cache = urlCache.current;
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
      for (const entry of cache.values()) URL.revokeObjectURL(entry.url);
      cache.clear();
    };
  }, [refresh]);

  return { projects, error, refresh };
}
