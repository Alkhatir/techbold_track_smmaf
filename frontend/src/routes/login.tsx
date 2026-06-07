import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogIn, ShieldCheck, Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Sign in — Technician Workspace" }],
  }),
  component: Login,
});

function Login() {
  const { login, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If a session already exists, skip straight to the workspace.
  useEffect(() => {
    if (!loading && isAuthenticated) void navigate({ to: "/" });
  }, [loading, isAuthenticated, navigate]);

  const handleLogin = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await login();
      await navigate({ to: "/" });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Check the ERP connection.");
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="dark flex min-h-screen w-full items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md border border-border bg-background">
            <ShieldCheck className="size-5 text-success" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight">Technician Workspace</h1>
            <p className="text-xs text-muted-foreground">AI-assisted Linux IR · Phoenix ERP</p>
          </div>
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          Sign in to load your assigned tickets and technician profile from the ERP.
        </p>

        <button
          onClick={() => void handleLogin()}
          disabled={signingIn}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {signingIn ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Signing in…
            </>
          ) : (
            <>
              <LogIn className="size-4" />
              Sign in as technician
            </>
          )}
        </button>

        {error && (
          <p className="mt-4 rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
