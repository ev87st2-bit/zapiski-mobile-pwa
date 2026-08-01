import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#F5F8FD",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  return {
    metadataBase: base,
    title: "Записки — заметки, идеи и задачи",
    description: "Личное место для быстрых заметок, идей и задач. Данные остаются на вашем устройстве.",
    applicationName: "Записки",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "default", title: "Записки" },
    formatDetection: { telephone: false },
    icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/icons/icon-192.png" },
    openGraph: {
      title: "Записки",
      description: "Заметки, идеи и задачи — спокойно и вовремя",
      type: "website",
      images: [{ url: new URL("/og.png", base), width: 1536, height: 1024, alt: "Записки — личное приложение для заметок, идей и задач" }],
    },
    twitter: { card: "summary_large_image", title: "Записки", description: "Заметки, идеи и задачи — спокойно и вовремя", images: [new URL("/og.png", base)] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
