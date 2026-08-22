import { requireAdmin } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { setMatchStage } from "@/lib/stage-service";

type Context = {
  params: Promise<{ matchId: string }>;
};

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { matchId } = await context.params;
    const body = await readJson<{ stageId?: unknown }>(request);
    const match = await setMatchStage(user.id, matchId, body.stageId);
    return ok({ match });
  } catch (error) {
    return fail(error);
  }
}
