import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {createComment, listComments} from "@/lib/server/comments";
import {hasDatabase} from "@/lib/server/db";
import {allow, LIMITS, logAbuse} from "@/lib/server/limits";
import {isResponse, requireUser} from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write something before posting.")
    .max(500, "Comments are limited to 500 characters."),
});

export async function GET(
  _request: Request,
  {params}: {params: {ticker: string}},
) {
  const ticker = params.ticker.toUpperCase();

  if (!hasDatabase) {
    return NextResponse.json({ticker, demo: true, items: []});
  }

  try {
    const items = await listComments(ticker);
    return NextResponse.json({ticker, demo: false, items});
  } catch {
    return NextResponse.json({ticker, demo: true, items: []});
  }
}

export async function POST(
  request: NextRequest,
  {params}: {params: {ticker: string}},
) {
  const ticker = params.ticker.toUpperCase();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    const message =
      parsed.error.flatten().fieldErrors.body?.[0] ??
      "That comment could not be posted.";
    return NextResponse.json({error: message}, {status: 400});
  }

  const auth = await requireUser(request);
  if (isResponse(auth)) return auth;

  if (!(await allow(LIMITS.postComment, auth.userId))) {
    await logAbuse({
      kind: "comment_rate_limited",
      userId: auth.userId,
      request,
    });
    return NextResponse.json(
      {error: "Too many comments. Try again shortly."},
      {status: 429},
    );
  }

  try {
    const item = await createComment(auth.userId, ticker, parsed.data.body);
    return NextResponse.json({item});
  } catch (error) {
    const code = (error as {code?: string}).code;
    if (code === "23503") {
      return NextResponse.json({error: "Unknown stock."}, {status: 404});
    }
    return NextResponse.json(
      {error: "Could not post your comment."},
      {status: 500},
    );
  }
}
