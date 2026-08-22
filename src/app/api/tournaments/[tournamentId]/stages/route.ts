import { requireAdmin } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { createTournamentStages } from "@/lib/stage-service";

type Context = {
  params: Promise<{ tournamentId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const { tournamentId } = await context.params;
    const stages = await prisma.tournamentStage.findMany({
      where: { tournamentId, isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    return ok({ stages });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    await requireAdmin();
    const { tournamentId } = await context.params;
    const body = await readJson<{ names?: unknown }>(request);
    const stages = await createTournamentStages(tournamentId, body.names);
    return ok({ stages });
  } catch (error) {
    return fail(error);
  }
}
