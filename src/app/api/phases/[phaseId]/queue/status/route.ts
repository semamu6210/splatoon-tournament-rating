import { requireUser } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { getQueueStatus } from "@/lib/matchmaking/service";

type Context = {
  params: Promise<{ phaseId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { phaseId } = await context.params;
    const status = await getQueueStatus(user.id, phaseId);

    return ok(status);
  } catch (error) {
    return fail(error);
  }
}
