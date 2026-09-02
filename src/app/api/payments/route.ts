import { NextRequest, NextResponse } from "next/server";
import Razorpay from "razorpay";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { getVerifiedUid } from "@/lib/auth";
import { rateLimit, RATE_LIMITS } from "@/lib/ratelimit";
import { z } from "zod";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

const createSchema = z.object({
  orderId: z.string().optional(),
  subscriptionId: z.string().optional(),
  amount: z.number().positive().max(1000000),
});

const verifySchema = z.object({
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
  paymentId: z.string(),
});

/** Create Razorpay order */
export async function POST(req: NextRequest) {
  // Rate limit: 5 payment initiations per minute per IP
  const limited = await rateLimit(req, RATE_LIMITS.payments);
  if (limited) return limited;

  const firebaseUid = await getVerifiedUid(req);
  if (!firebaseUid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await db.user.findUnique({ where: { firebaseUid }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { orderId, subscriptionId, amount } = parsed.data;

  if (!orderId && !subscriptionId) {
    return NextResponse.json({ error: "orderId or subscriptionId is required" }, { status: 400 });
  }

  if (orderId) {
    const order = await db.order.findUnique({ where: { id: orderId }, select: { id: true, userId: true, totalAmount: true } });
    if (!order || order.userId !== user.id) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (Math.abs(amount - order.totalAmount) >= 0.01) {
      return NextResponse.json({ error: "Amount does not match order total" }, { status: 400 });
    }
  }

  try {
    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(amount * 100), // paise
      currency: "INR",
      receipt: (orderId || subscriptionId || `rcpt_${Date.now()}`).slice(0, 40),
      notes: { orderId: orderId ?? "", subscriptionId: subscriptionId ?? "", userId: user.id },
    });

    const payment = await db.payment.create({
      data: {
        userId: user.id,
        orderId: orderId ?? null,
        subscriptionId: subscriptionId ?? null,
        razorpayOrderId: razorpayOrder.id,
        amount,
        status: "PENDING",
      },
    });

    return NextResponse.json({
      id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      paymentId: payment.id,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("[POST /api/payments]", err);
    return NextResponse.json({ error: "Failed to create payment order" }, { status: 500 });
  }
}

/** Verify Razorpay payment signature */
export async function PUT(req: NextRequest) {
  const firebaseUid = await getVerifiedUid(req);
  if (!firebaseUid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await db.user.findUnique({ where: { firebaseUid }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, paymentId } = parsed.data;

  // Verify the payment belongs to this user
  const payment = await db.payment.findFirst({ where: { id: paymentId, userId: user.id } });
  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  if (payment.status === "SUCCESS") {
    return NextResponse.json({ error: "Payment already verified" }, { status: 400 });
  }

  // Cryptographically verify Razorpay signature using timing-safe comparison
  const body_str = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(body_str)
    .digest("hex");

  const expectedBuf = Buffer.from(expectedSignature, "hex");
  const receivedBuf = Buffer.from(razorpaySignature, "hex");

  const isValid =
    expectedBuf.length === receivedBuf.length &&
    timingSafeEqual(expectedBuf, receivedBuf);

  if (!isValid) {
    console.error("[PUT /api/payments] Signature mismatch for paymentId:", paymentId);
    return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 });
  }

  try {
    const updated = await db.payment.update({
      where: { id: paymentId },
      data: { razorpayPaymentId, razorpaySignature, status: "SUCCESS" },
      include: { order: true, subscription: true },
    });

    // Activate order
    if (updated.orderId) {
      await db.order.update({ where: { id: updated.orderId }, data: { status: "CONFIRMED" } });
    }

    // Activate subscription
    if (updated.subscriptionId) {
      await db.subscription.update({ where: { id: updated.subscriptionId }, data: { status: "ACTIVE" } });
    }

    return NextResponse.json({ success: true, payment: updated });
  } catch (err) {
    console.error("[PUT /api/payments]", err);
    return NextResponse.json({ error: "Failed to verify payment" }, { status: 500 });
  }
}
