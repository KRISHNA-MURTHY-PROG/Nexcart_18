import { getVerifiedUid } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { createNotification } from "@/lib/notifications";
import { maybePromptBankDetails } from "@/lib/seller-onboarding";

const schema = z.object({
  deliveryMethod: z.enum(["SELF", "COURIER"]).optional(),
  deliveryStatus: z
    .enum(["PENDING", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED"])
    .optional(),
  estimatedDelivery: z.string().optional(),
  estimatedArrival: z.string().optional(),
  selfDeliveryEnabled: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const firebaseUid = await getVerifiedUid(req);
  if (!firebaseUid)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({
    where: { firebaseUid },
    include: { seller: true },
  });
  if (!user?.seller)
    return NextResponse.json({ error: "Not a seller" }, { status: 403 });

  const order = await db.order.findUnique({
    where: { id: params.id },
    include: { items: true },
  });
  if (!order)
    return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const isSellersOrder = order.items.some(
    (item) => item.sellerId === user.seller!.id
  );
  if (!isSellersOrder)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const {
    deliveryMethod,
    deliveryStatus,
    estimatedDelivery,
    estimatedArrival,
    selfDeliveryEnabled,
  } = parsed.data;

  // Map deliveryStatus -> order status for customer visibility
  let orderStatus: string | undefined;
  if (deliveryStatus === "OUT_FOR_DELIVERY") orderStatus = "SHIPPED";
  if (deliveryStatus === "DELIVERED")        orderStatus = "DELIVERED";
  if (deliveryStatus === "PREPARING")        orderStatus = "PROCESSING";
  if (deliveryStatus === "FAILED")           orderStatus = "CANCELLED";

  // Generate 6-digit OTP for COD orders going OUT_FOR_DELIVERY
  let codOtp: string | undefined;
  if (deliveryStatus === "OUT_FOR_DELIVERY" && order.isCOD) {
    codOtp = Math.floor(100000 + Math.random() * 900000).toString();
  }

  // For seller-confirmed DELIVERED on COD (no agent assigned or agent assigned but seller overrides)
  // Only credit if cash not already confirmed
  const markCodCollected =
    deliveryStatus === "DELIVERED" &&
    order.isCOD &&
    !order.codCollectedAt;

  const updated = await db.order.update({
    where: { id: params.id },
    data: {
      ...(deliveryMethod  && { deliveryMethod }),
      ...(deliveryStatus  && { deliveryStatus }),
      ...(orderStatus     && { status: orderStatus as never }),
      ...(selfDeliveryEnabled !== undefined && { selfDeliveryEnabled }),
      ...(estimatedDelivery && { estimatedDelivery: new Date(estimatedDelivery) }),
      ...(estimatedArrival  && { estimatedArrival: new Date(estimatedArrival) }),
      ...(codOtp            && { codOtp }),
      ...(markCodCollected  && { codCollectedAt: new Date(), codOtp: null }),
    },
  });

  // Credit seller wallet when seller marks COD as DELIVERED and cash not already tracked
  if (markCodCollected) {
    const sellerAmounts = new Map<string, number>();
    for (const item of order.items) {
      sellerAmounts.set(
        item.sellerId,
        (sellerAmounts.get(item.sellerId) ?? 0) + item.price * item.quantity
      );
    }
    for (const [sellerId, amount] of sellerAmounts) {
      db.seller
        .update({ where: { id: sellerId }, data: { walletBalance: { increment: amount } } })
        .then(() =>
          db.sellerTransaction.create({
            data: {
              sellerId,
              type: "ORDER_CREDIT",
              amount,
              description: `COD collected for Order #${order.orderId.slice(-8).toUpperCase()}`,
              orderId: order.id,
            },
          })
        )
        .then(() => {
          return maybePromptBankDetails(sellerId);
        })
        .catch((e) => console.error("[COD wallet credit]", e));
    }
  }

  // Notify customer with OTP when order goes out for delivery (COD only)
  if (codOtp) {
    void createNotification({
      userId: order.userId,
      type: "COD_OTP",
      title: "Your Delivery OTP",
      body: `Your order is out for delivery. Share OTP ${codOtp} with the delivery person to confirm receipt and complete payment.`,
      link: `/orders/${order.id}`,
    });
  }

  return NextResponse.json({ success: true, order: updated });
}
