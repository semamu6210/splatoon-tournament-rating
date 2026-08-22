import type { UserRole } from "@prisma/client";

export function canManage(role: UserRole) {
  return role === "ADMIN" || role === "OWNER";
}
