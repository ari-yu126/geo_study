import type { Metadata } from "next";
import { Syne, Noto_Sans_KR, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const notoSansKR = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-body",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GEO Analyzer — AI 검색 최적화 분석기",
  description:
    "URL을 입력하면 AI가 페이지를 분석해 GEO 점수, 키워드, 개선사항을 제공합니다",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body
        className={`${syne.variable} ${notoSansKR.variable} ${jetbrainsMono.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
