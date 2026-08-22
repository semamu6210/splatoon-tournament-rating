import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PlayerAvatar } from "@/components/player-avatar";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement("img", props),
}));

describe("PlayerAvatar", () => {
  it("renders a Discord avatar image when avatarUrl is present", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlayerAvatar, {
        avatarUrl: "https://cdn.discordapp.com/avatars/user/hash.png",
        name: "せまむ",
      }),
    );

    expect(html).toContain("cdn.discordapp.com/avatars/user/hash.png");
    expect(html).toContain("Discordアイコン");
  });

  it("renders a fallback initial when avatarUrl is missing", () => {
    const html = renderToStaticMarkup(React.createElement(PlayerAvatar, { avatarUrl: null, name: "semamu" }));

    expect(html).not.toContain("<img");
    expect(html).toContain("S");
  });
});
