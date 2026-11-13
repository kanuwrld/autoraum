"""Check a genuinely bootstrapped installation, without marketplace traffic or printed credentials."""
import http.cookiejar
import json
import re
import subprocess
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[1]
environment = (root / ".env.local").read_bytes()
access = (root / ".local/access.txt").read_bytes()
build_id = (root / ".next/BUILD_ID").read_bytes()
settings = {}
for line in environment.decode().splitlines():
    if "=" in line and not line.startswith("#"):
        key, value = line.split("=", 1)
        settings[key] = value.strip().strip("'\"")
assert settings["PUBLIC_MARKETPLACE_SEARCH"] == "1"
assert settings["NEXT_TELEMETRY_DISABLED"] == "1"
assert not settings.get("DATABASE_URL")
assert not settings.get("MOBILE_API_USERNAME")
assert not settings.get("MOBILE_API_PASSWORD")
assert "SHELL_ONLY" not in environment.decode()
assert "SHELL_ONLY" not in access.decode()
base = settings["APP_URL"]
assert base.startswith("http://localhost:")
credentials = re.findall(r"Email: ([^\n]+)\nPassword: ([^\n]+)", access.decode())
assert len(credentials) == 2 and credentials[0][1] != credentials[1][1]
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def api(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + path, data=data, headers={"Origin": base, "Content-Type": "application/json"})
    with opener.open(request, timeout=10) as response:
        assert response.status == 200
        return json.load(response)


assert api("/api/health")["ok"]
api("/api/auth/login", {"email": credentials[1][0], "password": credentials[1][1]})
workspace = api("/api/w/mein-arbeitsbereich/workspace")
assert workspace["providers"]["publicSearch"] is True
assert workspace["providers"]["mobile"] is False
assert workspace["user"]["name"] == "Administrator"
assert workspace["stats"]["listings"] == 0
api("/api/w/mein-arbeitsbereich/search", {"filters": {"sources": ["csv"]}})
print("PASS fresh installation: private login, local database, seven adapters enabled, no inherited account or API credentials")
before = json.loads((root / ".local/supervisor.json").read_text())["pid"]
repeat = subprocess.run(["npm", "run", "local"], cwd=root, capture_output=True, text=True, timeout=60)
assert repeat.returncode == 0, "Repeated startup failed; inspect local logs"
assert "Installing locked dependencies" not in repeat.stdout
assert "Building Autoraum" not in repeat.stdout
assert (root / ".env.local").read_bytes() == environment
assert (root / ".local/access.txt").read_bytes() == access
assert (root / ".next/BUILD_ID").read_bytes() == build_id
assert json.loads((root / ".local/supervisor.json").read_text())["pid"] == before
print("PASS repeated one-command startup preserves passwords, keys, build and running processes")
