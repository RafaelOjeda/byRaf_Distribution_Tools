"use server";

import { CONNECTORS } from "./connectors/registry";
import {
  brandSnapshot,
  type Connections,
  type PeriodList,
  type Snapshot,
  type SnapshotData,
  type SourceDescriptor,
} from "./contract";

// Settlement typically runs a couple of weeks behind, so 60 days
// comfortably covers every order that could still be unsettled.
const UNSETTLED_LOOKBACK_DAYS = 60;

function hasCredentials(creds: Record<string, string> | undefined): boolean {
  return !!creds && Object.values(creds).some((v) => v.trim() !== "");
}

/** Every marketplace the middleware knows about. The dashboard renders these; it never names one. */
export async function describeSources(): Promise<SourceDescriptor[]> {
  return CONNECTORS.map((c) => c.descriptor);
}

/**
 * Lists each connected source's available settlement periods, without
 * pulling any line-item data yet. One source failing (bad credentials,
 * network error) doesn't block the others from listing.
 */
export async function listPeriods(
  connections: Connections
): Promise<Record<string, PeriodList>> {
  const out: Record<string, PeriodList> = {};

  await Promise.all(
    CONNECTORS.filter(
      (c) =>
        c.descriptor.capabilities.settlements &&
        hasCredentials(connections[c.descriptor.id])
    ).map(async (c) => {
      try {
        const periods = await c.listPeriodsFor(connections[c.descriptor.id]);
        out[c.descriptor.id] = { periods };
      } catch (err) {
        out[c.descriptor.id] = {
          periods: [],
          error: err instanceof Error ? err.message : "Unknown error.",
        };
      }
    })
  );

  return out;
}

/**
 * The expensive call: connects to every connected source, normalizes the
 * results and runs fee estimation for unsettled orders. Credentials are
 * used for this one request only - never stored, cached or logged.
 */
export async function fetchSnapshot(
  connections: Connections,
  periods: Record<string, string[]>
): Promise<Snapshot> {
  const since = new Date(Date.now() - UNSETTLED_LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const connected = CONNECTORS.filter((c) =>
    hasCredentials(connections[c.descriptor.id])
  );

  const sources: SnapshotData["sources"] = await Promise.all(
    connected.map(async (c) => {
      const { id, label } = c.descriptor;
      try {
        const snap = await c.snapshot(
          connections[id],
          periods[id] ?? [],
          since
        );
        if (snap.errors.length > 0) {
          return {
            id,
            label,
            status: "error" as const,
            error: snap.errors.join("; "),
            lines: snap.lines,
            charges: snap.charges,
            orderDates: snap.orderDates,
            inventory: snap.inventory,
            catalog: snap.catalog,
          };
        }
        return {
          id,
          label,
          status: "ok" as const,
          lines: snap.lines,
          charges: snap.charges,
          orderDates: snap.orderDates,
          inventory: snap.inventory,
          catalog: snap.catalog,
        };
      } catch (err) {
        return {
          id,
          label,
          status: "error" as const,
          error: err instanceof Error ? err.message : "Unknown error.",
          lines: [],
          charges: [],
          orderDates: {},
          inventory: [],
          catalog: [],
        };
      }
    })
  );

  return brandSnapshot<SnapshotData>({ sources });
}
