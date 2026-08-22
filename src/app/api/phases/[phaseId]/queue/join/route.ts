import { requireUser } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { joinQueueAndRunMatchmaking } from "@/lib/matchmaking/service";
import { serializeQueueEntry } from "@/lib/queue-serializers";

type Context = {
  params: Promise<{ phaseId: string }>;
};

export async function POST(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { phaseId } = await context.params;
    const { queueEntry, matchmaking } = await joinQueueAndRunMatchmaking(user.id, phaseId);

    return ok({ queueEntry: serializeQueueEntry(queueEntry), matchmaking }, 201);
  } catch (error) {
    return fail(error);
  }
}
