import { requireAdmin } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { serializeRatingConfig } from "@/lib/serializers";

type Context = {
  params: Promise<{ tournamentId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    await requireAdmin();
    const { tournamentId } = await context.params;
    const configs = await prisma.tournamentRatingConfig.findMany({
      where: { tournamentId },
      include: { xpMultiplierTiers: { orderBy: { sortOrder: "asc" } } },
      orderBy: { version: "desc" },
    });

    return ok({ ratingConfigs: configs.map(serializeRatingConfig) });
  } catch (error) {
    return fail(error);
  }
}
