"""Owner access lifecycle, export and operator status against an isolated app."""
import json
from playwright.sync_api import expect


def verify_operations(work, owner, buyer, beta, admin, api, check, base, output, password):
    prefix = '/api/w/test-autohaus-alpha'
    members = api(owner, prefix + '/team')
    member = next(m for m in members if m['role'] == 'buyer')
    api(buyer, prefix + '/team/' + member['id'] + '/recover', 'POST', {}, 403)
    api(beta, prefix + '/team/' + member['id'], 'PATCH', {'blocked': True}, 404)
    api(owner, '/api/admin/operations', status=403)
    report = api(admin, '/api/admin/operations')
    assert report['database'] == 'SQLite'
    assert not report['backup']['healthy']
    assert 'password' not in json.dumps(report)

    work.get_by_role('navigation').get_by_role('button', name='Team & Zugang', exact=True).click()
    work.get_by_role('button', name='Zugangslink für ' + member['name'], exact=True).click()
    work.get_by_role('dialog').get_by_role('button', name='Zugangslink erstellen', exact=True).click()
    invite = work.get_by_role('dialog').get_by_label('Link zum Kopieren')
    expect(invite).to_be_visible()
    first = invite.input_value()
    work.keyboard.press('Escape')
    second = api(owner, prefix + '/team/' + member['id'] + '/recover', 'POST', {})['invitationUrl']
    api(buyer, '/api/auth/activate', 'POST', {'token': first.split('#')[1], 'password': password}, 400)
    new_password = password + '-changed'
    api(buyer, '/api/auth/activate', 'POST', {'token': second.split('#')[1], 'password': new_password})
    api(buyer, '/api/auth/activate', 'POST', {'token': second.split('#')[1], 'password': new_password}, 400)
    api(buyer, '/api/auth/login', 'POST', {'email': member['email'], 'password': password}, 401)
    check('owner recovery links rotate, work once and change the password without email services')

    unused = api(owner, prefix + '/team/' + member['id'] + '/recover', 'POST', {})['invitationUrl']
    work.get_by_role('button', name=member['name'] + ': Sperren', exact=True).click()
    work.get_by_role('dialog').get_by_role('button', name='Zugang sperren', exact=True).click()
    expect(work.get_by_role('dialog')).to_have_count(0)
    expect(work.get_by_text('Gesperrt', exact=True)).to_be_visible()
    api(buyer, prefix + '/workspace', status=401)
    api(buyer, '/api/auth/login', 'POST', {'email': member['email'], 'password': new_password}, 401)
    api(buyer, '/api/auth/activate', 'POST', {'token': unused.split('#')[1], 'password': password}, 400)
    assert not any(m['id'] == member['id'] for m in api(owner, prefix + '/workspace')['members'])
    work.get_by_role('button', name=member['name'] + ': Freigeben', exact=True).click()
    work.get_by_role('dialog').get_by_role('button', name='Zugang freigeben', exact=True).click()
    expect(work.get_by_role('dialog')).to_have_count(0)
    api(buyer, '/api/auth/login', 'POST', {'email': member['email'], 'password': new_password})
    api(buyer, prefix + '/workspace')
    check('suspension revokes active sessions and old links; reactivation restores login without deleting work')

    api(buyer, prefix + '/export', status=403)
    api(beta, prefix + '/export', status=404)
    with work.expect_download() as download_info:
        work.get_by_role('link', name='Arbeitsdaten exportieren').click()
    download = download_info.value
    export = json.loads(open(download.path(), encoding='utf-8').read())
    assert export['company']['slug'] == 'test-autohaus-alpha'
    assert export['searches'] and export['shortlist'] and export['tasks']
    assert all(s not in json.dumps(export) for s in ['password_hash', 'token_hash', 'mobile_credentials'])
    check('owner downloads complete work records without credentials and cross-company access')

    for width in [320, 390, 768, 1440]:
        work.set_viewport_size({'width': width, 'height': 1000})
        expect(work.locator('.team-row').first).to_be_visible()
        assert work.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    work.set_viewport_size({'width': 1440, 'height': 1000})
    work.get_by_role('navigation').get_by_role('button', name='Hilfe & Start', exact=True).click()
    expect(work.get_by_role('heading', name='So funktioniert Autoraum', exact=True)).to_be_visible()
    for summary in work.locator('.help-topics summary').all():
        summary.click()
    assert work.locator('.help-topics details[open]').count() == 9
    for width in [320, 390, 768, 1440]:
        work.set_viewport_size({'width': width, 'height': 1000})
        work.evaluate("window.scrollTo({top: 0, behavior: 'instant'})")
        assert work.evaluate('window.scrollY') == 0
        assert work.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        if width == 390:
            work.screenshot(path=str(output/'e2e-help-mobile.png'), full_page=True, animations='disabled')
    work.screenshot(path=str(output/'e2e-help-desktop.png'), full_page=True, animations='disabled')
    work.get_by_role('button', name='Suchprofil speichern').click()
    expect(work.get_by_role('heading', name='Suchaufträge', exact=True)).to_be_visible()

    panel = admin.new_page()
    panel.goto(base + '/admin')
    panel.wait_for_load_state('networkidle')
    panel.get_by_role('navigation').get_by_role('button', name='Betrieb & Sicherung', exact=True).click()
    expect(panel.get_by_role('heading', name='Datensicherung')).to_be_visible()
    expect(panel.get_by_text('Sicherung prüfen', exact=True)).to_be_visible()
    for width in [320, 390, 768, 1440]:
        panel.set_viewport_size({'width': width, 'height': 1000})
        assert panel.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    panel.screenshot(path=str(output/'e2e-operations-desktop.png'), full_page=True, animations='disabled')
    panel.close()
    check('help explains all workflows and operator status reports missing backups honestly; layouts fit four widths')
    work.get_by_role('navigation').get_by_role('button', name='Fahrzeugrecherche', exact=True).click()
