import "next-auth";
import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user?: {
      id: string;
      role: UserRole;
      discordId?: string | null;
      discordUsername?: string | null;
      avatarUrl?: string | null;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
