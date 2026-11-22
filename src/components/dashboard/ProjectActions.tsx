import { SearchIcon } from "../common/icons";
import type { SortKey } from "../../types/project";

interface ProjectActionsProps {
  query: string;
  onQueryChange: (query: string) => void;
  sort: SortKey;
  onSortChange: (sort: SortKey) => void;
  count: number;
  total: number;
}

/** Search + sort row above the project grid. */
export function ProjectActions({
  query,
  onQueryChange,
  sort,
  onSortChange,
  count,
  total,
}: ProjectActionsProps) {
  return (
    <div className="mb-toolbar">
      <label className="mb-search">
        <SearchIcon />
        <input
          type="search"
          placeholder="Search mindboards"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Search mindboards"
        />
      </label>
      <div className="mb-toolbar__right">
        <span className="mb-toolbar__count">
          {query ? `${count} of ${total}` : `${total} ${total === 1 ? "mindboard" : "mindboards"}`}
        </span>
        <label className="mb-sort">
          <span>Sort by</span>
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            aria-label="Sort projects"
          >
            <option value="updatedAt">Last modified</option>
            <option value="createdAt">Date created</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
    </div>
  );
}
