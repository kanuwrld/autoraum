"""Acceptance scenarios for the purchasing workflow, using the isolated E2E database.

Native Notification is instrumented; this verifies permission flow and dispatch,
not delivery by the operating system. The inbox, requests and persistence are real.
"""
from playwright.sync_api import expect


def verify_workflows(work, owner, buyer, beta, api, check, base, output, listing_id, search_id):
    prefix = "/api/w/test-autohaus-alpha"
    work.add_init_script("""
        window.__notificationEvents = [];
        window.__permissionRequests = 0;
        class TestNotification {
            static permission = 'default';
            static requestPermission() {
                window.__permissionRequests++;
                TestNotification.permission = 'granted';
                return Promise.resolve('granted');
            }
            constructor(title, options) { window.__notificationEvents.push({ title, ...options }); }
            close() {}
        }
        window.Notification = TestNotification;
    """)
    work.reload()
    work.wait_for_load_state("networkidle")
    work.get_by_role("navigation").get_by_role("button", name="Eingang").click()
    expect(work.locator(".inbox-entry")).to_have_count(1)
    assert work.evaluate("window.__permissionRequests") == 0
    work.get_by_role("button", name="Browserhinweise aktivieren", exact=True).click()
    expect(work.get_by_role("button", name="Browserhinweise ausschalten", exact=True)).to_be_visible()
    assert work.evaluate("window.__permissionRequests") == 1
    # A new real database listing enters a saved search. Only the external source data is a fixture.
    api(owner, prefix + "/listing", "POST", {"externalId": "TEST-INBOX-NEW", "source": "csv", "url": "https://fixtures.example.test/inbox-new", "title": "TEST New inbox vehicle", "make": "BMW", "model": "320d", "price": 19000})
    search_result = api(owner, prefix + "/search", "POST", {"searchId": search_id})
    assert search_result["newMatches"] == 1
    expect(work.locator(".notification-toast")).to_be_visible(timeout=22000)
    expect(work.locator(".inbox-entry")).to_have_count(2)
    assert len(work.evaluate("window.__notificationEvents")) == 1
    assert api(owner, prefix + "/search", "POST", {"searchId": search_id})["newMatches"] == 0
    with work.expect_response(lambda r: r.url.endswith("/workspace") and r.request.method == "GET"):
        work.evaluate("window.dispatchEvent(new Event('focus'))")
    work.wait_for_load_state("networkidle")
    assert len(work.evaluate("window.__notificationEvents")) == 1
    work.get_by_role("button", name="Hinweis schließen", exact=True).click()
    check("new saved-search matches trigger one in-app notice and opt-in browser dispatch; repeat searches do not notify again")

    entry = work.locator(f'[data-inbox-id="{listing_id}"]')
    entry.get_by_role("button", name="Als gelesen markieren", exact=True).click()
    expect(entry.get_by_text("Gelesen", exact=True)).to_be_visible()
    assert api(owner, prefix + "/workspace")["inbox"]["unread"] == 1
    assert api(buyer, prefix + "/workspace")["inbox"]["unread"] == 2
    api(beta, "/api/w/test-autohaus-beta/inbox/" + listing_id, "PATCH", {"read": True}, 404)
    work.get_by_role("button", name="Alle Eingänge als gelesen", exact=True).click()
    expect(work.get_by_role("button", name="Eingang öffnen, 0 ungelesen", exact=True)).to_be_visible()
    work.reload(); work.wait_for_load_state("networkidle")
    work.get_by_role("navigation").get_by_role("button", name="Eingang").click()
    work.get_by_label("Eingang filtern", exact=True).select_option("read")
    expect(work.locator(".inbox-entry")).to_have_count(2)
    assert api(buyer, prefix + "/workspace")["inbox"]["unread"] == 2
    check("inbox read state survives reload, stays personal and blocks cross-company changes")

    workspace = api(owner, prefix + "/workspace")
    buyer_id = api(buyer, prefix + "/workspace")["user"]["id"]
    beta_id = api(beta, "/api/w/test-autohaus-beta/workspace")["user"]["id"]
    assert all("email" not in member for member in workspace["members"])
    work.get_by_role("button", name="TEST BMW 320d: Aufgabe erstellen", exact=True).click()
    dialog = work.get_by_role("dialog")
    dialog.get_by_label("Nächste Aktion", exact=True).fill("TEST Verkäufer anrufen")
    dialog.get_by_label("Verantwortlich", exact=True).select_option(buyer_id)
    dialog.get_by_label("Fällig am", exact=True).fill("2020-01-01")
    dialog.get_by_label("Aufgabennotizen", exact=True).fill("TEST: Serviceheft und Besichtigung klären")
    dialog.get_by_role("button", name="Aufgabe speichern", exact=True).click()
    expect(dialog).to_have_count(0)
    task = api(owner, prefix + "/tasks")["tasks"][0]
    assert task["listing_id"] == listing_id and task["assignee_id"] == buyer_id
    assert api(buyer, prefix + "/tasks?filter=mine")["total"] == 1
    api(owner, prefix + "/tasks", "POST", {"title": "TEST Foreign", "assigneeId": beta_id, "dueDate": "2026-11-11"}, 400)
    api(beta, "/api/w/test-autohaus-beta/tasks/" + task["id"], "PATCH", {"version": 1, "status": "done"}, 404)
    api(owner, prefix + "/tasks/" + task["id"], "PATCH", {"version": 1, "status": "done"}, 403, {"Origin": "https://foreign.example.test"})
    work.get_by_role("navigation").get_by_role("button", name="Aufgaben").click()
    row = work.locator(f'[data-task-id="{task["id"]}"]')
    expect(row.get_by_text("TEST Buyer", exact=True)).to_be_visible()
    expect(row.get_by_text("Überfällig", exact=True)).to_be_visible()
    work.get_by_label("Aufgaben filtern", exact=True).select_option("mine")
    expect(work.locator(".task-row")).to_have_count(0)
    work.get_by_label("Aufgaben filtern", exact=True).select_option("overdue")
    expect(row).to_be_visible()
    row.get_by_role("button", name="TEST Verkäufer anrufen: erledigen", exact=True).click()
    expect(row).to_have_count(0)
    work.get_by_label("Aufgaben filtern", exact=True).select_option("done")
    expect(row).to_be_visible()
    row.get_by_role("button", name="TEST Verkäufer anrufen: wieder öffnen", exact=True).click()
    expect(row).to_have_count(0)
    work.get_by_label("Aufgaben filtern", exact=True).select_option("open")
    expect(row).to_be_visible()
    check("vehicle tasks assign to active colleagues, enforce tenant/Origin checks and support overdue, mine, completion and reopening")

    row.get_by_role("button", name="TEST Verkäufer anrufen: bearbeiten", exact=True).click()
    dialog = work.get_by_role("dialog")
    current = api(owner, prefix + "/tasks")["tasks"][0]
    newer = {"title": "TEST Rückruf durch Kollegen geplant", "notes": current["notes"], "assigneeId": buyer_id, "listingId": listing_id, "dueDate": current["due_date"], "version": current["version"]}
    api(buyer, prefix + "/tasks/" + task["id"], "PUT", newer)
    dialog.get_by_label("Nächste Aktion", exact=True).fill("TEST Stale edit must fail")
    dialog.get_by_role("button", name="Aufgabe speichern", exact=True).click()
    expect(dialog.get_by_role("alert")).to_contain_text("inzwischen geändert")
    assert api(owner, prefix + "/tasks")["tasks"][0]["title"] == newer["title"]
    work.keyboard.press("Escape")
    work.get_by_role("button", name="Aufgaben aktualisieren", exact=True).click()
    expect(row.get_by_text(newer["title"], exact=True)).to_be_visible()
    work.screenshot(path=str(output / "e2e-tasks-desktop.png"), full_page=True)
    for width in [320, 390, 768, 1440]:
        work.set_viewport_size({"width": width, "height": 1000})
        work.wait_for_function("""() => innerWidth > 900 || document.querySelector('.sidebar').getBoundingClientRect().right <= 1""")
        assert work.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Task overflow {width}"
    check("stale task edits show a conflict and preserve the colleague's update; task layout fits mobile and desktop")

    row.get_by_role("button", name="TEST BMW 320d", exact=True).click()
    dialog = work.get_by_role("dialog")
    dialog.get_by_label("Geplanter Einkauf (€)", exact=True).fill("16000")
    dialog.get_by_label("Weitere Kosten (€)", exact=True).fill("0")
    dialog.get_by_label("Geplanter Verkauf (€)", exact=True).fill("20000")
    for label, value in [("Transport (€)", "400"), ("Reparaturen (€)", "1000"), ("Aufbereitung (€)", "300"), ("Gebühren (€)", "300"), ("Reserve (€)", "500")]:
        dialog.get_by_label(label, exact=True).fill(value)
    expect(dialog.locator(".purchase-limit")).to_contain_text("1 Betrag fehlt")
    expect(dialog.locator(".purchase-limit strong")).to_have_text("—")
    dialog.get_by_label("Gewünschter Überschuss (€)", exact=True).fill("2000")
    expect(dialog.locator(".purchase-limit strong")).to_have_text("15.500 €")
    dialog.get_by_role("button", name="Änderungen speichern", exact=True).click()
    expect(dialog).to_have_count(0)
    stored = api(owner, prefix + "/listing/" + listing_id)
    assert stored["purchasePlan"]["repairs_cents"] == 100000 and stored["costs_cents"] == 0
    work.reload(); work.wait_for_load_state("networkidle")
    work.get_by_role("button", name="TEST BMW 320d bearbeiten", exact=True).click()
    dialog = work.get_by_role("dialog")
    expect(dialog.locator(".purchase-limit strong")).to_have_text("15.500 €")
    expect(dialog.get_by_label("Transport (€)", exact=True)).to_have_value("400")
    dialog.locator(".purchase-limit").scroll_into_view_if_needed()
    work.screenshot(path=str(output / "e2e-purchase-plan.png"))
    for width in [320, 390, 768, 1440]:
        work.set_viewport_size({"width": width, "height": 1000})
        work.wait_for_function("""() => innerWidth > 900 || document.querySelector('.sidebar').getBoundingClientRect().right <= 1""")
        assert work.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Calculator overflow {width}"
        assert dialog.evaluate("el => el.scrollWidth <= el.clientWidth + 1"), f"Calculator dialog overflow {width}"
        bounds = dialog.bounding_box()
        assert bounds["x"] >= -1 and bounds["x"] + bounds["width"] <= width + 1, f"Calculator outside viewport: {bounds}"
        if width == 390:
            dialog.locator(".purchase-limit").scroll_into_view_if_needed()
            work.screenshot(path=str(output / "e2e-purchase-mobile.png"), animations="disabled")
    work.keyboard.press("Escape")
    check("itemized purchase ceiling is explicit about missing costs, survives reload and fits mobile dialogs")

    work.get_by_role("navigation").get_by_role("button", name="Eingang").click()
    expect(work.locator(".inbox-entry")).to_have_count(2)
    work.screenshot(path=str(output / "e2e-inbox-desktop.png"), full_page=True)
    for width in [320, 390, 768, 1440]:
        work.set_viewport_size({"width": width, "height": 1000})
        work.wait_for_function("""() => innerWidth > 900 || document.querySelector('.sidebar').getBoundingClientRect().right <= 1""")
        assert work.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Inbox overflow {width}"
        if width == 390:
            work.screenshot(path=str(output / "e2e-inbox-mobile.png"), full_page=True, animations="disabled")
    # Permission denial and unavailable browsers leave the real in-app inbox usable.
    work.evaluate("Notification.permission = 'denied'")
    work.get_by_role("navigation").get_by_role("button", name="Aufgaben").click()
    work.get_by_role("navigation").get_by_role("button", name="Eingang").click()
    expect(work.get_by_text("Browserhinweise sind blockiert.", exact=False)).to_be_visible()
    expect(work.get_by_role("button", name="Browserhinweise aktivieren", exact=True)).to_be_disabled()
    work.evaluate("delete window.Notification")
    work.get_by_role("navigation").get_by_role("button", name="Aufgaben").click()
    work.get_by_role("navigation").get_by_role("button", name="Eingang").click()
    expect(work.get_by_text("Dieser Browser unterstützt keine Desktop-Hinweise.", exact=False)).to_be_visible()
    expect(work.locator(".inbox-entry")).to_have_count(2)
    check("inbox is responsive and remains usable when native notification permission is denied or unsupported")
