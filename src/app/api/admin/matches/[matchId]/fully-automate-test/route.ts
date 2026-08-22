import { requireAdmin } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { fullyAutomateTestMatch } from "@/lib/test-dummy-service";

type Context = {
  params: Promise<{ matchId: string }>;
};

export async function POST(_request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { matchId } = await context.params;
    const match = await fullyAutomateTestMatch(user.id, user.role, matchId);

    return ok({ match });
  } catch (error) {
    return fail(error);
  }
}
