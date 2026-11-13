"""Real-browser acceptance tests. All data lives in an isolated temporary database."""
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import urllib.request
import uuid
from workflow_e2e import verify_workflows
from operations_e2e import verify_operations

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "test-results"
OUTPUT.mkdir(exist_ok=True)
PORT = int(os.environ.get("E2E_PORT", "3107"))
BASE = f"http://localhost:{PORT}"
PASSWORD = "E2E-only-password-12345"
CRON = "e2e-only-cron-secret-not-for-production-12345"
test_id = uuid.uuid4().hex[:10]
db_path = OUTPUT / f"e2e-{test_id}.sqlite"
env = {**os.environ, "SQLITE_PATH": str(db_path), "APP_URL": BASE, "ALLOW_LOCAL_DB": "1",
       "DATA_ENCRYPTION_KEY": "c" * 64, "CRON_SECRET": CRON, "DATABASE_URL": "", "PUBLIC_MARKETPLACE_SEARCH": "0", "MOBILE_API_USERNAME": "", "MOBILE_API_PASSWORD": ""}
subprocess.run(["npx", "tsx", "tests/seed-e2e.ts"], cwd=ROOT, env=env, check=True)
log = open(OUTPUT / "e2e-server.log", "w")
server = subprocess.Popen(["npm", "run", "start", "--", "--port", str(PORT)], cwd=ROOT,
                          env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
checks = []


def check(name):
    checks.append(name)
    print(f"PASS {name}", flush=True)


def api(context, path, method="GET", body=None, status=200, headers=None):
    kwargs = {"method": method, "headers": {"Origin": BASE, **(headers or {})}}
    if body is not None:
        kwargs["data"] = body
    response = context.request.fetch(BASE + path, **kwargs)
    assert response.status == status, f"{method} {path}: {response.status}: {response.text()[:400]}"
    return response.json()


def ready(page):
    page.wait_for_load_state("networkidle")
    expect(page.get_by_text("Ein kurzer Zwischenstopp.", exact=True)).to_have_count(0)


try:
    for _ in range(150):
        try:
            if urllib.request.urlopen(BASE + "/api/health", timeout=1).status == 200:
                break
        except Exception:
            if server.poll() is not None:
                raise RuntimeError("E2E server stopped; see test-results/e2e-server.log")
            time.sleep(.2)
    else:
        raise RuntimeError("E2E server did not start")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        admin = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = admin.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE + "/login")
        ready(page)
        assert page.get_by_label("E-Mail-Adresse").count() == 1
        page.get_by_label("E-Mail-Adresse").fill("admin@example.test")
        page.get_by_label("Passwort", exact=True).fill(PASSWORD)
        page.get_by_role("button", name="Anmelden", exact=True).click()
        page.wait_for_url("**/admin")
        ready(page)
        expect(page.get_by_role("heading", name="Ein Zuhause für Ihre Kunden.")).to_be_visible()
        check("administrator login and server-rendered dashboard")

        page.get_by_role("button", name="Betrieb anlegen", exact=True).click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_label("Firmenname", exact=True).fill("TEST Autohaus Alpha")
        dialog.get_by_label("Kontaktperson").fill("Test Owner Alpha")
        dialog.get_by_label("E-Mail-Adresse").fill("alpha@example.test")
        dialog.get_by_role("button", name="Betrieb erstellen").click()
        link_input = page.get_by_role("dialog").get_by_label("Link zum Kopieren")
        expect(link_input).to_be_visible()
        invite_url = link_input.input_value()
        page.get_by_role("button", name="Fertig", exact=True).click()
        expect(page.get_by_role("link", name="TEST Autohaus Alpha")).to_be_visible()
        check("company creation automatically produces workspace and one-use activation link")

        owner = browser.new_context(viewport={"width": 1440, "height": 1100})
        work = owner.new_page()
        work.on("pageerror", lambda error: errors.append(str(error)))
        work.goto(invite_url)
        ready(work)
        work.get_by_label("Neues Passwort", exact=True).fill(PASSWORD)
        work.get_by_label("Passwort wiederholen").fill(PASSWORD)
        work.get_by_role("button", name="Zugang aktivieren").click()
        work.wait_for_url("**/w/test-autohaus-alpha")
        ready(work)
        expect(work.get_by_role("heading", name="Fahrzeuge finden")).to_be_visible()
        assert work.locator(".listing-card").count() == 0
        expect(work.get_by_role("navigation").get_by_role("button", name="Datenquellen", exact=True)).to_have_count(0)
        expect(work.get_by_role("button", name="Datenquellen verwalten", exact=True)).to_have_count(0)
        expect(work.get_by_role("button", name="Datenquellen ansehen", exact=True)).to_have_count(0)
        check("invitation activation opens an empty workspace without fake inventory")
        api(owner, "/api/auth/activate", "POST", {"token": invite_url.split("#")[1], "password": PASSWORD}, 400)
        api(owner, "/api/admin/tenants", status=403)
        api(owner, "/api/w/test-autohaus-alpha/search", "POST", {"filters": {}}, 403, {"Origin": "https://evil.example.test"})
        check("invitation cannot be reused; non-admin access and cross-origin writes rejected")

        csv = "externalId,source,url,title,make,model,price,year,mileage,fuel,city,postalCode,damaged\nTEST-1,csv,https://fixtures.example.test/car1,TEST BMW 320d,BMW,320d,18000,2020,80000,DIESEL,Regensburg,93047,false\nTEST-2,csv,https://fixtures.example.test/car2,TEST Audi A4,AUDI,A4,25000,2022,50000,PETROL,München,80331,false\n"
        work.get_by_role("button", name="Daten importieren", exact=True).click()
        dialog = work.get_by_role("dialog")
        dialog.get_by_label("CSV-Inhalt").fill(csv)
        dialog.get_by_role("button", name="Daten importieren", exact=True).click()
        expect(work.get_by_role("dialog")).to_have_count(0)
        expect(work.locator(".listing-card")).to_have_count(2)
        repeated = api(owner, "/api/w/test-autohaus-alpha/import", "POST", {"csv": csv.replace(",18000,", ",17500,")})
        assert repeated == {"added": 0, "updated": 2, "total": 2}
        check("CSV import is real, atomic, and updates existing source IDs without duplicates")

        work.get_by_label("Marke", exact=True).select_option("BMW")
        work.get_by_label("Preis bis (€)", exact=True).fill("20000")
        work.get_by_role("button", name="Jetzt suchen", exact=True).click()
        expect(work.locator(".listing-card")).to_have_count(1)
        expect(work.get_by_text("17.500 €", exact=True)).to_be_visible()
        report = api(owner, "/api/w/test-autohaus-alpha/workspace")
        assert report["runs"][0]["matches"] == 1
        assert any(r["status"] == "disconnected" for r in report["runs"][0]["results"])
        check("manual search applies filters and reports disconnected marketplaces honestly")
        source_status = work.get_by_role("region", name="Suchstatus der Quellen")
        expect(source_status.locator(".source-status-item")).to_have_count(8)
        expect(source_status.get_by_text("Nicht verbunden", exact=True)).to_have_count(8)
        for source in ["AutoScout24", "Kleinanzeigen", "PKW.de", "Autohero", "markt.de", "Quoka", "auto.de", "mobile.de"]:
            expect(source_status.get_by_role("link", name=source + " Nicht verbunden", exact=True)).to_be_visible()
        work.reload()
        ready(work)
        expect(source_status.get_by_text("Nicht verbunden", exact=True)).to_have_count(8)
        expect(source_status.get_by_text("Letzter Suchlauf:", exact=False)).to_be_visible()
        work.get_by_label("Marke", exact=True).select_option("BMW")
        work.get_by_label("Preis bis (€)", exact=True).fill("20000")
        check("eight source statuses are visible without customer configuration and survive reload")

        work.get_by_role("button", name="Suche speichern", exact=True).click()
        dialog = work.get_by_role("dialog")
        dialog.get_by_label("Name der Suche").fill("TEST Einkauf BMW")
        dialog.get_by_label("Suchintervall").select_option("15")
        dialog.get_by_label("Automatische Suche aktivieren").check()
        dialog.get_by_role("button", name="Suchauftrag speichern", exact=True).click()
        expect(work.get_by_role("dialog")).to_have_count(0)
        cron = api(owner, "/api/cron", headers={"Authorization": "Bearer " + CRON})
        assert cron["processed"] == 1
        report = api(owner, "/api/w/test-autohaus-alpha/workspace")
        assert report["searches"][0]["match_count"] == 1
        assert report["schedulerHeartbeat"] > 0
        api(owner, "/api/cron", status=401)
        check("saved automatic searches execute from authenticated cron and persist new matches")

        work.get_by_role("button", name="TEST BMW 320d merken", exact=True).click()
        expect(work.get_by_text("Fahrzeug zur Merkliste hinzugefügt.")).to_be_visible()
        work.get_by_role("button", name="TEST BMW 320d bearbeiten", exact=True).click()
        dialog = work.get_by_role("dialog")
        dialog.get_by_label("Status", exact=True).select_option("contacted")
        dialog.get_by_label("Notizen", exact=True).fill("TEST ONLY: Rückruf am Freitag")
        dialog.get_by_label("Geplanter Einkauf (€)").fill("17000")
        dialog.get_by_label("Weitere Kosten (€)").fill("1000")
        dialog.get_by_label("Geplanter Verkauf (€)").fill("21000")
        expect(dialog.get_by_text("3.000 €", exact=True)).to_be_visible()
        dialog.get_by_role("button", name="Änderungen speichern").click()
        expect(work.get_by_role("dialog")).to_have_count(0)
        saved = api(owner, "/api/w/test-autohaus-alpha/listings?saved=1")
        assert saved["total"] == 1 and saved["listings"][0]["stage"] == "contacted"
        assert saved["listings"][0]["notes"] == "TEST ONLY: Rückruf am Freitag"
        listing_id = saved["listings"][0]["id"]
        check("shortlist, purchase status, notes and cost calculations persist")

        other = api(admin, "/api/admin/tenants", "POST", {"name": "TEST Autohaus Beta", "slug": "test-autohaus-beta", "email": "beta@example.test", "ownerName": "Test Owner Beta"})
        beta = browser.new_context()
        api(beta, "/api/auth/activate", "POST", {"token": other["invitationUrl"].split("#")[1], "password": PASSWORD})
        api(beta, "/api/w/test-autohaus-alpha/workspace", status=404)
        assert api(beta, "/api/w/test-autohaus-beta/listings")["total"] == 0
        api(beta, "/api/w/test-autohaus-beta/saved/" + listing_id, "PUT", {"stage": "saved"}, 404)
        search_id = report["searches"][0]["id"]
        api(beta, "/api/w/test-autohaus-beta/search", "POST", {"searchId": search_id}, 404)
        check("company isolation blocks cross-tenant reads, bookmarks and search execution")

        team = api(owner, "/api/w/test-autohaus-alpha/team", "POST", {"name": "TEST Buyer", "email": "buyer@example.test", "role": "buyer"})
        buyer = browser.new_context()
        api(buyer, "/api/auth/activate", "POST", {"token": team["invitationUrl"].split("#")[1], "password": PASSWORD})
        api(buyer, "/api/w/test-autohaus-alpha/providers", "PUT", {"username": "test", "password": "test"}, 403)
        api(buyer, "/api/w/test-autohaus-alpha/team", "POST", {"name": "TEST unauthorized", "email": "bad@example.test"}, 403)
        check("buyer role cannot manage integrations or invite administrators")

        verify_workflows(work, owner, buyer, beta, api, check, BASE, OUTPUT, listing_id, search_id)
        verify_operations(work, owner, buyer, beta, admin, api, check, BASE, OUTPUT, PASSWORD)

        api(owner, "/api/w/test-autohaus-alpha/providers", "PUT", {"username": "test", "password": "test"}, 403)
        api(owner, "/api/w/test-autohaus-alpha/providers", "DELETE", {}, 403)
        api(owner, "/api/w/test-autohaus-alpha/feed-key", "POST", {}, 403)
        api(owner, "/api/w/test-autohaus-alpha/feed-key", "DELETE", {}, 403)
        page.goto(BASE + "/w/test-autohaus-alpha")
        ready(page)
        page.get_by_role("navigation").get_by_role("button", name="Datenquellen", exact=True).click()
        expect(page.get_by_role("heading", name="Datenquellen", exact=True)).to_be_visible()
        check("source settings are hidden from customers and protected by platform-admin authorization")

        feed = api(admin, "/api/w/test-autohaus-alpha/feed-key", "POST", {})["token"]
        payload = {"listings": [{"externalId": "TEST-FEED", "source": "partner", "url": "https://fixtures.example.test/feed", "title": "TEST Feed vehicle", "make": "BMW", "model": "X3", "price": 28000}]}
        assert api(owner, "/api/ingest", "POST", payload, headers={"Authorization": "Bearer " + feed})["added"] == 1
        assert api(owner, "/api/ingest", "POST", payload, headers={"Authorization": "Bearer " + feed})["updated"] == 1
        api(admin, "/api/w/test-autohaus-alpha/feed-key", "POST", {})
        api(owner, "/api/ingest", "POST", payload, 401, {"Authorization": "Bearer " + feed})
        check("partner feed is authenticated, idempotent and key rotation revokes previous access")

        api(owner, "/api/w/test-autohaus-alpha/external-sources", "POST", {"name": "TEST Denied", "website": "https://supplier.example.test"}, 403)
        api(buyer, "/api/w/test-autohaus-alpha/external-sources", "POST", {"name": "TEST Denied", "website": "https://supplier.example.test"}, 403)
        page.get_by_role("button", name="Anbieter hinzufügen", exact=True).click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_label("Anbietername", exact=True).fill("TEST Lieferant A")
        dialog.get_by_label("Website des Anbieters").fill("https://supplier-a.example.test")
        dialog.get_by_role("button", name="Anbieter erstellen", exact=True).click()
        expect(dialog.get_by_role("heading", name="Feed-Schlüssel sichern")).to_be_visible()
        supplier_key = dialog.get_by_label("Einmaliger Schlüssel").input_value()
        dialog.get_by_role("button", name="Fertig", exact=True).click()
        sources = api(admin, "/api/w/test-autohaus-alpha/workspace")["externalSources"]
        supplier = next(s for s in sources if s["name"] == "TEST Lieferant A")
        assert supplier["listingCount"] == 0 and supplier["enabled"]
        assert "token_hash" not in supplier
        expect(page.get_by_text("Wartet auf Daten", exact=True)).to_be_visible()
        item = {"externalId": "TEST-SHARED-ID", "url": "https://supplier-a.example.test/car", "title": "TEST Supplier car", "make": "BMW", "model": "M2", "price": 30000}
        assert api(owner, "/api/ingest", "POST", {"listings": [item]}, headers={"Authorization": "Bearer " + supplier_key})["added"] == 1
        supplier_b = api(admin, "/api/w/test-autohaus-alpha/external-sources", "POST", {"name": "TEST Lieferant B mit einem langen Namen zur Prüfung des mobilen Layouts", "website": "https://supplier-b.example.test"})
        assert api(owner, "/api/ingest", "POST", {"listings": [{**item, "price": 31000}]}, headers={"Authorization": "Bearer " + supplier_b["token"]})["added"] == 1
        api(beta, "/api/w/test-autohaus-beta/import", "POST", {"csv": "externalId,source,url,title,make,model,price\nTEST-FOREIGN," + supplier["id"] + ",https://supplier-a.example.test/car,TEST Forbidden,BMW,M2,30000\n"}, 400)
        api(owner, "/api/w/test-autohaus-alpha/external-sources/" + supplier["id"] + "/key", "POST", {}, 403)
        work.reload(); ready(work)
        expect(work.locator(".source-tag").filter(has_text="TEST Lieferant A")).to_have_count(1)
        expect(work.locator(".source-tag").filter(has_text="TEST Lieferant B")).to_have_count(1)
        work.get_by_text("Weitere Filter", exact=False).click()
        work.get_by_label("TEST Lieferant A", exact=True).check()
        work.get_by_role("button", name="Jetzt suchen", exact=True).click()
        expect(work.locator(".listing-card")).to_have_count(1)
        expect(work.locator(".source-tag")).to_have_text("TEST Lieferant A")
        check("named suppliers have separate inventory and keys, client-visible labels and working source filters")

        page.reload(); ready(page)
        page.get_by_role("navigation").get_by_role("button", name="Datenquellen", exact=True).click()
        supplier_row = page.locator('[data-source-id="' + supplier["id"] + '"]')
        expect(supplier_row.get_by_text("Daten empfangen", exact=True)).to_be_visible()
        supplier_row.get_by_role("button", name="Schlüssel erneuern", exact=True).click()
        page.get_by_role("dialog").get_by_role("button", name="Schlüssel erstellen", exact=True).click()
        rotated_key = page.get_by_role("dialog").get_by_label("Einmaliger Schlüssel")
        expect(rotated_key).to_be_visible()
        new_supplier_key = rotated_key.input_value()
        page.get_by_role("dialog").get_by_role("button", name="Fertig", exact=True).click()
        api(owner, "/api/ingest", "POST", {"listings": [item]}, 401, {"Authorization": "Bearer " + supplier_key})
        assert api(owner, "/api/ingest", "POST", {"listings": [item]}, headers={"Authorization": "Bearer " + new_supplier_key})["updated"] == 1
        supplier_row.get_by_role("button", name="Eingang pausieren", exact=True).click()
        page.get_by_role("dialog").get_by_role("button", name="Jetzt pausieren", exact=True).click()
        expect(supplier_row.get_by_text("Eingang pausiert", exact=True)).to_be_visible()
        api(owner, "/api/ingest", "POST", {"listings": [item]}, 401, {"Authorization": "Bearer " + new_supplier_key})
        for width in [320, 390, 768, 1440]:
            page.set_viewport_size({"width": width, "height": 1000})
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"Admin source overflow at {width}"
        page.set_viewport_size({"width": 1440, "height": 1000})
        page.locator('section[aria-labelledby="external-sources-title"]').screenshot(path=str(OUTPUT / "e2e-external-sources.png"))
        check("supplier creation, key rotation and revocation work in the browser with responsive admin layout")

        work.reload(); ready(work)
        work.screenshot(path=str(OUTPUT / "e2e-workspace-desktop.png"), full_page=True)
        for width in [320, 390, 743, 768, 900, 1024, 1440, 1920]:
            work.set_viewport_size({"width": width, "height": 1000})
            assert work.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"Overflow at {width}"
            work.wait_for_function("""() => {
                const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
                const card = document.querySelector('.listing-card').getBoundingClientRect();
                return innerWidth <= 900 ? sidebar.right <= 1 : card.left >= sidebar.right;
            }""")
            if width == 390:
                work.get_by_role("button", name="Navigation öffnen").click()
                expect(work.get_by_role("navigation", name="Hauptnavigation")).to_be_visible()
                work.get_by_role("button", name="Navigation schließen", exact=True).last.click()
                work.screenshot(path=str(OUTPUT / "e2e-workspace-mobile.png"), full_page=True, animations="disabled")
        work.set_viewport_size({"width": 1440, "height": 1000})
        work.get_by_role("button", name="Daten importieren", exact=True).click()
        expect(work.get_by_role("dialog")).to_be_visible()
        work.keyboard.press("Escape")
        expect(work.get_by_role("dialog")).to_have_count(0)
        check("responsive layouts at eight widths without sidebar overlap, mobile menu and keyboard dialog dismissal")

        for label, heading in [("Eingang", "Neue Fahrzeuge"), ("Aufgaben", "Aufgaben"), ("Suchaufträge", "Suchaufträge"), ("Merkliste & Ankauf", "Merkliste & Ankauf"), ("Aktivitäten", "Aktivitäten"), ("Team & Zugang", "Team & Zugang"), ("Hilfe & Start", "So funktioniert Autoraum")]:
            work.get_by_role("navigation").get_by_role("button", name=label).click()
            expect(work.get_by_role("heading", name=heading, exact=True)).to_be_visible()
        check("all workspace sections render and remain navigable")
        beta_id = other["id"]
        api(admin, "/api/admin/tenants/" + beta_id, "PATCH", {"active": False})
        api(beta, "/api/w/test-autohaus-beta/workspace", status=401)
        check("pausing a company immediately revokes its active sessions")
        assert not errors, f"Browser JavaScript errors: {errors}"
        check("no browser JavaScript errors")
        browser.close()
    (OUTPUT / "e2e-report.json").write_text(json.dumps({"status": "passed", "checks": checks, "count": len(checks)}, ensure_ascii=False, indent=2))
    print(f"{len(checks)} end-to-end checks passed", flush=True)
finally:
    os.killpg(server.pid, signal.SIGTERM)
    server.wait(timeout=10)
    log.close()
    for suffix in ["", "-wal", "-shm"]:
        Path(str(db_path) + suffix).unlink(missing_ok=True)
