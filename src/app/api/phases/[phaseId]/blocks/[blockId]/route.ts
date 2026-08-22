import { requireAdmin } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { updateBlock } from "@/lib/block-service";

type Context = {
  params: Promise<{ blockId: string }>;
};

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { blockId } = await context.params;
    const body = await readJson<{ name?: unknown; advancePlayerCount?: unknown }>(request);
    const block = await updateBlock(blockId, body, user.id);
    return ok({ block });
  } catch (error) {
    return fail(error);
  }
}
