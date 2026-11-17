import { useCallback, useRef, useState, type ReactNode } from "react";
import { ToastContext, type ToastKind } from "./toastContext";

interface ToastMessage {
  id: number;
  text: string;
  kind: ToastKind;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(1);

  const show = useCallback((text: string, kind: ToastMessage["kind"] = "info") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, text, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="mb-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`mb-toast mb-toast--${t.kind}`} role="status">
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

