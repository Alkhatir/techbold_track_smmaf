import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { api, type BackendEmployee } from "@/lib/api/client";

const STORAGE_KEY = "phoenix.technician";

export interface AuthContextValue {
  technician: BackendEmployee | null;
  isAuthenticated: boolean;
  /** True until the persisted session has been read from storage. */
  loading: boolean;
  /** Fetch the technician identity from the ERP and persist the session. */
  login: () => Promise<BackendEmployee>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStored(): BackendEmployee | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BackendEmployee) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [technician, setTechnician] = useState<BackendEmployee | null>(null);
  // Start in a loading state so guards don't redirect before storage is read.
  const [loading, setLoading] = useState(true);

  // Hydrate from localStorage on mount (client only).
  useEffect(() => {
    setTechnician(readStored());
    setLoading(false);
  }, []);

  const login = async () => {
    const me = await api.me.get();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(me));
    } catch {
      // Non-fatal — session just won't persist across reloads.
    }
    setTechnician(me);
    return me;
  };

  const logout = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setTechnician(null);
  };

  return (
    <AuthContext.Provider
      value={{ technician, isAuthenticated: technician !== null, loading, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
