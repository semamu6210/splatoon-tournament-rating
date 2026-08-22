import Link from "next/link";

import { AuthControls } from "@/components/auth-controls";
import { auth } from "@/auth";
import { canManage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await auth();
  const allowed = session?.user ? canManage(session.user.role) : false;
  const tournaments = allowed
    ? await prisma.tournament.findMany({ orderBy: { createdAt: "desc" } })
    : [];

  return (
    <main className="min-h-screen px-5 py-8">
      <section className="mx-auto grid max-w-5xl gap-6">
        <header className="flex flex-col gap-4 border-b border-zinc-300 pb-5">
          <Link className="text-sm text-zinc-600" href="/">← トップ</Link>
          <h1 className="text-3xl font-bold">管理ダッシュボード</h1>
          <AuthControls />
        </header>

        {!allowed && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            ADMINまたはOWNER権限が必要です。権限変更はPrisma Studioなどで管理者が行ってください。
          </div>
        )}

        {allowed && (
          <>
            <div>
              <Link className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white" href="/admin/tournaments/new">
                大会作成
              </Link>
            </div>
            <div className="grid gap-3">
              {tournaments.map((tournament) => (
                <Link className="rounded-md border border-zinc-300 bg-white p-4" href={`/admin/tournaments/${tournament.id}`} key={tournament.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold">{tournament.name}</h2>
                    <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold">{tournament.status}</span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
