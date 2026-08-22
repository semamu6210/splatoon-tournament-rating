import { auth, signIn, signOut } from "@/auth";

export async function AuthControls() {
  const session = await auth();
  const discordReady =
    Boolean(process.env.AUTH_DISCORD_ID) &&
    Boolean(process.env.AUTH_DISCORD_SECRET);

  if (!session?.user) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <form
          action={async () => {
            "use server";
            await signIn("discord");
          }}
        >
          <button
            className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
            disabled={!discordReady}
            type="submit"
          >
            Discordでログイン
          </button>
        </form>
        {!discordReady && (
          <p className="text-sm text-red-700">
            Discord OAuth未設定です。.envにAUTH_DISCORD_ID / AUTH_DISCORD_SECRETを設定してください。
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="text-sm text-zinc-700">
        <span className="font-semibold text-zinc-950">
          {session.user.discordUsername ?? session.user.name ?? "Logged in"}
        </span>{" "}
        / {session.user.role}
      </div>
      <form
        action={async () => {
          "use server";
          await signOut();
        }}
      >
        <button className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold" type="submit">
          ログアウト
        </button>
      </form>
    </div>
  );
}
