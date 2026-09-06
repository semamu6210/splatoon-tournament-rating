import { requireUser } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { getMatchViewForUser } from "@/lib/match-view-service";
import { withPerf } from "@/lib/perf";

type Context = {
  params: Promise<{ matchId: string }>;
};

export async function GET(_request: Request, context: Context) {
  return withPerf("match-detail-api", async () => {
    try {
      const user = await requireUser();
      const { matchId } = await context.params;
      return ok(await getMatchViewForUser(matchId, user));
    } catch (error) {
      return fail(error);
    }
  });
}
