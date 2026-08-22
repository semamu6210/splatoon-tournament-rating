import { requireUser } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { getMatchStatusLite } from "@/lib/status-lite-service";

type Context = {
  params: Promise<{ matchId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { matchId } = await context.params;
    return ok(await getMatchStatusLite(matchId, user));
  } catch (error) {
    return fail(error);
  }
}
