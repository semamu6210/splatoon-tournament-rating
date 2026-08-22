import { prisma } from "@/lib/prisma";

type DiscordProfileLike = {
  id?: unknown;
  username?: unknown;
  global_name?: unknown;
  avatar?: unknown;
};

export function discordProfileData(profile: unknown, fallbackImage?: string | null) {
  const discordProfile = (profile ?? {}) as DiscordProfileLike;
  const discordId = typeof discordProfile.id === "string" ? discordProfile.id : null;
  const username =
    typeof discordProfile.username === "string"
      ? discordProfile.username
      : typeof discordProfile.global_name === "string"
        ? discordProfile.global_name
        : null;
  const avatarHash = typeof discordProfile.avatar === "string" ? discordProfile.avatar : null;

  return {
    discordId,
    discordUsername: username,
    avatarUrl: discordId && avatarHash ? `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png` : fallbackImage ?? null,
  };
}

export async function syncDiscordProfileForUser(userId: string, profile: unknown, fallbackImage?: string | null) {
  if (!userId) return { count: 0 };

  return prisma.user.updateMany({
    where: { id: userId },
    data: discordProfileData(profile, fallbackImage),
  });
}
