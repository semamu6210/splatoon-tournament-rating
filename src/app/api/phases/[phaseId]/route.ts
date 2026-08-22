import { requireAdmin } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { updatePhase } from "@/lib/phase-service";

type Context = {
  params: Promise<{ phaseId: string }>;
};

export async function PATCH(request: Request, context: Context) {
  try {
    await requireAdmin();
    const { phaseId } = await context.params;
    const body = await readJson<{
      requiredMatchesPerPlayer?: unknown;
      advancePlayerCount?: unknown;
      advancementMode?: unknown;
      rule?: unknown;
      stageSelectionMode?: unknown;
      defaultStageId?: unknown;
    }>(request);
    const phase = await updatePhase(phaseId, body);
    return ok({ phase });
  } catch (error) {
    return fail(error);
  }
}
