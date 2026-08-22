import { requireAdmin } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { addTestDummies, deleteTestDummies } from "@/lib/test-dummy-service";

type Context = {
  params: Promise<{ tournamentId: string }>;
};

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { tournamentId } = await context.params;
    const body = await readJson<{ count: unknown; areaXp: unknown }>(request);
    const participants = await addTestDummies(user.id, user.role, tournamentId, body);

    return ok({ participants }, 201);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { tournamentId } = await context.params;
    const result = await deleteTestDummies(user.id, user.role, tournamentId);

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
