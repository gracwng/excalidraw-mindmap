import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import { ToastProvider } from "./components/common/Toast";

// The editor pulls in Excalidraw (~1 MB); load it only when a project is opened.
const ProjectEditor = lazy(() => import("./pages/ProjectEditor"));

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="mb-fullscreen-message" aria-busy="true" />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/project/:projectId" element={<ProjectEditor />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ToastProvider>
  );
}
