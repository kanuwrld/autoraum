"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ChevronRight,
  ChevronsUpDown,
  LogOut,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { Brand, request } from "./ui";
import type { User } from "@/lib/types";

export type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  count?: number;
  group?: string;
};
export function Shell({
  name,
  subtitle,
  user,
  nav,
  active,
  setActive,
  children,
  adminLink = false,
  toolbar,
}: {
  name: string;
  subtitle: string;
  user: User;
  nav: NavItem[];
  active: string;
  setActive: (value: string) => void;
  children: ReactNode;
  adminLink?: boolean;
  toolbar?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Zum Inhalt springen
      </a>
      {open && (
        <button
          className="sidebar-shade"
          onClick={() => setOpen(false)}
          aria-label="Navigation schließen"
        />
      )}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-only"
            onClick={() => setOpen(false)}
            aria-label="Navigation schließen"
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-switch">
          <span className="workspace-monogram">
            {name.slice(0, 2).toUpperCase()}
          </span>
          <span>
            <strong>{name}</strong>
            <small>{subtitle}</small>
          </span>
          <ChevronsUpDown size={14} />
        </div>
        <nav aria-label="Hauptnavigation">
          {nav.map((item, i) => (
            <div key={item.id}>
              {item.group && <div className="nav-group">{item.group}</div>}
              {i === 0 && !item.group && (
                <div className="nav-group">ARBEITSBEREICH</div>
              )}
              <button
                className={`nav-item ${active === item.id ? "active" : ""}`}
                aria-current={active === item.id ? "page" : undefined}
                onClick={() => {
                  setActive(item.id);
                  setOpen(false);
                }}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {item.count !== undefined && (
                  <span className="nav-count">{item.count}</span>
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {adminLink && (
            <a className="admin-back" href="/admin">
              <ArrowLeft size={15} />
              Zur Verwaltung
            </a>
          )}
          <div className="workspace-private">
            <span className="status-dot" />
            <span>Privater Arbeitsbereich</span>
          </div>
          <div className="sidebar-user">
            <span className="avatar">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{user.name}</strong>
              <small>
                {user.role === "platform_admin"
                  ? "Plattform-Admin"
                  : user.role === "owner"
                    ? "Administrator"
                    : "Einkauf"}
              </small>
            </span>
            <button
              className="icon-button"
              aria-label="Abmelden"
              title="Abmelden"
              onClick={async () => {
                await request("/api/auth/logout", "POST", {});
                window.location.replace(
                  new URL("/login", window.location.origin).href,
                );
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <button
            className="icon-button mobile-only"
            aria-label="Navigation öffnen"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumbs">
            <span>{name}</span>
            <ChevronRight size={13} />
            <strong>{nav.find((n) => n.id === active)?.label}</strong>
          </div>
          <div className="topbar-right">
            {toolbar}
            <span className="country">
              <span>DE</span> Deutschland
            </span>
            <span className="topbar-avatar">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {children}
        </main>
        <footer className="app-footer">
          <span>
            autoraum.{" "}
            <span className="muted">
              Der Arbeitsraum für den Fahrzeughandel.
            </span>
          </span>
          <span>Alle Preise in EUR · Datenstand je Anzeige</span>
        </footer>
      </div>
    </div>
  );
}
