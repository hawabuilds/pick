import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {LESSONS, lessonIndex} from "@/lib/learn";
import {completeLesson} from "@/lib/server/learn";
import {isResponse, requireUser} from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  lessonId: z.string().min(1),
  answer: z.number().int().min(0).max(20),
});

/**
 * Marks a lesson done, but only if the quick check was answered correctly.
 *
 * The answer key stays on the server: the client is sent the questions without
 * the correct index, so it cannot mark itself complete.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (isResponse(auth)) return auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({error: "Invalid request."}, {status: 400});
  }

  const index = lessonIndex(parsed.data.lessonId);
  if (index === -1) {
    return NextResponse.json({error: "Unknown lesson."}, {status: 404});
  }

  const lesson = LESSONS[index];
  if (parsed.data.answer !== lesson.quickCheck.answer) {
    return NextResponse.json(
      {correct: false, message: "Not quite — have another read and try again."},
      {status: 200},
    );
  }

  try {
    const updated = await completeLesson(auth.userId, index);
    return NextResponse.json({
      correct: true,
      explanation: lesson.quickCheck.explanation,
      progress: updated,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save your progress.";
    return NextResponse.json({error: message}, {status: 500});
  }
}
