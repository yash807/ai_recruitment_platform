import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AI Talent | Talent Intelligence Platform",
    template: "%s | AI Talent",
  },
  description:
    "An explainable talent intelligence platform connecting career readiness, structured interviews, candidate matching and placement outcomes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
