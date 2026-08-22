import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Discord from "next-auth/providers/discord";

import { syncDiscordProfileForUser } from "@/lib/auth-discord-sync";
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
  events: {
    async signIn({ account, profile, user }) {
      if (account?.provider === "discord" && user.id) {
        await syncDiscordProfileForUser(user.id, profile, user.image);
      }
    },
  },
});
