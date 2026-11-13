"""Run the same core contract suite against a disposable real PostgreSQL instance."""
import os
from pathlib import Path
import secrets
import subprocess
import time
import uuid

root = Path(__file__).resolve().parents[1]
name = "autoraum-test-" + uuid.uuid4().hex[:12]
password = secrets.token_urlsafe(24)
env = {**os.environ, "POSTGRES_PASSWORD": password}
subprocess.run(["docker", "run", "--rm", "-d", "--name", name, "-e", "POSTGRES_PASSWORD",
                "-e", "POSTGRES_DB=autoraum_test", "-p", "127.0.0.1::5432", "postgres:17-alpine"],
               env=env, check=True, stdout=subprocess.DEVNULL)
try:
    for _ in range(60):
        r = subprocess.run(["docker", "exec", name, "pg_isready", "-U", "postgres"], capture_output=True)
        if r.returncode == 0:
            break
        time.sleep(.5)
    else:
        raise RuntimeError("PostgreSQL did not become ready")
    port = subprocess.check_output(["docker", "port", name, "5432"], text=True).strip().split(":")[-1]
    env["TEST_DATABASE_URL"] = f"postgresql://postgres:{password}@127.0.0.1:{port}/autoraum_test"
    subprocess.run(["npm", "test"], cwd=root, env=env, check=True)
finally:
    subprocess.run(["docker", "stop", name], stdout=subprocess.DEVNULL, check=True)
