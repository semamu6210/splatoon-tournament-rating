import { requireUser } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { getMatchViewForUser } from "@/lib/match-view-service";

type Context = {
  params: Promise<{ matchId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { matchId } = await context.params;
    return ok(await getMatchViewForUser(matchId, user));
  } catch (error) {
    return fail(error);
  }
}
