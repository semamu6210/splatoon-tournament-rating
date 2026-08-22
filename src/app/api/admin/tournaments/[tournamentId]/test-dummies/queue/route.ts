import { requireAdmin } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { queueTestDummies } from "@/lib/test-dummy-service";

type Context = {
  params: Promise<{ tournamentId: string }>;
};

export async function POST(_request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { tournamentId } = await context.params;
    const result = await queueTestDummies(user.id, user.role, tournamentId);

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
