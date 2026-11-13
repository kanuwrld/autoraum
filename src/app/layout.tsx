import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Autoraum — Fahrzeugrecherche für Händler",
    template: "%s · Autoraum",
  },
  description:
    "Der Arbeitsbereich für Fahrzeugrecherche, Suchaufträge und Ankauf im Autohandel.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
