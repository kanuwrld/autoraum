"use client";

import { Input } from "./ui/input";
import { useState, type ReactNode } from "react";
import { Badge as ShadcnBadge } from "./ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { ArrowUpRight, Check, Copy, LoaderCircle, X } from "lucide-react";

export async function request<T = { ok: boolean }>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response
    .json()
    .catch(() => ({ error: "Die Antwort konnte nicht gelesen werden." }));
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith("/api/auth/"))
      window.location.replace(new URL("/login", window.location.origin).href);
    throw new Error(data.error || "Die Anfrage ist fehlgeschlagen.");
  }
  return data as T;
}
export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`brand ${inverse ? "inverse" : ""}`}>
      <span className="brand-mark">
        <i />
        <i />
      </span>
      <span>
        autoraum<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
export function Spinner() {
  return <LoaderCircle size={16} className="spin" aria-hidden="true" />;
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red";
}) {
  return (
    <ShadcnBadge
      variant={tone === "red" ? "destructive" : "outline"}
      className="rounded-md font-normal gap-1.5"
    >
      {children}
    </ShadcnBadge>
  );
}
export function Notice({
  message,
  error = false,
  onClose,
}: {
  message: string;
  error?: boolean;
  onClose?: () => void;
}) {
  return (
    <div
      className={`notice ${error ? "error" : "success"}`}
      role={error ? "alert" : "status"}
    >
      <span>{message}</span>
      {onClose && (
        <button
          className="icon-button"
          aria-label="Meldung schließen"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className={`max-h-[90dvh] overflow-y-auto p-0 gap-0 ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"}`}
      >
        <DialogHeader className="px-6 py-5 border-b pr-12 text-left">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="min-w-0 p-6">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export function CopyBox({
  value,
  secret = false,
}: {
  value: string;
  secret?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-box">
      <Input
        aria-label={secret ? "Einmaliger Schlüssel" : "Link zum Kopieren"}
        value={value}
        readOnly
        onFocus={(e) => e.target.select()}
      />
      <button
        className="icon-button"
        title="Kopieren"
        aria-label="Kopieren"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check size={18} /> : <Copy size={18} />}
      </button>
    </div>
  );
}
export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="text-link"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ArrowUpRight size={14} />
    </a>
  );
}
export const euros = (cents: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
export const number = (n: number) => new Intl.NumberFormat("de-DE").format(n);
export const dateTime = (time: number | null | undefined) =>
  time
    ? new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Berlin",
      }).format(new Date(time))
    : "Noch nicht";
