"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";

const storageKey = (tenantId: string, userId: string) =>
  `autoraum:notifications:${tenantId}:${userId}`;
const sessionPreferences = new Map<string, string>();
function readPreference(key: string) {
  try {
    return localStorage.getItem(key) ?? sessionPreferences.get(key) ?? null;
  } catch {
    return sessionPreferences.get(key) ?? null;
  }
}
function writePreference(key: string, value: string) {
  sessionPreferences.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Session-only notifications remain available. */
  }
}

export function DesktopNotificationSettings({
  tenantId,
  userId,
}: {
  tenantId: string;
  userId: string;
}) {
  const [state, setState] = useState<
    "loading" | "unsupported" | "denied" | "off" | "on"
  >("loading");
  const [busy, setBusy] = useState(false);
  const key = storageKey(tenantId, userId);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active)
        setState(
          !("Notification" in window)
            ? "unsupported"
            : Notification.permission === "denied"
              ? "denied"
              : Notification.permission === "granted" &&
                  readPreference(key) === "on"
                ? "on"
                : "off",
        );
    });
    return () => {
      active = false;
    };
  }, [key]);
  async function toggle() {
    if (busy) return;
    if (state === "on") {
      writePreference(key, "off");
      setState("off");
      return;
    }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      writePreference(key, permission === "granted" ? "on" : "off");
      setState(
        permission === "granted"
          ? "on"
          : permission === "denied"
            ? "denied"
            : "off",
      );
    } catch {
      setState("unsupported");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="notification-settings panel">
      <div>
        <strong>
          <Bell size={16} />
          Hinweise auf neue Fahrzeuge
        </strong>
        <p>
          {state === "unsupported"
            ? "Dieser Browser unterstützt keine Desktop-Hinweise. Der Eingang bleibt verfügbar."
            : state === "denied"
              ? "Browserhinweise sind blockiert. Sie können sie in den Website-Einstellungen erlauben."
              : "Im Eingang immer aktiv. Optionale Browserhinweise funktionieren, solange Autoraum geöffnet ist."}
        </p>
      </div>
      <button
        className="button secondary small"
        disabled={busy || ["loading", "unsupported", "denied"].includes(state)}
        onClick={() => void toggle()}
      >
        {state === "on"
          ? "Browserhinweise ausschalten"
          : "Browserhinweise aktivieren"}
      </button>
    </div>
  );
}

export function WorkspaceNotifications({
  tenantId,
  userId,
  latestKey,
  unread,
  onOpen,
}: {
  tenantId: string;
  userId: string;
  latestKey: string;
  unread: number;
  onOpen: () => void;
}) {
  const previous = useRef(latestKey);
  const openInbox = useRef(onOpen);
  useEffect(() => {
    openInbox.current = onOpen;
  }, [onOpen]);
  const [message, setMessage] = useState("");
  const key = storageKey(tenantId, userId);
  useEffect(() => {
    if (!latestKey || latestKey === previous.current) return;
    previous.current = latestKey;
    let active = true;
    const show = async () => {
      const delivered = readPreference(`${key}:cursor`);
      if (!active || (delivered && delivered >= latestKey)) return;
      writePreference(`${key}:cursor`, latestKey);
      if (!unread) return;
      const body = `${unread} ungelesene ${unread === 1 ? "Anzeige" : "Anzeigen"} im Eingang.`;
      setMessage(body);
      if (
        "Notification" in window &&
        Notification.permission === "granted" &&
        readPreference(key) === "on"
      ) {
        try {
          const notification = new Notification("Autoraum · Neue Fahrzeuge", {
            body,
            tag: key,
          });
          notification.onclick = () => {
            window.focus();
            openInbox.current();
            notification.close();
          };
        } catch {
          /* The in-app notice is the fallback when the browser cannot display a notification. */
        }
      }
    };
    if (navigator.locks) void navigator.locks.request(key, show).catch(show);
    else void show();
    return () => {
      active = false;
    };
  }, [key, latestKey, unread]);
  return (
    <>
      <button
        className="notification-bell"
        aria-label={`Eingang öffnen, ${unread} ungelesen`}
        title="Fahrzeugeingang"
        onClick={() => {
          setMessage("");
          onOpen();
        }}
      >
        <Bell size={19} />
        {unread > 0 && <span>{unread > 99 ? "99+" : unread}</span>}
      </button>
      {message && (
        <div className="notification-toast" role="status">
          <Bell size={19} />
          <div>
            <strong>Neue Fahrzeuge gefunden</strong>
            <p>{message}</p>
            <button
              className="text-button"
              onClick={() => {
                setMessage("");
                onOpen();
              }}
            >
              Eingang ansehen
            </button>
          </div>
          <button
            className="icon-button"
            aria-label="Hinweis schließen"
            onClick={() => setMessage("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
