import { requireAdmin } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { moveParticipantToBlock } from "@/lib/block-service";

type Context = {
  params: Promise<{ phaseId: string }>;
};

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { phaseId } = await context.params;
    const body = await readJson<{ tournamentParticipantId?: unknown; blockId?: unknown }>(request);
    const assignment = await moveParticipantToBlock(phaseId, body.tournamentParticipantId, body.blockId, user.id);
    return ok({ assignment });
  } catch (error) {
    return fail(error);
  }
}
