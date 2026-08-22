import { requireAdmin } from "@/lib/authz";
import { autoAssignPhaseBlocks } from "@/lib/block-service";
import { fail, ok } from "@/lib/http";

type Context = {
  params: Promise<{ phaseId: string }>;
};

export async function POST(_request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { phaseId } = await context.params;
    const blocks = await autoAssignPhaseBlocks(phaseId, user.id);
    return ok({ blocks });
  } catch (error) {
    return fail(error);
  }
}
