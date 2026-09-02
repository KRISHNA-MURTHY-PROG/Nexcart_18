import Razorpay from "razorpay";

const globalForRazorpay = globalThis as unknown as { razorpay: Razorpay | undefined };

export const razorpay =
  globalForRazorpay.razorpay ??
  new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });

if (process.env.NODE_ENV !== "production") globalForRazorpay.razorpay = razorpay;

export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHmac } = require("crypto");
  const body = `${orderId}|${paymentId}`;
  const expected = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(body)
    .digest("hex");
  return expected === signature;
}
