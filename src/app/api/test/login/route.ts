import { randomUUID } from "node:crypto";

import { type UserRole } from "@prisma/client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ApiError, fail, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";

type TestLoginBody = {
  email?: unknown;
  name?: unknown;
  role?: unknown;
};

function testAuthEnabled() {
  if (process.env.NODE_ENV === "production") return false;
  const authUrl = process.env.AUTH_URL ?? "";
  const isLocalhost = authUrl.startsWith("http://localhost") || authUrl.startsWith("http://127.0.0.1");
  return process.env.ENABLE_TEST_AUTH === "true" && isLocalhost;
}

function roleOf(value: unknown): UserRole {
  if (value === "ADMIN" || value === "OWNER" || value === "PLAYER") return value;
  return "PLAYER";
}

export async function POST(request: Request) {
  try {
    if (!testAuthEnabled()) {
      throw new ApiError(404, "Not found.");
    }

    const body = await readJson<TestLoginBody>(request);
    const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : `${randomUUID()}@e2e.local`;
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : email.split("@")[0];
    const role = roleOf(body.role);
    const user = await prisma.user.upsert({
      where: { email },
      update: { name, role, discordUsername: name },
      create: { email, name, role, discordUsername: name },
    });
    const sessionToken = randomUUID();
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 4);

    await prisma.session.create({
      data: {
        sessionToken,
        userId: user.id,
        expires,
      },
    });

    const cookieStore = await cookies();
    cookieStore.set("authjs.session-token", sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expires,
    });

    return NextResponse.json({ user: { id: user.id, email: user.email, role: user.role } });
  } catch (error) {
    return fail(error);
  }
}
