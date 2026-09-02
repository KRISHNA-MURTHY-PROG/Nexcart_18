"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X, Loader2, Zap, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { auth } from "@/lib/firebase";

// Window.Razorpay is declared in checkout/page.tsx — use any cast below

interface SubscriptionClientProps {
  currentPlan: string;
  currentCycle?: string | null;
  sellerId: string;
  sellerEmail: string;
  trialEndDate?: string | null;
}

type Plan = "MONTHLY" | "HALF_YEARLY" | "YEARLY";

const PRICES: Record<Plan, number> = {
  MONTHLY: 180,
  HALF_YEARLY: 900,
  YEARLY: 1500,
};

const CYCLE_LABELS: Record<Plan, { short: string; per: string; months: number }> = {
  MONTHLY:     { short: "Monthly",  per: "/ mo",    months: 1  },
  HALF_YEARLY: { short: "6 months", per: "/ 6 mo",  months: 6  },
  YEARLY:      { short: "1 year",   per: "/ yr",    months: 12 },
};

function savings(cycle: Plan): number | null {
  if (cycle === "MONTHLY") return null;
  const monthly = PRICES.MONTHLY;
  const actual  = PRICES[cycle];
  const wouldPay = monthly * CYCLE_LABELS[cycle].months;
  return wouldPay - actual;
}

const ALL_FEATURES = [
  { label: "Unlimited product uploads", included: true  },
  { label: "Full storefront & store management",  included: true  },
  { label: "Orders & analytics dashboard",        included: true  },
  { label: "Customer reviews & ratings",          included: true  },
  { label: "Coupon & offer creation",             included: true  },
  { label: "24/7 seller support",                 included: true  },
];

export function SubscriptionClient({
  currentPlan,
  currentCycle,
  sellerId,
  sellerEmail,
  trialEndDate,
}: SubscriptionClientProps) {
  const router  = useRouter();
  const [cycle, setCycle]   = useState<Plan>("MONTHLY");
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, []);

  const handleUpgrade = async (plan: Plan) => {
    setLoading(plan);
    try {
      const currentUser = auth.currentUser;
      const token = currentUser ? await currentUser.getIdToken() : null;
      if (!token) { toast.error("Please log in again."); setLoading(null); return; }

      const res = await fetch("/api/payments/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create payment");

      const rzp = new window.Razorpay({
        key:       data.keyId,
        amount:    data.amount,
        currency:  data.currency ?? "INR",
        order_id:  data.id,
        name:      "NexCart",
        description: `NexCart Subscription — ${CYCLE_LABELS[plan].short}`,
        handler: async (response: Record<string, string>) => {
          const verifyRes = await fetch("/api/payments", {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              razorpayOrderId:   response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
              paymentId:         data.paymentId,
            }),
          });
          if (verifyRes.ok) {
            toast.success(`🎉 Subscription activated (${CYCLE_LABELS[plan].short})!`);
            router.refresh();
          } else {
            toast.error("Payment verification failed. Contact support.");
          }
        },
        prefill: { email: sellerEmail },
        notes:   { sellerId, plan },
        theme:   { color: "#09090b" },
        modal:   { ondismiss: () => setLoading(null) },
      });
      rzp.open();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upgrade failed");
      setLoading(null);
    }
  };

  const isTrial = currentPlan === "TRIAL";

  return (
    <div>
      {/* Trial banner */}
      {isTrial && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-5 py-3.5 dark:border-green-900/40 dark:bg-green-950/20">
          <Gift className="h-5 w-5 shrink-0 text-green-600" />
          <p className="text-sm text-green-800 dark:text-green-300">
            <span className="font-semibold">Free Trial Active (15 days)</span>
            {trialEndDate && <span className="font-normal"> — Keep unlimited products until {trialEndDate}. After trial, products go offline unless you subscribe.</span>}
          </p>
        </div>
      )}

      {/* Billing toggle */}
      <div className="mb-6 flex items-center gap-2">
        {(["MONTHLY", "HALF_YEARLY", "YEARLY"] as Plan[]).map((c) => {
          const save = savings(c);
          return (
            <button
              key={c}
              onClick={() => setCycle(c)}
              className={cn(
                "relative rounded-full border px-4 py-1.5 text-sm transition-all",
                cycle === c
                  ? "border-foreground bg-foreground text-background font-medium"
                  : "border-border bg-background text-muted-foreground hover:border-foreground/30"
              )}
            >
              {CYCLE_LABELS[c].short}
              {save && c !== "MONTHLY" && (
                <span className="absolute -top-2.5 -right-1 rounded-full bg-green-600 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                  Save ₹{save}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

        {/* Trial card */}
        <div className={cn(
          "relative rounded-xl border p-5 flex flex-col",
          isTrial ? "border-foreground bg-foreground text-background" : "border-border/50 bg-card"
        )}>
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className={cn("font-semibold text-sm", isTrial ? "text-background" : "text-foreground")}>Free Trial</h3>
              {isTrial && <span className="rounded-full bg-background/20 px-2 py-0.5 text-[10px] font-medium text-background">Active</span>}
            </div>
            <div className={cn("text-3xl font-bold", isTrial ? "text-background" : "")}>₹0</div>
            <p className={cn("text-xs mt-0.5", isTrial ? "text-background/60" : "text-muted-foreground")}>15 days from signup</p>
          </div>
          <ul className="flex-1 space-y-2 mb-5">
            {ALL_FEATURES.map((f) => (
              <li key={f.label} className="flex items-center gap-2 text-xs">
                <Check className={cn("h-3.5 w-3.5 shrink-0", isTrial ? "text-background/70" : "text-green-500")} />
                <span className={isTrial ? "text-background/80" : "text-muted-foreground"}>{f.label}</span>
              </li>
            ))}
          </ul>
          <div className={cn("w-full rounded-lg border py-2 text-center text-xs font-medium",
            isTrial ? "border-background/20 text-background/60" : "border-border text-muted-foreground opacity-50")}>
            {isTrial ? "Current plan" : "Unlimited trial period"}
          </div>
        </div>

        {/* Premium card */}
        <div className={cn(
          "relative rounded-xl border p-5 flex flex-col",
          !isTrial ? "border-foreground bg-foreground text-background" : "border-border/50 bg-card"
        )}>
          <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
            <span className="rounded-full bg-foreground px-3 py-0.5 text-[10px] font-semibold text-background">RECOMMENDED</span>
          </div>
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className={cn("font-semibold text-sm", !isTrial ? "text-background" : "text-foreground")}>Premium Seller</h3>
              {!isTrial && <span className="rounded-full bg-background/20 px-2 py-0.5 text-[10px] font-medium text-background">Active</span>}
            </div>
            <div className={cn("text-3xl font-bold", !isTrial ? "text-background" : "")}>
              ₹{PRICES[cycle].toLocaleString("en-IN")}
              <span className={cn("text-sm font-normal ml-1", !isTrial ? "text-background/60" : "text-muted-foreground")}>{CYCLE_LABELS[cycle].per}</span>
            </div>
            {savings(cycle) ? (
              <p className={cn("text-xs mt-1 font-medium", !isTrial ? "text-background/70" : "text-green-600 dark:text-green-400")}>
                💰 Save ₹{savings(cycle)} vs monthly
              </p>
            ) : <p className="text-xs mt-0.5 text-transparent select-none">·</p>}
          </div>
          <ul className="flex-1 space-y-2 mb-5">
            {ALL_FEATURES.map((f) => (
              <li key={f.label} className="flex items-center gap-2 text-xs">
                <Check className={cn("h-3.5 w-3.5 shrink-0", !isTrial ? "text-background/70" : "text-green-500")} />
                <span className={!isTrial ? "text-background/80" : "text-muted-foreground"}>{f.label}</span>
              </li>
            ))}
          </ul>
          {!isTrial ? (
            <div className="w-full rounded-lg border border-background/20 py-2 text-center text-xs font-medium text-background/60">
              Current plan
            </div>
          ) : (
            <Button
              size="sm"
              variant="default"
              className="w-full gap-2 text-xs"
              onClick={() => handleUpgrade(cycle)}
              disabled={!!loading}
            >
              {loading === cycle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              {loading === cycle ? "Processing..." : "Subscribe Now"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
