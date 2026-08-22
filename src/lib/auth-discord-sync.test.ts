import { UserRole } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { discordProfileData, syncDiscordProfileForUser } from "@/lib/auth-discord-sync";
import { prisma } from "@/lib/prisma";

const createdUserIds: string[] = [];

async function createPlayer() {
  const user = await prisma.user.create({
    data: {
      name: `discord-sync-${crypto.randomUUID()}`,
      role: UserRole.PLAYER,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("Discord Auth.js profile sync", () => {
  it("builds Discord profile fields without treating Discord id as User.id", () => {
    expect(
      discordProfileData({
        id: "discord-user-id",
        username: "squid",
        avatar: "avatar-hash",
      }),
    ).toEqual({
      discordId: "discord-user-id",
      discordUsername: "squid",
      avatarUrl: "https://cdn.discordapp.com/avatars/discord-user-id/avatar-hash.png",
    });
  });

  it("does not throw when Auth.js event receives a user id that is not present", async () => {
    await expect(
      syncDiscordProfileForUser(`missing-${crypto.randomUUID()}`, {
        id: "discord-missing",
        username: "missing",
        avatar: "avatar",
      }),
    ).resolves.toMatchObject({ count: 0 });
  });

  it("stores Discord id, username, and avatar after the adapter-created User exists", async () => {
    const user = await createPlayer();

    await syncDiscordProfileForUser(user.id, {
      id: "discord-first-login",
      username: "first-login",
      avatar: "first-avatar",
    });

    const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reloaded.discordId).toBe("discord-first-login");
    expect(reloaded.discordUsername).toBe("first-login");
    expect(reloaded.avatarUrl).toBe("https://cdn.discordapp.com/avatars/discord-first-login/first-avatar.png");
    expect(reloaded.role).toBe(UserRole.PLAYER);
  });

  it("updates an existing user's Discord display fields without changing role", async () => {
    const user = await createPlayer();

    await syncDiscordProfileForUser(user.id, {
      id: "discord-existing",
      username: "old-name",
      avatar: "old-avatar",
    });
    await syncDiscordProfileForUser(user.id, {
      id: "discord-existing",
      username: "new-name",
      avatar: "new-avatar",
    });

    const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reloaded.discordId).toBe("discord-existing");
    expect(reloaded.discordUsername).toBe("new-name");
    expect(reloaded.avatarUrl).toBe("https://cdn.discordapp.com/avatars/discord-existing/new-avatar.png");
    expect(reloaded.role).toBe(UserRole.PLAYER);
  });
});
