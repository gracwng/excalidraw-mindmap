import { useEffect, useRef, useState, type FormEvent } from "react";
import { syncManager } from "../../services/sync/syncManager";

interface AuthDialogProps {
  onClose: () => void;
}

/** Email + password sign-in. Works the same in Safari and in an iPad home-screen app. */
export function AuthDialog({ onClose }: AuthDialogProps) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "sign-in") {
        await syncManager.signIn(email.trim(), password);
        onClose();
      } else {
        const ready = await syncManager.signUp(email.trim(), password);
        if (ready) onClose();
        else {
          setNotice("Check your email and click the confirmation link, then sign in here.");
          setMode("sign-in");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-modal" role="presentation" onPointerDown={onClose}>
      <form
        className="mb-modal__dialog mb-auth"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mb-auth-title"
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="mb-auth-title" className="mb-modal__title">
          {mode === "sign-in" ? "Sign in to sync" : "Create your account"}
        </h2>
        <p className="mb-modal__body">
          Your mind maps stay on this device and sync privately to your account, so they show up
          on your laptop and iPad.
        </p>
        <label className="mb-field">
          <span>Email</span>
          <input
            ref={emailRef}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="mb-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="mb-auth__error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="mb-auth__notice" role="status">
            {notice}
          </p>
        )}
        <div className="mb-modal__actions mb-auth__actions">
          <button
            type="button"
            className="mb-link-button"
            onClick={() => {
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
              setError(null);
            }}
          >
            {mode === "sign-in" ? "Create an account" : "I already have an account"}
          </button>
          <span className="mb-auth__spacer" />
          <button type="button" className="mb-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="mb-button mb-button--primary" disabled={busy}>
            {busy ? "…" : mode === "sign-in" ? "Sign in" : "Create account"}
          </button>
        </div>
      </form>
    </div>
  );
}
