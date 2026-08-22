import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Splatoon 大会レーティングシステム",
  description: "Splatoon大会向けのレート計算・マッチングサービスです。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
