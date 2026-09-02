import { getVerifiedUid } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { razorpay } from "@/lib/razorpay";

// Prices in INR (rupees)
const PLAN_PRICES = {
  MONTHLY: 180,
  HALF_YEARLY: 900,
  YEARLY: 1500,
} as const;

type Plan = keyof typeof PLAN_PRICES;

const CYCLE_MONTHS: Record<Plan, number> = {
  MONTHLY: 1,
  HALF_YEARLY: 6,
  YEARLY: 12,
};

export async function POST(req: NextRequest) {
  const userId = await getVerifiedUid(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({
    where: { firebaseUid: userId },
    include: { seller: { include: { subscription: true } } },
  });
  if (!user?.seller) return NextResponse.json({ error: "Not a seller" }, { status: 403 });

  const body = await req.json() as { plan: Plan };
  const { plan } = body;

  if (!plan || !["MONTHLY", "HALF_YEARLY", "YEARLY"].includes(plan))
    return NextResponse.json({ error: "Invalid plan. Choose MONTHLY, HALF_YEARLY, or YEARLY." }, { status: 400 });

  const amount = PLAN_PRICES[plan];
  const months = CYCLE_MONTHS[plan];

  const now = new Date();
  const endDate = new Date(now);
  endDate.setMonth(endDate.getMonth() + months);

  // Create Razorpay order (amount in paise)
  const order = await razorpay.orders.create({
    amount:   amount * 100,
    currency: "INR",
    receipt:  `sub_${user.seller.id}_${Date.now()}`.slice(0, 40),
    notes:    { sellerId: user.seller.id, plan, userId: user.id },
  });

  // Upsert subscription (keeps the record stable for payment FK)
  const subscription = await db.subscription.upsert({
    where:  { sellerId: user.seller.id },
    create: {
      sellerId:      user.seller.id,
      plan:          plan as "MONTHLY" | "HALF_YEARLY" | "YEARLY",
      billingCycle:  plan as "MONTHLY" | "HALF_YEARLY" | "YEARLY",
      status:        "PENDING",
      startDate:     now,
      endDate,
      amount,
    },
    update: {
      plan:          plan as "MONTHLY" | "HALF_YEARLY" | "YEARLY",
      billingCycle:  plan as "MONTHLY" | "HALF_YEARLY" | "YEARLY",
      status:        "PENDING",
      endDate,
      amount,
      reminderSent6d: false,
      reminderSent7d: false,
    },
  });

  const payment = await db.payment.create({
    data: {
      userId:          user.id,
      subscriptionId:  subscription.id,
      razorpayOrderId: order.id,
      amount,
      status: "PENDING",
    },
  });

  return NextResponse.json({
    id:        order.id,
    amount:    order.amount,
    currency:  order.currency,
    paymentId: payment.id,
    keyId:     process.env.RAZORPAY_KEY_ID,
    plan,
  });
}
