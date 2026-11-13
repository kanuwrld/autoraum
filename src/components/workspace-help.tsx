"use client";

import { ArrowUpRight } from "lucide-react";

const help = [
  [
    "Fahrzeugrecherche",
    "Marke, Modell, Preis, Erstzulassung, Kilometer, Kraftstoff und weitere Kriterien wählen. Jetzt suchen lädt die verfügbaren Quellen und filtert die Ergebnisse. Sortierung und Seitenwechsel arbeiten mit der geladenen Auswahl. Ort/PLZ ist kein Umkreisfilter. Unbekannte Fahrzeugdaten bleiben unbestätigt.",
  ],
  [
    "Suchaufträge & Eingang",
    "Suche speichern legt ein Profil an. Unter Suchaufträge starten, pausieren oder löschen Sie es. Automatische Intervalle: 15, 30, 60, 180 oder 1440 Minuten. Der erste Lauf füllt den Eingang mit passenden Angeboten; weitere Läufe ergänzen neue Treffer. Ein normaler Suchlauf ohne gespeichertes Profil erzeugt keinen Eingang.",
  ],
  [
    "Benachrichtigungen",
    "Der Zähler ist immer verfügbar. Browserhinweise aktivieren schaltet zusätzliche Hinweise nach Ihrer Erlaubnis ein. Dafür muss Autoraum im Browser geöffnet bleiben. Gelesen/Ungelesen ist persönlich; erneute Funde derselben Quellenanzeige erzeugen keinen zweiten Eingang. Identische Fahrzeuge verschiedener Plattformen werden noch nicht zusammengeführt.",
  ],
  [
    "Merkliste & Ankauf",
    "Fahrzeuge speichern, Notizen ergänzen und den Status von Merkliste über Kontaktiert und Besichtigung bis Gekauft ändern. Archiviert bewahrt die Entscheidung. Entfernen aus der Merkliste löscht deren Notizen und Kalkulation, aber nicht das Fahrzeug und seine Aufgaben.",
  ],
  [
    "Maximaler Ankaufspreis",
    "Ankauf bearbeiten öffnet die Kalkulation. Geplanter Verkauf minus Transport, Reparaturen, Aufbereitung, Gebühren, weitere Kosten, Reserve und gewünschtes Ergebnis ergibt die Obergrenze. Fehlende Werte bleiben offen, bis Sie sie eintragen oder bewusst null ansetzen. Das ist Ihre Planung, keine Markt- oder Steuerbewertung.",
  ],
  [
    "Aufgaben",
    "Aufgabe erstellen an einer Fahrzeugkarte oder Neue Aufgabe im Aufgabenbereich wählen. Verantwortliche Person, Datum und Notiz eintragen. Der Termin gilt bis Tagesende in Europe/Berlin. Filtern Sie nach Meine, Heute oder Überfällig. Erledigte Aufgaben können wieder geöffnet werden. Termin-Erinnerungen außerhalb der Aufgabenliste werden nicht versendet.",
  ],
  [
    "Team & Zugang",
    "Administratoren laden Kolleginnen und Kollegen mit einem einmaligen Link ein. Gültigkeit: 72 Stunden; der Link wird persönlich weitergegeben, keine E-Mail wird automatisch versendet. Administratoren können Zugangslinks erneuern und andere Mitglieder sperren. Einkauf nutzt Suche, Merkliste und Aufgaben. Das eigene Passwort ändern Sie unter Team & Zugang.",
  ],
  [
    "Import & Datenquellen",
    "Daten importieren akzeptiert eine CSV mit maximal 500 eigenen oder freigegebenen Angeboten. Die Vorlage zeigt die Felder. Gleiche Quelle und Anzeigen-ID aktualisieren einen Eintrag. Externe Anbieter und Plattformzugänge richtet der Betreiber ein; ein eingetragener Website-Link allein ist keine Integration.",
  ],
  [
    "Aktivitäten & Quellenstatus",
    "Aktivitäten zeigt die letzten Suchläufe. Live bedeutet frisch abgerufen; Cache zeigt einen vorherigen Abruf mit Zeitangabe. Teilweise bedeutet, dass Quellen oder Teile der Auswahl fehlen. Nicht verbunden benötigt einen Zugang. Fehler ist kein Beweis für null passende Fahrzeuge. Eine begrenzte Auswahl ist nicht der gesamte Markt; prüfen Sie vor Kontakt das Originalangebot.",
  ],
] as const;

export function WorkspaceHelp({
  onNavigate,
}: {
  onNavigate: (view: string) => void;
}) {
  const steps = [
    {
      label: "Suchprofil speichern",
      detail: "Passende Kriterien einmal festlegen.",
      view: "searches",
    },
    {
      label: "Eingänge prüfen",
      detail: "Den ersten gespeicherten Suchlauf starten.",
      view: "inbox",
    },
    {
      label: "Ankauf kalkulieren",
      detail: "Ein Fahrzeug in der Merkliste bearbeiten.",
      view: "saved",
    },
    {
      label: "Nächste Aktion zuweisen",
      detail: "Mit verantwortlicher Person und Termin.",
      view: "tasks",
    },
  ];
  return (
    <div className="help-layout">
      <section className="panel help-start">
        <h2>Ihr erster Ankauf in vier Schritten</h2>
        <p className="muted">Suchen → prüfen → kalkulieren → handeln.</p>
        <div className="help-steps">
          {steps.map((step, index) => (
            <button key={step.view} onClick={() => onNavigate(step.view)}>
              <span className="help-step-number">{index + 1}</span>
              <span>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
              <ArrowUpRight size={17} />
            </button>
          ))}
        </div>
      </section>
      <section className="panel help-topics" aria-label="Funktionsübersicht">
        {help.map(([title, body]) => (
          <details key={title}>
            <summary>{title}</summary>
            <p>{body}</p>
          </details>
        ))}
      </section>
      <p className="helper">
        Bei einer lokalen Installation müssen Computer, Anwendung und Suchdienst
        laufen. Geschlossene Tabs erhalten keine Systemhinweise; gespeicherte
        Eingänge bleiben erhalten.
      </p>
    </div>
  );
}
