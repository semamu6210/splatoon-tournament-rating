import { requireAdmin } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { applyRating } from "@/lib/match-flow/service";
import { withPerf } from "@/lib/perf";

type Context = { params: Promise<unknown> };

export async function POST(_request: Request, context: Context) {
  return withPerf("apply-rating-api", async () => {
    try {
      await requireAdmin();
      const { matchId } = (await context.params) as { matchId: string };
      const match = await applyRating(matchId, { closeVotingBeforeApply: true });
      return ok({ match });
    } catch (error) {
      return fail(error);
    }
  });
}
