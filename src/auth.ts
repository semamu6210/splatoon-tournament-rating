import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Discord from "next-auth/providers/discord";

import { prisma } from "@/lib/prisma";

const hasDiscordCredentials =
  Boolean(process.env.AUTH_DISCORD_ID) &&
  Boolean(process.env.AUTH_DISCORD_SECRET);

const providers: NextAuthConfig["providers"] = hasDiscordCredentials
  ? [
      Discord({
        clientId: process.env.AUTH_DISCORD_ID,
        clientSecret: process.env.AUTH_DISCORD_SECRET,
      }),
    ]
  : [];

export const { handlers, auth, signIn, signOut } = NextAuth({
    trustHost: true,

  adapter: PrismaAdapter(prisma),

  providers,
  session: {
    strategy: "database",
  },
  callbacks: {
    async signIn({ account, profile, user }) {
      if (account?.provider === "discord" && profile && user.id) {
        const discordProfile = profile as {
          id?: string;
          username?: string;
          avatar?: string | null;
        };

        const avatarUrl =
          discordProfile.id && discordProfile.avatar
            ? `https://cdn.discordapp.com/avatars/${discordProfile.id}/${discordProfile.avatar}.png`
            : user.image;

        await prisma.user.update({
          where: { id: user.id },
          data: {
            discordId: discordProfile.id,
            discordUsername: discordProfile.username,
            avatarUrl,
          },
        });
      }

      return true;
    },
    async session({ session, user }) {
      if (session.user) {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: {
            role: true,
            discordId: true,
            discordUsername: true,
            avatarUrl: true,
          },
        });

        session.user.id = user.id;
        session.user.role = dbUser?.role ?? "PLAYER";
        session.user.discordId = dbUser?.discordId ?? null;
        session.user.discordUsername = dbUser?.discordUsername ?? null;
        session.user.avatarUrl = dbUser?.avatarUrl ?? null;
      }

      return session;
    },
  },
});
