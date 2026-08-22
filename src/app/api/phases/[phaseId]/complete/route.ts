import { requireAdmin } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { completePhase, getPhaseReadiness } from "@/lib/phase-service";

type Context = {
  params: Promise<{ phaseId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const { phaseId } = await context.params;
    const readiness = await getPhaseReadiness(phaseId);
    return ok(readiness);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(_request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { phaseId } = await context.params;
    const phase = await completePhase(user.id, phaseId);
    return ok({ phase });
  } catch (error) {
    return fail(error);
  }
}
