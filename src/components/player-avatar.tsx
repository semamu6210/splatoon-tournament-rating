"use client";

import Image from "next/image";
import { useState } from "react";

type PlayerAvatarProps = {
  avatarUrl?: string | null;
  name: string;
  size?: number;
};

function sizedDiscordAvatarUrl(avatarUrl: string, size: number) {
  if (!avatarUrl.includes("cdn.discordapp.com/avatars/")) return avatarUrl;
  try {
    const url = new URL(avatarUrl);
    url.searchParams.set("size", String(Math.min(Math.max(32, 2 ** Math.ceil(Math.log2(size))), 128)));
    return url.toString();
  } catch {
    return avatarUrl;
  }
}

export function PlayerAvatar({ avatarUrl, name, size = 40 }: PlayerAvatarProps) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const showImage = Boolean(avatarUrl) && !failed;

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-200 text-sm font-semibold text-zinc-700"
      style={{ height: size, width: size }}
    >
      {showImage ? (
        <Image
          alt={`${name}のDiscordアイコン`}
          className="h-full w-full object-cover"
          height={size}
          onError={() => setFailed(true)}
          src={sizedDiscordAvatarUrl(avatarUrl!, size)}
          width={size}
        />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}
