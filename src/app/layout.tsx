import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Hindsight — 판단 일지", description: "결정을 기록하고, 나중에 얼마나 맞았는지 확인하세요." };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="ko"><body>{children}</body></html>);
}
