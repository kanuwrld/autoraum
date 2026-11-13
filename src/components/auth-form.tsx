"use client";

import { Input } from "./ui/input";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  LockKeyhole,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "./ui/button";
import { Brand, Notice, request, Spinner } from "./ui";

export function AuthForm({ activate = false }: { activate?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const token = useRef("");
  useEffect(() => {
    if (activate) {
      const value = window.location.hash.slice(1);
      if (value) token.current = value;
      // The invitation stays out of request logs and referrers.
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [activate]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      if (activate && data.get("password") !== data.get("confirm"))
        throw new Error("Die Passwörter stimmen nicht überein.");
      if (activate && !token.current)
        throw new Error(
          "Bitte den vollständigen Aktivierungslink aus der Einladung öffnen.",
        );
      const result = await request<{ redirect: string }>(
        activate ? "/api/auth/activate" : "/api/auth/login",
        "POST",
        activate
          ? { token: token.current, password: data.get("password") }
          : { email: data.get("email"), password: data.get("password") },
      );
      window.location.assign(result.redirect);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Anmeldung fehlgeschlagen.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-left">
        <a className="brand-link" href="/login" aria-label="Autoraum Anmeldung">
          <Brand />
        </a>
        <div className="auth-form-wrap">
          <div className="eyebrow">
            <span className="tiny-line" />
            FÜR DEN FAHRZEUGHANDEL
          </div>
          <h1>
            {activate ? "Ihr Zugang.\nIhr Vorsprung." : "Willkommen\nzurück."}
          </h1>
          <p className="muted">
            {activate
              ? "Legen Sie Ihr Passwort fest und öffnen Sie Ihren Arbeitsbereich."
              : "Melden Sie sich in Ihrem Arbeitsbereich an."}
          </p>
          <form onSubmit={submit} className="form-stack">
            {!activate && (
              <label>
                E-Mail-Adresse
                <Input
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="name@example.com"
                  required
                />
              </label>
            )}
            <label>
              {activate ? "Neues Passwort" : "Passwort"}
              <Input
                name="password"
                type="password"
                autoComplete={activate ? "new-password" : "current-password"}
                minLength={activate ? 12 : undefined}
                maxLength={128}
                placeholder={
                  activate ? "Mindestens 12 Zeichen" : "Ihr Passwort"
                }
                required
              />
            </label>
            {activate && (
              <label>
                Passwort wiederholen
                <Input
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </label>
            )}
            {error && <Notice message={error} error />}
            <Button className="w-full h-11" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : (
                <>
                  {activate ? "Zugang aktivieren" : "Anmelden"}
                  <ArrowRight size={17} />
                </>
              )}
            </Button>
          </form>
          <p className="auth-help">
            Zugang oder Passwort vergessen?
            <br />
            Ihre Autoraum-Verwaltung kann einen neuen Aktivierungslink
            erstellen.
          </p>
        </div>
        <footer className="auth-footer">
          <LockKeyhole size={13} />
          Ein geschützter Arbeitsbereich für Ihr Team.
        </footer>
      </section>
      <section className="auth-right">
        <div className="auth-right-top">
          WENIGER SUCHEN. MEHR FINDEN.<span>01 — DE</span>
        </div>
        <div className="auth-pitch">
          <h2>
            Ein Blick.
            <br />
            Neue Möglichkeiten.
          </h2>
          <p>
            Fahrzeugsuche, Merkliste und Ankauf.
            <br />
            Alles an einem Ort.
          </p>
          <div className="auth-diagram">
            <div>
              <SlidersHorizontal size={18} />
              <span>Ihre Kriterien</span>
              <span className="diagram-number">01</span>
            </div>
            <span className="diagram-connector" />
            <div>
              <Search size={18} />
              <span>Verbundene Datenquellen</span>
              <span className="diagram-number">02</span>
            </div>
            <span className="diagram-connector" />
            <div className="diagram-last">
              <Check size={18} />
              <span>Ihr nächster Ankauf</span>
              <span className="diagram-number">03</span>
            </div>
          </div>
        </div>
        <div className="auth-right-bottom">
          <span>Der Arbeitsraum für bessere Ankäufe.</span>
          <span>autoraum.</span>
        </div>
      </section>
    </main>
  );
}
