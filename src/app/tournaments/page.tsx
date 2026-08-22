import Link from "next/link";

import { AuthControls } from "@/components/auth-controls";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function TournamentsPage() {
  const tournaments = await prisma.tournament.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="min-h-screen px-5 py-8">
      <section className="mx-auto grid max-w-4xl gap-6">
        <header className="flex flex-col gap-4 border-b border-zinc-300 pb-5">
          <Link className="text-sm text-zinc-600" href="/">← トップ</Link>
          <h1 className="text-3xl font-bold">大会一覧</h1>
          <AuthControls />
        </header>

        <div className="grid gap-3">
          {tournaments.length === 0 && <p className="text-zinc-600">大会はまだありません。</p>}
          {tournaments.map((tournament) => (
            <Link
              className="rounded-md border border-zinc-300 bg-white p-4"
              href={`/tournaments/${tournament.id}`}
              key={tournament.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{tournament.name}</h2>
                <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700">
                  {tournament.status}
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-600">
                {tournament.startsAt?.toLocaleString("ja-JP") ?? "開始未定"} -{" "}
                {tournament.endsAt?.toLocaleString("ja-JP") ?? "終了未定"}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
