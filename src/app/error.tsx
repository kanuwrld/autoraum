"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone">
      <h1>Ein kurzer Zwischenstopp.</h1>
      <p>
        Der Arbeitsbereich konnte nicht geladen werden. Bitte versuchen Sie es
        erneut.
      </p>
      <button className="button primary" onClick={reset}>
        Erneut laden
      </button>
    </main>
  );
}
