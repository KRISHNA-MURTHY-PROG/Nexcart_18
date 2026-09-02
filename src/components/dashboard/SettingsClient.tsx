"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Loader2, Store, CreditCard, Check } from "lucide-react";
import { SUBSCRIPTION_PLANS } from "@/lib/constants";
import { formatPrice } from "@/lib/utils";
import { StoreHandleField } from "@/components/seller/StoreHandleField";

const settingsSchema = z.object({
  storeName: z.string().min(3, "Min 3 characters"),
  description: z.string().min(20, "Min 20 characters").max(1000),
  contactEmail: z.string().email().optional().or(z.literal("")),
  contactPhone: z.string().regex(/^[6-9]\d{9}$/, "Invalid phone").optional().or(z.literal("")),
  website: z.string().url("Invalid URL").optional().or(z.literal("")),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().regex(/^\d{6}$/).optional().or(z.literal("")),
  gstNumber: z.string().optional().or(z.literal("")),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

interface SettingsPageClientProps {
  seller: { storeName: string; storeHandle?: string | null; description?: string | null; contactEmail?: string | null; contactPhone?: string | null; website?: string | null; city?: string | null; state?: string | null; pincode?: string | null; gstNumber?: string | null; sellerId: string; subscription?: { plan: string; status: string } | null };
}

export function SettingsPageClient({ seller }: SettingsPageClientProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  // Handle is managed outside react-hook-form — StoreHandleField owns its own
  // debounced availability state.
  const [storeHandle, setStoreHandle] = useState(seller.storeHandle ?? "");
  const [handleValid, setHandleValid] = useState(true);

  const { register, handleSubmit, formState: { errors } } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      storeName: seller.storeName,
      description: seller.description ?? "",
      contactEmail: seller.contactEmail ?? "",
      contactPhone: seller.contactPhone ?? "",
      website: seller.website ?? "",
      city: seller.city ?? "",
      state: seller.state ?? "",
      pincode: seller.pincode ?? "",
      gstNumber: seller.gstNumber ?? "",
    },
  });

  const onSubmit = async (data: SettingsFormData) => {
    if (storeHandle.trim() && !handleValid) {
      toast.error("Please choose an available store handle.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/sellers/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          ...(storeHandle.trim() ? { storeHandle: storeHandle.trim() } : {}),
        }),
      });
      if (!res.ok) {
        // Surface the specific reason (handle taken, reserved, ...) instead of
        // a generic failure message.
        const body = await res.json().catch(() => null);
        throw new Error(typeof body?.error === "string" ? body.error : "");
      }
      toast.success("Store profile updated");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const handleUpgrade = async (plan: "STANDARD" | "PREMIUM") => {
    setUpgrading(true);
    try {
      const res = await fetch("/api/payments/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Load Razorpay
      const Razorpay = (window as any).Razorpay;
      const rzp = new Razorpay({
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        order_id: data.id,
        name: "NexCart",
        description: `${plan} Plan — Annual Subscription`,
        handler: async (response: any) => {
          const verifyRes = await fetch("/api/payments/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...response, plan, type: "subscription" }),
          });
          if (verifyRes.ok) {
            toast.success(`Upgraded to ${plan} plan!`);
            router.refresh();
          } else {
            toast.error("Payment verification failed");
          }
        },
        prefill: { email: seller.contactEmail ?? "" },
        theme: { color: "#09090b" },
      });
      rzp.open();
    } catch (e: any) {
      toast.error(e.message ?? "Upgrade failed");
    } finally {
      setUpgrading(false);
    }
  };

  const currentPlan = seller.subscription?.plan ?? "FREE";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Store Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your store profile and subscription</p>
      </div>

      {/* Profile Form */}
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border/50 px-5 py-4">
          <Store className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-medium text-sm">Store Profile</h2>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-5">
          <div className="space-y-1.5">
            <Label>Store Name</Label>
            <Input {...register("storeName")} />
            {errors.storeName && <p className="text-xs text-destructive">{errors.storeName.message}</p>}
          </div>

          {/* Vanity store URL */}
          <StoreHandleField
            value={storeHandle}
            onChange={setStoreHandle}
            onValidityChange={setHandleValid}
            currentHandle={seller.storeHandle ?? null}
            helpText={
              seller.storeHandle
                ? "Changing this updates your store link. Your old link will keep redirecting here."
                : "Claim a short link for your store — put it in your Instagram bio."
            }
          />
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea {...register("description")} rows={4} className="resize-none" />
            {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Contact Email</Label>
              <Input {...register("contactEmail")} type="email" placeholder="store@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Phone</Label>
              <Input {...register("contactPhone")} placeholder="9876543210" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input {...register("city")} />
            </div>
            <div className="space-y-1.5">
              <Label>State</Label>
              <Input {...register("state")} />
            </div>
            <div className="space-y-1.5">
              <Label>Pincode</Label>
              <Input {...register("pincode")} maxLength={6} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>GST Number (optional)</Label>
            <Input {...register("gstNumber")} placeholder="22AAAAA0000A1Z5" className="font-mono uppercase" />
          </div>
          <Button type="submit" disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </form>
      </div>

      {/* Subscription */}
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border/50 px-5 py-4">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-medium text-sm">Subscription Plan</h2>
        </div>
        <div className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <Badge variant={currentPlan === "PREMIUM" ? "default" : currentPlan === "STANDARD" ? "secondary" : "outline"} className="text-sm px-3 py-1">
              {currentPlan}
            </Badge>
            <span className="text-sm text-muted-foreground">Current plan</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {(["TRIAL", "STANDARD", "PREMIUM"] as const).map((plan) => {
              const info = SUBSCRIPTION_PLANS[plan];
              const isCurrent = currentPlan === plan;
              return (
                <div key={plan} className={`rounded-xl border p-5 transition-all ${isCurrent ? "border-foreground" : "border-border/50"}`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold">{info.name}</span>
                    {isCurrent && <Check className="h-4 w-4 text-green-500" />}
                  </div>
                  <div className="text-2xl font-bold mb-1">
                    {info.yearlyPrice === 0 ? "Free" : formatPrice(info.yearlyPrice)}
                  </div>
                  {info.yearlyPrice > 0 && <p className="text-xs text-muted-foreground mb-4">/year</p>}
                  <Separator className="my-3" />
                  <ul className="space-y-1.5">
                    <li className="text-xs text-muted-foreground">
                      {info.productLimit === Infinity ? "Unlimited" : info.productLimit} products
                    </li>
                    <li className="text-xs text-muted-foreground">{info.analytics ? "Full analytics" : "No analytics"}</li>
                    <li className="text-xs text-muted-foreground">{info.priority ? "Priority visibility" : "Standard visibility"}</li>
                  </ul>
                  {!isCurrent && plan !== "TRIAL" && (
                    <Button
                      size="sm"
                      variant={plan === "PREMIUM" ? "default" : "outline"}
                      className="mt-4 w-full text-xs"
                      onClick={() => handleUpgrade(plan as "STANDARD" | "PREMIUM")}
                      disabled={upgrading}
                    >
                      {upgrading ? <Loader2 className="h-3 w-3 animate-spin" /> : `Upgrade to ${info.name}`}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
