import { requireAdmin } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { createPhase } from "@/lib/phase-service";
import { prisma } from "@/lib/prisma";

type Context = {
  params: Promise<{ tournamentId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const { tournamentId } = await context.params;
    const phases = await prisma.tournamentPhase.findMany({
      where: { tournamentId },
      include: {
        blocks: { include: { participants: true }, orderBy: { sortOrder: "asc" } },
        participants: true,
      },
      orderBy: { sortOrder: "asc" },
    });
    return ok({ phases });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { tournamentId } = await context.params;
    const body = await readJson<{
      phaseType?: unknown;
      requiredMatchesPerPlayer?: unknown;
      advancePlayerCount?: unknown;
      advancementMode?: unknown;
      sortOrder?: unknown;
      rule?: unknown;
      stageSelectionMode?: unknown;
      defaultStageId?: unknown;
    }>(request);
    const phase = await createPhase(user.id, tournamentId, body);
    return ok({ phase });
  } catch (error) {
    return fail(error);
  }
}
