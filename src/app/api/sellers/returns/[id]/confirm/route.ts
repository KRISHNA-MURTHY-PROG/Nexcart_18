import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getVerifiedUid } from "@/lib/auth";
import { razorpay } from "@/lib/razorpay";
import { createNotification } from "@/lib/notifications";

const RETURN_SHIPPING_COST = 70;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const firebaseUid = await getVerifiedUid(req);
    if (!firebaseUid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = params;

    // Get the return and verify seller ownership
    const [returnRequest, seller] = await Promise.all([
      db.return.findUnique({
        where: { id },
        include: {
          order: {
            include: {
              payments: {
                where: { status: "SUCCESS" },
                select: { razorpayPaymentId: true },
                take: 1,
              },
              items: { select: { id: true } },
            },
          },
          product: { select: { name: true } },
          buyer:   { select: { id: true, name: true } },
        },
      }),
      db.seller.findFirst({ where: { user: { firebaseUid } } }),
    ]);

    if (!returnRequest) {
      return NextResponse.json({ error: "Return not found" }, { status: 404 });
    }

    if (!seller || seller.id !== returnRequest.sellerId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (returnRequest.status !== "APPROVED") {
      return NextResponse.json(
        { error: "Only APPROVED returns can be confirmed as received" },
        { status: 400 }
      );
    }

    // Atomic claim: flip APPROVED -> REFUNDED before doing anything
    // irreversible (Razorpay refund). If another concurrent request (e.g.
    // double-click, or an admin MARK_REFUNDED) already claimed this return,
    // count === 0 and we stop here — no double refund, no double stock
    // restoration, no double wallet debit.
    const claim = await db.return.updateMany({
      where: { id, status: "APPROVED" },
      data: {
        status: "REFUNDED",
        productReceivedAt: new Date(),
        refundedAt: new Date(),
      },
    });
    if (claim.count === 0) {
      return NextResponse.json(
        { error: "This return is no longer in APPROVED state (already processed?)" },
        { status: 409 }
      );
    }

    const refundAmount = returnRequest.refundAmount ?? 0;
    const isCOD = returnRequest.order.isCOD;
    const razorpayPaymentId =
      returnRequest.order.payments[0]?.razorpayPaymentId ?? null;

    // Wallet deduction:
    // shippingChargedTo === "SELLER": seller pays product + ₹70 shipping
    // shippingChargedTo === "CUSTOMER": seller pays product only (customer already lost ₹70 from refund amount)
    const walletDeduction =
      returnRequest.shippingChargedTo === "SELLER"
        ? refundAmount + RETURN_SHIPPING_COST
        : refundAmount;

    let razorpayRefundId: string | null = null;

    // Trigger Razorpay refund for online-paid orders (skip if COD or ₹0 refund)
    if (!isCOD && razorpayPaymentId && refundAmount > 0) {
      try {
        const refund = await razorpay.payments.refund(razorpayPaymentId, {
          amount: Math.round(refundAmount * 100), // paise
          notes: { returnId: returnRequest.returnId },
        });
        razorpayRefundId = refund.id;
      } catch (rzpErr) {
        // Compensate: revert the atomic claim so the return goes back to
        // APPROVED and can be retried (refund was never actually issued).
        await db.return.update({
          where: { id },
          data: { status: "APPROVED", productReceivedAt: null, refundedAt: null },
        });
        console.error("[confirm-return] Razorpay refund failed:", rzpErr);
        return NextResponse.json(
          { error: "Refund initiation failed. Please try again or contact support." },
          { status: 502 }
        );
      }
    }

    // Atomic update: mark return REFUNDED, deduct seller wallet, log transaction,
    // restore stock for the returned item, and (if applicable) mark the order
    // as fully REFUNDED only when every item in the order has been refunded.
    // Skip wallet deduction and transaction log if walletDeduction is 0 (e.g. cheap product, customer-fault return)
    const orderItem = await db.orderItem.findUnique({
      where: { id: returnRequest.orderItemId },
      select: { productId: true, variantId: true, quantity: true },
    });

    await db.$transaction(async (tx) => {
      // Status/refundedAt/productReceivedAt were already set atomically by
      // the claim above; only persist the Razorpay refund ID here (if any).
      if (razorpayRefundId) {
        await tx.return.update({
          where: { id },
          data: { razorpayRefundId },
        });
      }

      // Restore stock for the returned item
      if (orderItem) {
        await tx.product.update({
          where: { id: orderItem.productId },
          data: { stock: { increment: orderItem.quantity } },
        });
        if (orderItem.variantId) {
          await tx.productVariant.update({
            where: { id: orderItem.variantId },
            data: { stock: { increment: orderItem.quantity } },
          });
        }
      }

      if (walletDeduction > 0) {
        await tx.seller.update({
          where: { id: seller.id },
          data: { walletBalance: { decrement: walletDeduction } },
        });
        await tx.sellerTransaction.create({
          data: {
            sellerId: seller.id,
            type: "RETURN_DEBIT",
            amount: walletDeduction,
            orderId: returnRequest.orderId,
            description:
              `Return refund ₹${refundAmount.toFixed(0)} for "${returnRequest.product.name}"` +
              (returnRequest.shippingChargedTo === "SELLER"
                ? ` + ₹${RETURN_SHIPPING_COST} return shipping`
                : ""),
          },
        });
      }

      // Only mark the whole order REFUNDED if every item in the order has
      // a corresponding REFUNDED return.
      const totalItems = returnRequest.order.items.length;
      const nonRefundedReturns = await tx.return.count({
        where: { orderId: returnRequest.orderId, status: { not: "REFUNDED" } },
      });
      const refundedReturns = await tx.return.count({
        where: { orderId: returnRequest.orderId, status: "REFUNDED" },
      });
      if (nonRefundedReturns === 0 && refundedReturns >= totalItems) {
        await tx.order.update({
          where: { id: returnRequest.orderId },
          data: { status: "REFUNDED" },
        });
      }
    });

    // Notify customer
    const refundNote = isCOD
      ? "Since this was a cash-on-delivery order, our team will contact you for the refund transfer."
      : refundAmount > 0
        ? `₹${refundAmount.toFixed(0)} refund has been initiated. Allow 5–7 business days.`
        : "Your return has been confirmed. No monetary refund applies for this return.";

    void createNotification({
      userId: returnRequest.buyerId,
      type: "RETURN_UPDATE",
      title: "Refund Initiated",
      body: `The seller has confirmed receipt of "${returnRequest.product.name}". ${refundNote}`,
      link: `/orders`,
    });

    return NextResponse.json({ success: true, razorpayRefundId });
  } catch (err) {
    console.error("[confirm-return]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
