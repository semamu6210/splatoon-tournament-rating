import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Splatoon Tournament Rating System",
  description: "Tournament-only rating and matchmaking service for Splatoon.",
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
