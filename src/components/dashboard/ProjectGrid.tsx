import { ProjectCard, type ProjectCardActions } from "./ProjectCard";
import type { ProjectListItem } from "../../hooks/useProjects";

interface ProjectGridProps extends ProjectCardActions {
  projects: ProjectListItem[];
}

export function ProjectGrid({ projects, ...actions }: ProjectGridProps) {
  return (
    <div className="mb-grid">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} {...actions} />
      ))}
    </div>
  );
}
