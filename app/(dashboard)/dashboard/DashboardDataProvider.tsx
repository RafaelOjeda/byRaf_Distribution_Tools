"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { buildReport, parseCostDrafts, type Report, type SkuInputs, type Snapshot } from "@/lib/gateway";
import type { LotDraft, SkuField, Step } from "./types";

type PeriodsBySource = Record<string, { periods: { id: string; label: string }[]; error?: string }>;

interface DashboardData {
  step: Step;
  setStep: Dispatch<SetStateAction<Step>>;
  /** connections[sourceId][fieldKey] = pasted value. Held in memory only. */
  connections: Record<string, Record<string, string>>;
  setConnections: Dispatch<SetStateAction<Record<string, Record<string, string>>>>;
  periodsBySource: PeriodsBySource;
  setPeriodsBySource: Dispatch<SetStateAction<PeriodsBySource>>;
  selectedPeriods: Record<string, Set<string>>;
  setSelectedPeriods: Dispatch<SetStateAction<Record<string, Set<string>>>>;
  /** Periods from an imported file, applied the next time the period list loads. */
  pendingPeriods: Record<string, string[]> | null;
  setPendingPeriods: Dispatch<SetStateAction<Record<string, string[]> | null>>;
  snapshot: Snapshot | null;
  setSnapshot: Dispatch<SetStateAction<Snapshot | null>>;
  sourceFilter: string[] | "all";
  setSourceFilter: Dispatch<SetStateAction<string[] | "all">>;
  /** Raw strings keyed by normalized SKU, so a half-typed "1." doesn't fight the input. */
  inputs: Record<string, Partial<Record<SkuField, string>>>;
  setInputs: Dispatch<SetStateAction<Record<string, Partial<Record<SkuField, string>>>>>;
  lotDrafts: Record<string, LotDraft[]>;
  setLotDrafts: Dispatch<SetStateAction<Record<string, LotDraft[]>>>;
  aliasDrafts: Record<string, string>;
  setAliasDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  /** Typed costs as numbers - see parseCostDrafts. */
  parsedInputs: ReturnType<typeof parseCostDrafts>;
  /** null until data is loaded. A cost edit only re-runs buildReport (pure, no network). */
  liveReport: Report | null;
}

const DashboardDataContext = createContext<DashboardData | null>(null);

/**
 * Holds the loaded data and typed costs above the pages, so moving between
 * Dashboard and Margins keeps them. Nothing here is persisted: a refresh
 * clears it, exactly as before.
 */
export function DashboardDataProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<Step>("connect");
  const [connections, setConnections] = useState<Record<string, Record<string, string>>>({});
  const [periodsBySource, setPeriodsBySource] = useState<PeriodsBySource>({});
  const [selectedPeriods, setSelectedPeriods] = useState<Record<string, Set<string>>>({});
  const [pendingPeriods, setPendingPeriods] = useState<Record<string, string[]> | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string[] | "all">("all");
  const [inputs, setInputs] = useState<Record<string, Partial<Record<SkuField, string>>>>({});
  const [lotDrafts, setLotDrafts] = useState<Record<string, LotDraft[]>>({});
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({});

  const parsedInputs = useMemo(
    () => parseCostDrafts({ fields: inputs, lots: lotDrafts, aliases: aliasDrafts }),
    [inputs, lotDrafts, aliasDrafts]
  );
  const liveReport = useMemo(() => {
    if (!snapshot) return null;
    return buildReport(snapshot, parsedInputs as Record<string, SkuInputs>, { sourceFilter });
  }, [snapshot, parsedInputs, sourceFilter]);

  const value: DashboardData = {
    step, setStep,
    connections, setConnections,
    periodsBySource, setPeriodsBySource,
    selectedPeriods, setSelectedPeriods,
    pendingPeriods, setPendingPeriods,
    snapshot, setSnapshot,
    sourceFilter, setSourceFilter,
    inputs, setInputs,
    lotDrafts, setLotDrafts,
    aliasDrafts, setAliasDrafts,
    parsedInputs,
    liveReport,
  };
  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>;
}

export function useDashboardData(): DashboardData {
  const ctx = useContext(DashboardDataContext);
  if (!ctx) throw new Error("useDashboardData must be used inside DashboardDataProvider");
  return ctx;
}
