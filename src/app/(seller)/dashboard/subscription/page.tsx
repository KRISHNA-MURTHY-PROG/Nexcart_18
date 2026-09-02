"use client";

import { useEffect, useState } from "react";
import { useAuthContext } from "@/context/AuthContext";
import { formatDate } from "@/lib/utils";
import { SubscriptionClient } from "@/components/dashboard/SubscriptionClient";
import { Loader2, Home } from "lucide-react";
import Link from "next/link";
import { auth } from "@/lib/firebase";

interface SubscriptionData {
  sellerId: string;
  subscription: {
    plan:         "TRIAL" | "STANDARD" | "PREMIUM";
    billingCycle: string | null;
    status:       string;
    endDate:      string | null;
  } | null;
}

export default function SubscriptionPage() {
  const { user } = useAuthContext();
  const [data, setData]       = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = user?.uid ?? (() => { try { return localStorage.getItem("nxc-uid"); } catch { return null; } })();
    if (!uid) return;
    if (user?.uid) { try { localStorage.setItem("nxc-uid", user.uid); } catch {} }
    (() => {
      fetch("/api/sellers/profile", { headers: { Authorization: `Bearer ${uid}` } })
        .then((r) => r.json())
        .then((d) => {
          if (d.sellerId) setData({ sellerId: d.sellerId, subscription: d.subscription ?? null });
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    })();
  }, [user]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentPlan  = data?.subscription?.plan ?? "TRIAL";
  const currentCycle = data?.subscription?.billingCycle ?? null;
  const status       = data?.subscription?.status ?? "ACTIVE";
  const endDate      = data?.subscription?.endDate ?? null;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Link href="/" className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
              <Home className="h-3.5 w-3.5" /><span>Home</span>
            </Link>
            <span className="text-muted-foreground/50 text-[12px]">/</span>
            <span className="text-[12px] text-foreground font-medium">Subscription</span>
          </div>
          <h1 className="text-xl font-semibold">Subscription</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Manage your plan and billing</p>
        </div>
        <Link href="/"><button className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2.5 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-sm"><Home className="h-4 w-4" /><span className="hidden sm:inline">Home</span></button></Link>
      </div>

      {/* Current plan banner */}
      <div className="mb-6 rounded-xl border border-border/50 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Current plan</div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold">{currentPlan}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                status === "ACTIVE"
                  ? "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400"
                  : "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400"
              }`}>{status}</span>
            </div>
            {endDate && (
              <p className="mt-1 text-xs text-muted-foreground">
                {status === "ACTIVE" ? "Renews / expires" : "Expired"} on {formatDate(endDate)}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground">Seller ID</div>
            <div className="font-mono font-semibold">{data?.sellerId ?? "—"}</div>
          </div>
        </div>
      </div>

      <SubscriptionClient
        currentPlan={currentPlan}
        currentCycle={currentCycle}
        sellerId={data?.sellerId ?? ""}
        sellerEmail={user?.email ?? ""}
        trialEndDate={currentPlan === "TRIAL" && endDate ? formatDate(endDate) : null}
      />

      {/* Feature comparison table */}
      <div className="mt-8 overflow-hidden rounded-xl border border-border/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Feature</th>
              {(["TRIAL", "STANDARD", "PREMIUM"] as const).map((p) => (
                <th key={p} className={`px-5 py-3 text-center text-xs font-semibold uppercase tracking-wide ${currentPlan === p ? "text-foreground" : "text-muted-foreground"}`}>
                  {p}{currentPlan === p && <span className="ml-1.5 rounded-full bg-foreground px-1.5 py-0.5 text-[9px] font-bold text-background">NOW</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {[
              { feature: "Max products",         TRIAL: "Unlimited", STANDARD: "Unlimited", PREMIUM: "Unlimited" },
              { feature: "Analytics dashboard",  TRIAL: "✓",        STANDARD: "✓",         PREMIUM: "✓"         },
              { feature: "Coupon creation",      TRIAL: "✗",        STANDARD: "✓",         PREMIUM: "✓"         },
              { feature: "Priority visibility",  TRIAL: "✗",        STANDARD: "✗",         PREMIUM: "✓"         },
              { feature: "Featured listings",    TRIAL: "✗",        STANDARD: "✗",         PREMIUM: "✓"         },
              { feature: "Monthly price",        TRIAL: "Free",     STANDARD: "₹160",      PREMIUM: "₹260"      },
              { feature: "Yearly price",         TRIAL: "—",        STANDARD: "₹1,500/yr", PREMIUM: "₹2,400/yr" },
            ].map((row) => (
              <tr key={row.feature}>
                <td className="px-5 py-3 text-sm text-muted-foreground">{row.feature}</td>
                {(["TRIAL", "STANDARD", "PREMIUM"] as const).map((p) => (
                  <td key={p} className={`px-5 py-3 text-center text-sm ${
                    currentPlan === p ? "font-medium text-foreground" : "text-muted-foreground"
                  } ${row[p] === "✓" ? "text-green-600 dark:text-green-400" : row[p] === "✗" ? "opacity-30" : ""}`}>
                    {row[p]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
