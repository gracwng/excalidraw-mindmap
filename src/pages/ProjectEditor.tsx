import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { DrawingEditor } from "../components/editor/DrawingEditor";
import { useProject } from "../hooks/useProject";

export default function ProjectEditor() {
  const { projectId } = useParams();
  const state = useProject(projectId);

  useEffect(() => {
    if (state.status === "ready") document.title = `${state.project.name} · Mindboard`;
    return () => {
      document.title = "Mindboard";
    };
  }, [state]);

  if (state.status === "loading") {
    return <div className="mb-fullscreen-message" aria-busy="true" />;
  }

  if (state.status !== "ready") {
    return (
      <div className="mb-fullscreen-message">
        <h1 className="mb-handwritten">
          {state.status === "missing" ? "This mindboard doesn't exist" : state.message}
        </h1>
        <p>It may have been deleted, or the link is wrong.</p>
        <Link to="/" className="mb-button mb-button--primary">
          Back to projects
        </Link>
      </div>
    );
  }

  return <DrawingEditor key={state.project.id} project={state.project} />;
}
