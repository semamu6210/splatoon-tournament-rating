import { requireUser } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { submitResultReport } from "@/lib/match-flow/service";

type Context = { params: Promise<unknown> };

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { matchId } = (await context.params) as { matchId: string };
    const body = await readJson<{ reportedWinnerTeam: unknown }>(request);
    const match = await submitResultReport(user.id, matchId, body.reportedWinnerTeam, user.role);
    return ok({ match }, 201);
  } catch (error) {
    return fail(error);
  }
}
