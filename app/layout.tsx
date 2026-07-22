import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const viewport: Viewport = { colorScheme: "dark", themeColor: "#0d1211" };

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3001";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  return {
    metadataBase: base,
    applicationName: "ScenePilot Studio",
    title: "ScenePilot Studio — Cut with intent",
    description: "A beat-aware music video cut planner for placing effects, images, and motion with deliberate section-level timing.",
    openGraph: { title: "ScenePilot Studio", description: "Cut with intent. Build dynamic music video edits around beats, scenes, and creative sections.", images: [{ url: "/og.png", width: 1680, height: 945 }] },
    twitter: { card: "summary_large_image", title: "ScenePilot Studio", description: "Beat-aware music video editing, shaped section by section.", images: ["/og.png"] },
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "ScenePilot" },
    formatDetection: { telephone: false },
    icons: {
      icon: [{ url: "/app-icon-192.png", type: "image/png", sizes: "192x192" }],
      shortcut: "/app-icon-192.png",
      apple: [{ url: "/app-icon-192.png", sizes: "192x192" }],
    },
    other: { "mobile-web-app-capable": "yes" },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
