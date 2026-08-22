import { requireAdmin } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { applyRating } from "@/lib/match-flow/service";

type Context = { params: Promise<unknown> };

export async function POST(_request: Request, context: Context) {
  try {
    await requireAdmin();
    const { matchId } = (await context.params) as { matchId: string };
    const match = await applyRating(matchId);
    return ok({ match });
  } catch (error) {
    return fail(error);
  }
}
