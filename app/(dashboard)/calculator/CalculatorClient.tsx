"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, useStyles } from "@/components/ui";
import {
  estimateListing,
  normalizeSku,
  prefillFromSku,
  type FeeModel,
} from "@/lib/gateway";
import { describeFeeModels } from "@/lib/gateway/actions";
import { useDashboardData } from "../dashboard/DashboardDataProvider";
import { KpiTile } from "../dashboard/components/shared/KpiTile";
import { money } from "../dashboard/utils/format";

const num = (s: string): number | null => {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * Predicts referral fee, shipping and profit for a price you're
 * considering, before an order exists. Uses the same prediction as
 * estimates for unsettled orders; see lib/gateway/engine/fee-predict.ts.
 */
export default function CalculatorClient() {
  const { liveReport, snapshot, parsedInputs, setInputs } = useDashboardData();
  const { input } = useStyles();

  const [models, setModels] = useState<FeeModel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const [categoryId, setCategoryId] = useState("");
  const [weight, setWeight] = useState("");
  const [fulfillment, setFulfillment] = useState<"self" | "managed">("self");
  const [unitCost, setUnitCost] = useState("");
  const [boxCost, setBoxCost] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    describeFeeModels().then(
      (m) => {
        setModels(m);
        setSourceId((cur) => cur || m[0]?.sourceId || "");
      },
      (e) => setLoadError(e instanceof Error ? e.message : "Couldn't load fee schedules.")
    );
  }, []);

  const model = models?.find((m) => m.sourceId === sourceId) ?? null;
  const knownSkus = useMemo(() => liveReport?.products.map((p) => p.sku) ?? [], [liveReport]);

  function onSkuChange(value: string) {
    setSku(value);
    setSaved(false);
    if (!model || !knownSkus.includes(normalizeSku(value))) return;
    const p = prefillFromSku(snapshot, model, parsedInputs, value);
    if (p.price !== null) setPrice(String(p.price));
    if (p.categoryId) setCategoryId(p.categoryId);
    if (p.weightLb !== null) setWeight(String(p.weightLb));
    if (p.unitCost !== null) setUnitCost(String(p.unitCost));
    if (p.boxCost !== null) setBoxCost(String(p.boxCost));
  }

  const priceN = num(price);
  const estimate = useMemo(() => {
    if (!model || priceN === null || priceN <= 0) return null;
    return estimateListing(model, liveReport?.orderLines ?? [], parsedInputs, {
      price: priceN,
      qty: Math.max(1, Math.floor(num(qty) ?? 1)),
      categoryId: categoryId || null,
      weightLb: num(weight),
      fulfillment,
      unitCost: num(unitCost),
      boxCost: num(boxCost),
    });
  }, [model, liveReport, parsedInputs, priceN, qty, categoryId, weight, fulfillment, unitCost, boxCost]);

  function saveToSku() {
    const key = normalizeSku(sku);
    if (!key) return;
    setInputs((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...(weight.trim() !== "" ? { weightLb: weight } : {}),
        ...(categoryId ? { feeCategory: categoryId } : {}),
      },
    }));
    setSaved(true);
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[28px] leading-9 font-normal">Fee calculator</h1>
        <Card className="p-6 text-sm text-red-600">{loadError}</Card>
      </div>
    );
  }
  if (models && models.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[28px] leading-9 font-normal">Fee calculator</h1>
        <Card className="p-6 text-sm text-sc-ink-2">
          No connected marketplace publishes a fee schedule yet.
        </Card>
      </div>
    );
  }

  const p = estimate?.prediction;
  const label = "flex min-w-0 flex-col gap-1 text-xs text-sc-ink-2";
  const field = "w-full min-w-0 text-sc-ink";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] leading-9 font-normal">Fee calculator</h1>
      <p className="max-w-prose text-sm text-sc-ink-2">
        Predict the referral fee and shipping for a price you&apos;re
        considering. Referral comes from the marketplace&apos;s published rates
        for the category; shipping is learned from your own settled shipments,
        by weight.
      </p>

      {model?.referral.lastVerified === null && (
        <Card className="p-3 text-sm text-amber-600">
          The {model.sourceLabel} rates in this calculator haven&apos;t been
          checked against the published schedule yet, so every result is marked
          low-confidence. Source: {model.referral.sourceUrl}
        </Card>
      )}

      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {models && models.length > 1 && (
          <label className={label}>
            Marketplace
            <select
              className={`${input} ${field}`}
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setCategoryId("");
              }}
            >
              {models.map((m) => (
                <option key={m.sourceId} value={m.sourceId}>
                  {m.sourceLabel}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={label}>
          SKU (optional — fills in what&apos;s known)
          <Input
            list="calc-skus"
            value={sku}
            onChange={(e) => onSkuChange(e.target.value)}
            placeholder="Pick or leave blank"
            className={field}
          />
          <datalist id="calc-skus">
            {knownSkus.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className={label}>
          Price per unit
          <Input type="number" inputMode="decimal" step="0.01" min="0" value={price}
            onChange={(e) => setPrice(e.target.value)} className={`${field} text-right`} />
        </label>
        <label className={label}>
          Units in the order
          <Input type="number" inputMode="numeric" step="1" min="1" value={qty}
            onChange={(e) => setQty(e.target.value)} className={`${field} text-right`} />
        </label>
        <label className={label}>
          Category
          <select className={`${input} ${field}`} value={categoryId}
            onChange={(e) => { setCategoryId(e.target.value); setSaved(false); }}>
            <option value="">Choose…</option>
            {model?.referral.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className={label}>
          Weight per unit (lb)
          <Input type="number" inputMode="decimal" step="0.01" min="0" value={weight}
            onChange={(e) => { setWeight(e.target.value); setSaved(false); }}
            className={`${field} text-right`} />
        </label>
        <label className={label}>
          Who ships it
          <select className={`${input} ${field}`} value={fulfillment}
            onChange={(e) => setFulfillment(e.target.value as "self" | "managed")}>
            <option value="self">I ship it</option>
            <option value="managed">{model?.sourceLabel ?? "The marketplace"} ships it</option>
          </select>
        </label>
        <label className={label}>
          Your cost per unit
          <Input type="number" inputMode="decimal" step="0.01" min="0" value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)} className={`${field} text-right`} />
        </label>
        <label className={label}>
          Box cost per shipment
          <Input type="number" inputMode="decimal" step="0.01" min="0" value={boxCost}
            onChange={(e) => setBoxCost(e.target.value)} className={`${field} text-right`} />
        </label>
      </Card>

      {!liveReport && fulfillment === "self" && (
        <p className="text-sm text-sc-ink-2">
          Shipping is learned from your settled shipments.{" "}
          <Link href="/dashboard" className="underline underline-offset-2">
            Load your data on the dashboard
          </Link>{" "}
          to get a shipping prediction.
        </p>
      )}

      {estimate && p ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiTile label="Referral fee" value={p.referral.fee === null ? "—" : money(p.referral.fee)}>
              {p.referral.rate !== null ? `${pct(p.referral.rate)} of price` : p.referral.note}
            </KpiTile>
            <KpiTile label="Shipping" value={p.shipping.cost === null ? "—" : money(p.shipping.cost)}>
              {p.shipping.cost === null ? p.shipping.note : "per shipment"}
            </KpiTile>
            <KpiTile label="Net after fees" value={p.net === null ? "—" : money(p.net)}>
              {p.net === null ? "needs both fees" : `of ${money(estimate.revenue)} revenue`}
            </KpiTile>
            <KpiTile label="Profit" value={estimate.profit === null ? "—" : money(estimate.profit)} hero>
              {estimate.profit === null
                ? p.net === null ? "needs both fees" : "enter your cost per unit"
                : "after your cost"}
            </KpiTile>
            <KpiTile label="Margin" value={estimate.margin === null ? "—" : pct(estimate.margin)}>
              of revenue
            </KpiTile>
          </div>

          <Card className="flex flex-col gap-1 p-4 text-sm text-sc-ink-2">
            <p><span className="text-sc-ink">Referral:</span> {p.referral.note}{p.referral.lowConfidence ? " — low confidence" : ""}</p>
            <p><span className="text-sc-ink">Shipping:</span> {p.shipping.note}{p.shipping.lowConfidence ? " — low confidence" : ""}</p>
            {model?.referral.note && <p>{model.referral.note}</p>}
          </Card>

          {normalizeSku(sku) !== "" && (weight.trim() !== "" || categoryId !== "") && (
            <div className="flex items-center gap-3">
              <Button onClick={saveToSku}>Save weight and category to {normalizeSku(sku)}</Button>
              {saved && (
                <span className="text-sm text-sc-ink-2" role="status">
                  Saved. Orders for this SKU with no settled history will now be predicted from it.
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-sc-ink-2">Enter a price to see the predicted fees.</p>
      )}
    </div>
  );
}
