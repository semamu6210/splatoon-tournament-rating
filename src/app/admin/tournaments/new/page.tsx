import Link from "next/link";

import { AuthControls } from "@/components/auth-controls";
import { TournamentForm } from "@/components/tournament-form";
import { auth } from "@/auth";
import { canManage } from "@/lib/permissions";

export default async function NewTournamentPage() {
  const session = await auth();
  const allowed = session?.user ? canManage(session.user.role) : false;

  return (
    <main className="min-h-screen px-5 py-8">
      <section className="mx-auto grid max-w-3xl gap-6">
        <header className="flex flex-col gap-4 border-b border-zinc-300 pb-5">
          <Link className="text-sm text-zinc-600" href="/admin">← 管理</Link>
          <h1 className="text-3xl font-bold">大会作成</h1>
          <AuthControls />
        </header>
        {allowed ? <TournamentForm mode="create" /> : <p className="text-red-700">ADMINまたはOWNER権限が必要です。</p>}
      </section>
    </main>
  );
}
