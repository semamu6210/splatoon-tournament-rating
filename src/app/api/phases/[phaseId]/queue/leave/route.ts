import { requireUser } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { leaveQueue } from "@/lib/matchmaking/service";
import { serializeQueueEntry } from "@/lib/queue-serializers";

type Context = {
  params: Promise<{ phaseId: string }>;
};

export async function POST(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { phaseId } = await context.params;
    const entry = await leaveQueue(user.id, phaseId);

    return ok({ queueEntry: serializeQueueEntry(entry) });
  } catch (error) {
    return fail(error);
  }
}
