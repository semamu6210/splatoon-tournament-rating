import { requireAdmin } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { startPhase } from "@/lib/phase-service";

type Context = {
  params: Promise<{ phaseId: string }>;
};

export async function POST(_request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { phaseId } = await context.params;
    const phase = await startPhase(user.id, phaseId);
    return ok({ phase });
  } catch (error) {
    return fail(error);
  }
}
