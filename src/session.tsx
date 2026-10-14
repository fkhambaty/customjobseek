import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { parseStoredWizardStep, type StoredWizardStep } from "../shared/onboardingWizard";
import type { Account } from "../shared/types";
import type { CapacityPause } from "../shared/dbCapacity";
import { api, ApiError, CAPACITY_EVENT } from "./api";

interface SessionValue {
  account: Account | null;
  onboardingStep: StoredWizardStep;
  loading: boolean;
  /** Set while the service is paused for today's database allowance. */
  pause: CapacityPause | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  setOnboardingStep: (step: StoredWizardStep) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<StoredWizardStep>("");
  const [loading, setLoading] = useState(true);
  const [pause, setPause] = useState<CapacityPause | null>(null);

  useEffect(() => {
    const onPause = (event: Event) => setPause((event as CustomEvent<CapacityPause>).detail);
    window.addEventListener(CAPACITY_EVENT, onPause);
    return () => window.removeEventListener(CAPACITY_EVENT, onPause);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setAccount(me);
      setOnboardingStep(parseStoredWizardStep(me.onboardingStep));
      setPause(null);
    } catch (e) {
      if (!(e instanceof ApiError) || (e.status !== 401 && !e.pause)) console.error(e);
      setAccount(null);
      setOnboardingStep("");
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setAccount(null);
    setOnboardingStep("");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ account, onboardingStep, loading, pause, refresh, signOut, setOnboardingStep }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
