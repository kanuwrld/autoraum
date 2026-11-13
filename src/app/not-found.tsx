import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone">
      <span className="eyebrow">404</span>
      <h1>Hier geht es nicht weiter.</h1>
      <p>
        Dieser Arbeitsbereich existiert nicht oder ist für Sie nicht
        freigegeben.
      </p>
      <Link className="button primary" href="/">
        Zum Arbeitsbereich
      </Link>
    </main>
  );
}
