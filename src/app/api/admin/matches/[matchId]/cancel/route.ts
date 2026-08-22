import { requireAdmin } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { cancelMatch } from "@/lib/match-flow/service";

type Context = { params: Promise<unknown> };

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { matchId } = (await context.params) as { matchId: string };
    const body = await readJson<{ reason: unknown }>(request);
    const match = await cancelMatch(user.id, matchId, body.reason);
    return ok({ match });
  } catch (error) {
    return fail(error);
  }
}
