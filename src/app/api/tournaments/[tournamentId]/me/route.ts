import { requireUser } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { serializeParticipant } from "@/lib/serializers";

type Context = {
  params: Promise<{ tournamentId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { tournamentId } = await context.params;
    const participant = await prisma.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId, userId: user.id } },
    });

    return ok({ participant: participant ? serializeParticipant(participant) : null });
  } catch (error) {
    return fail(error);
  }
}
