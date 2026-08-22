import { requireUser } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { getQueueStatusLite } from "@/lib/status-lite-service";

type Context = {
  params: Promise<{ phaseId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { phaseId } = await context.params;
    return ok(await getQueueStatusLite(user.id, phaseId));
  } catch (error) {
    return fail(error);
  }
}
