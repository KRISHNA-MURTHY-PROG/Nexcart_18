/**
 * GET /api/cron/subscription-reminders
 * Called daily by Vercel Cron. Sends trial expiry reminder emails on day 14 and day 15.
 * Secured with CRON_SECRET env var.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendSubReminderEmail } from "@/lib/email";

function formatDate(date: Date) {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("x-cron-secret") !== process.env.CRON_SECRET)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const now     = new Date();
  const appUrl  = process.env.NEXT_PUBLIC_APP_URL || "https://nexcart.vercel.app";
  const subPage = `${appUrl}/dashboard/subscription`;

  const subs = await db.subscription.findMany({
    where:   { status: "ACTIVE", plan: "TRIAL" },
    include: { seller: { include: { user: { select: { email: true, name: true } } } } },
  });

  let sent14d = 0, sent15d = 0;

  for (const sub of subs) {
    if (!sub.trialEndDate) continue;
    
    const daysLeft = Math.ceil((sub.trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const base = {
      sellerEmail:         sub.seller.user.email,
      sellerName:          sub.seller.user.name ?? sub.seller.storeName,
      storeName:           sub.seller.storeName,
      endDate:             formatDate(sub.trialEndDate),
      subscriptionPageUrl: subPage,
    };

    // Send reminder on day 14 (when 2 days are left)
    if (daysLeft === 2 && !sub.reminderSent6d) {
      await sendSubReminderEmail({ ...base, daysLeft: 2 });
      await db.subscription.update({ where: { id: sub.id }, data: { reminderSent6d: true } });
      sent14d++;
    }

    // Send final reminder on day 15 (last day - when 1 day is left)
    if (daysLeft === 1 && !sub.reminderSent7d) {
      await sendSubReminderEmail({ ...base, daysLeft: 1 });
      await db.subscription.update({ where: { id: sub.id }, data: { reminderSent7d: true } });
      sent15d++;
    }
  }

  return NextResponse.json({ ok: true, sent14d, sent15d, checked: subs.length });
}
