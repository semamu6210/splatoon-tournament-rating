import { requireAdmin } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { runMatchmaking } from "@/lib/matchmaking/service";

type Context = {
  params: Promise<{ phaseId: string }>;
};

export async function POST(_request: Request, context: Context) {
  try {
    await requireAdmin();
    const { phaseId } = await context.params;
    const result = await runMatchmaking(phaseId);

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
