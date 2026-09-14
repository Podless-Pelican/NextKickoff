import { NextRequest, NextResponse } from "next/server";
import { FootballDataError, syncFootballData } from "@/lib/football-data";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await syncFootballData());
  } catch (error) {
    if (error instanceof FootballDataError) {
      return NextResponse.json({ error: error.message }, { status: error.status === 429 ? 429 : 502 });
    }
    console.error("football-data sync failed", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
