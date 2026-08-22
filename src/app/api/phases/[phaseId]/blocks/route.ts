import { requireAdmin } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { createPhaseBlocks } from "@/lib/block-service";
import { prisma } from "@/lib/prisma";

type Context = {
  params: Promise<{ phaseId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const { phaseId } = await context.params;
    const blocks = await prisma.tournamentBlock.findMany({
      where: { phaseId },
      include: {
        participants: {
          include: {
            tournamentParticipant: {
              include: { user: { select: { id: true, name: true, discordUsername: true } } },
            },
          },
        },
      },
      orderBy: { sortOrder: "asc" },
    });
    return ok({ blocks });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { phaseId } = await context.params;
    const body = await readJson<{ names?: unknown; blocks?: unknown }>(request);
    const blocks = await createPhaseBlocks(phaseId, body.blocks ? { blocks: body.blocks } : body.names, user.id);
    return ok({ blocks });
  } catch (error) {
    return fail(error);
  }
}
