import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import { getMetrics, toCsv } from "@/lib/server/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const refusal = await requireAdmin(request);
  if (refusal) return refusal;

  const params = request.nextUrl.searchParams;
  const metrics = await getMetrics(params.get("refresh") === "1");

  if (params.get("format") === "csv") {
    const day = metrics.generatedAt.slice(0, 10);
    return new NextResponse(toCsv(metrics), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="pick-metrics-${day}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  return NextResponse.json(metrics, {
    headers: { "cache-control": "no-store" },
  });
}
