import { requireAdmin } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { serializeRatingConfig } from "@/lib/serializers";
import {
  createRatingConfigVersion,
} from "@/lib/tournament-service";
import type { RatingConfigInput } from "@/lib/rating-config";

type Context = {
  params: Promise<{ tournamentId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    await requireAdmin();
    const { tournamentId } = await context.params;
    const config = await prisma.tournamentRatingConfig.findFirst({
      where: { tournamentId, isActive: true },
      include: { xpMultiplierTiers: { orderBy: { sortOrder: "asc" } } },
    });

    return ok({ ratingConfig: config ? serializeRatingConfig(config) : null });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { tournamentId } = await context.params;
    const body = await readJson<RatingConfigInput>(request);
    const config = await createRatingConfigVersion(user.id, tournamentId, body);

    return ok({ ratingConfig: serializeRatingConfig(config) }, 201);
  } catch (error) {
    return fail(error);
  }
}
