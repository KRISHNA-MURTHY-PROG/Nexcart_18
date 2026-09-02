import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { captureError } from "@/lib/logger";

// POST /api/payments/verify
// Called by the Razorpay handler in SettingsClient after a subscription payment completes.
// Razorpay sends snake_case fields; signature verification IS the security check here.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const {
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
    } = body as Record<string, string>;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return NextResponse.json({ error: "Missing payment fields" }, { status: 400 });
    }

    // Cryptographically verify the Razorpay signature — only Razorpay can produce this
    const signaturePayload = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSig = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(signaturePayload)
      .digest("hex");

    let valid = false;
    try {
      const expectedBuf = Buffer.from(expectedSig, "hex");
      const receivedBuf = Buffer.from(razorpaySignature, "hex");
      valid =
        expectedBuf.length === receivedBuf.length &&
        timingSafeEqual(expectedBuf, receivedBuf);
    } catch {
      valid = false;
    }

    if (!valid) {
      console.error("[POST /api/payments/verify] Signature mismatch for order:", razorpayOrderId);
      return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 });
    }

    // Find the payment record created when the subscription was initiated
    const payment = await db.payment.findFirst({
      where: { razorpayOrderId },
      select: { id: true, status: true, subscriptionId: true },
    });

    if (!payment) {
      return NextResponse.json({ error: "Payment record not found" }, { status: 404 });
    }

    // Idempotent — if already verified, just return success
    if (payment.status === "SUCCESS") {
      return NextResponse.json({ ok: true });
    }

    // Mark payment as successful
    await db.payment.update({
      where: { id: payment.id },
      data: { razorpayPaymentId, razorpaySignature, status: "SUCCESS" },
    });

    // Activate the subscription
    if (payment.subscriptionId) {
      await db.subscription.update({
        where: { id: payment.subscriptionId },
        data: { status: "ACTIVE" },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureError("api/payments/verify", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
