import { requireAdmin } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { submitTestDummyVotes } from "@/lib/test-dummy-service";

type Context = {
  params: Promise<{ matchId: string }>;
};

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { matchId } = await context.params;
    const body = await readJson<{ leaveOneRealUserUnvoted?: unknown }>(request);
    const result = await submitTestDummyVotes(user.id, user.role, matchId, body);

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
