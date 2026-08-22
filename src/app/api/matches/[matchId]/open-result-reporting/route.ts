import { requireUser } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { openResultReporting } from "@/lib/match-flow/service";

type Context = { params: Promise<unknown> };

export async function POST(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { matchId } = (await context.params) as { matchId: string };
    const match = await openResultReporting(matchId, user.id, user.role);
    return ok({ match });
  } catch (error) {
    return fail(error);
  }
}
