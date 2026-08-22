import type { User } from "@prisma/client";

import { auth } from "@/auth";
import { ApiError } from "@/lib/http";
import { canManage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export type AuthenticatedUser = Pick<
  User,
  "id" | "role" | "discordId" | "discordUsername" | "avatarUrl" | "name" | "email" | "image"
>;

export async function requireUser(): Promise<AuthenticatedUser> {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    throw new ApiError(401, "Authentication required.");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      discordId: true,
      discordUsername: true,
      avatarUrl: true,
      name: true,
      email: true,
      image: true,
    },
  });

  if (!user) {
    throw new ApiError(401, "User not found.");
  }

  return user;
}

export async function requireAdmin() {
  const user = await requireUser();

  if (!canManage(user.role)) {
    throw new ApiError(403, "Admin permission required.");
  }

  return user;
}

export async function requireOwner() {
  const user = await requireUser();

  if (user.role !== "OWNER") {
    throw new ApiError(403, "Owner permission required.");
  }

  return user;
}
