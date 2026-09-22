import { NextResponse } from "next/server";

const unavailableResponse = () =>
  NextResponse.json(
    {
      error: "Online payments are temporarily unavailable. Please use Cash on Delivery.",
    },
    { status: 503 }
  );

export async function POST() {
  return unavailableResponse();
}

export async function PUT() {
  return unavailableResponse();
}