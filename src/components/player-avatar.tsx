"use client";

import Image from "next/image";
import { useState } from "react";

type PlayerAvatarProps = {
  avatarUrl?: string | null;
  name: string;
  size?: number;
};

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
          src={avatarUrl!}
          width={size}
        />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}
