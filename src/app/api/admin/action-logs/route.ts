import { requireAdmin } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await requireAdmin();
    const logs = await prisma.adminActionLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        adminUser: {
          select: {
            id: true,
            name: true,
            discordUsername: true,
            role: true,
          },
        },
      },
    });

    return ok({
      logs: logs.map((log) => ({
        ...log,
        createdAt: log.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return fail(error);
  }
}
