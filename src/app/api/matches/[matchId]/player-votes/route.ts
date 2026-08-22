import { requireUser } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { submitPlayerVotes } from "@/lib/match-flow/service";

type Context = { params: Promise<unknown> };

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { matchId } = (await context.params) as { matchId: string };
    const body = await readJson<{ votes: unknown }>(request);
    const votes = await submitPlayerVotes(user.id, matchId, body.votes);
    return ok({ votes }, 201);
  } catch (error) {
    return fail(error);
  }
}
