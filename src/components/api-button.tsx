"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ApiButtonProps = {
  children: React.ReactNode;
  method?: "POST" | "PATCH";
  url: string;
  body?: Record<string, unknown>;
  className?: string;
};

export function ApiButton({ children, method = "POST", url, body, className }: ApiButtonProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setMessage(null);

    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await response.json().catch(() => null)) as { error?: string } | null;

    setPending(false);

    if (!response.ok) {
      setMessage(json?.error ?? "Request failed.");
      return;
    }

    setMessage("完了しました。");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        className={className ?? "rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-400"}
        disabled={pending}
        onClick={submit}
        type="button"
      >
        {pending ? "処理中..." : children}
      </button>
      {message && <p className="text-sm text-zinc-700">{message}</p>}
    </div>
  );
}
