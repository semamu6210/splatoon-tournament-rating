import { auth } from "@/auth";
import { canManage } from "@/lib/permissions";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { serializeParticipant } from "@/lib/serializers";

type Context = {
  params: Promise<{ tournamentId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const session = await auth();
    const isAdmin = session?.user ? canManage(session.user.role) : false;
    const { tournamentId } = await context.params;
    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            discordUsername: true,
            avatarUrl: true,
            role: true,
          },
        },
        blockParticipations: {
          include: { block: true },
        },
      },
      orderBy: { joinedAt: "asc" },
    });

    if (isAdmin) {
      return ok({ participants: participants.map(serializeParticipant) });
    }

    return ok({
      participants: participants
        .filter((participant) => participant.isActive)
        .map((participant) => ({
          id: participant.id,
          userId: participant.userId,
          participantName: participant.participantName,
          avatarUrl: participant.user.avatarUrl,
          rating: participant.rating?.toString() ?? null,
          wins: participant.wins,
          losses: participant.losses,
          matchesPlayed: participant.matchesPlayed,
          block: participant.blockParticipations[0]?.block
            ? { id: participant.blockParticipations[0].block.id, name: participant.blockParticipations[0].block.name }
            : null,
          winningStreak: participant.winningStreak,
          losingStreak: participant.losingStreak,
          streakBadge:
            participant.winningStreak >= 3
              ? `🔥 ${participant.winningStreak}連勝`
              : participant.losingStreak >= 3
                ? `▼ ${participant.losingStreak}連敗`
                : null,
        })),
    });
  } catch (error) {
    return fail(error);
  }
}
