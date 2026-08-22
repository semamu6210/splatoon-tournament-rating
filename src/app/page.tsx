import Link from "next/link";

import { checkDatabaseConnection } from "@/lib/prisma";
import { AuthControls } from "@/components/auth-controls";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const db = await checkDatabaseConnection();

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <section className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="border-b border-zinc-300 pb-5">
          <p className="text-sm font-semibold text-zinc-600">Tournament operations</p>
          <h1 className="mt-2 text-3xl font-bold text-zinc-950 sm:text-4xl">
            Splatoon Tournament Rating System
          </h1>
          <p className="mt-3 text-base text-zinc-700">
            大会作成、参加登録、フェーズ進行、マッチング、投票、レート計算、
            ランキングを管理できます。
          </p>
        </div>

        <AuthControls />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-zinc-300 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-500">App</h2>
            <p className="mt-2 text-lg font-semibold text-zinc-950">
              Next.js is running
            </p>
          </div>

          <div className="rounded-md border border-zinc-300 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-500">Database</h2>
            <p
              className={
                db.ok
                  ? "mt-2 text-lg font-semibold text-emerald-700"
                  : "mt-2 text-lg font-semibold text-red-700"
              }
            >
              {db.ok ? "Connected" : "Not connected"}
            </p>
            {!db.ok && (
              <p className="mt-2 break-words text-sm text-zinc-600">
                {db.message}
              </p>
            )}
          </div>
        </div>

        <nav className="flex flex-wrap gap-3">
          <Link className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold" href="/tournaments">
            大会一覧
          </Link>
          <Link className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold" href="/admin">
            管理ダッシュボード
          </Link>
        </nav>
      </section>
    </main>
  );
}
