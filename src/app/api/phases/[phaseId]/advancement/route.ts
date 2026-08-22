import { requireAdmin } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { confirmQualifierAdvancement, getQualifierAdvancementPreview } from "@/lib/phase-service";

type Context = {
  params: Promise<{ phaseId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    await requireAdmin();
    const { phaseId } = await context.params;
    const preview = await getQualifierAdvancementPreview(phaseId);
    return ok(preview);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { phaseId } = await context.params;
    const body = await readJson<{ selectedTournamentParticipantIds?: string[] }>(request);
    const result = await confirmQualifierAdvancement(user.id, phaseId, body.selectedTournamentParticipantIds);
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
