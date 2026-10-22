"""Observe the owner's user services. No web input and no control operations."""
import json
import os
from pathlib import Path
import subprocess
import time


def probe():
    # Use only the already mounted session bus. systemctl tries the separate
    # private control socket first; that socket deliberately remains unavailable.
    base = ["/usr/bin/busctl", "--address=unix:path=/run/user/1000/bus", "--json=short", "--timeout=2s"]
    result = subprocess.run([*base, "call", "org.freedesktop.systemd1", "/org/freedesktop/systemd1",
                             "org.freedesktop.systemd1.Manager", "ListUnits"],
                            capture_output=True, text=True, timeout=4, check=True)
    units = json.loads(result.stdout)["data"][0]
    units = [u for u in units if len(u) >= 7 and u[0].endswith(".service")][:300]
    services = [{"name": u[0], "description": u[1][:200], "loaded": u[2], "active": u[3],
                 "state": u[4], "uptime": None} for u in units]
    deadline = time.monotonic() + 2.5
    for service, unit in zip(services, units):
        if time.monotonic() >= deadline:
            break
        if service["active"] != "active":
            continue
        try:
            result = subprocess.run([*base, "get-property", "org.freedesktop.systemd1", unit[6],
                                     "org.freedesktop.systemd1.Unit", "ActiveEnterTimestampMonotonic"],
                                    capture_output=True, text=True, timeout=2, check=True)
            value = json.loads(result.stdout)["data"]
            if isinstance(value, list):
                value = value[0]
            if value:
                service["uptime"] = max(0, time.monotonic() - int(value) / 1_000_000)
        except Exception:
            pass
    return {"timestamp": time.time(), "services": services}


def main():
    target = Path(os.environ.get("CANOPY_SERVICES_FILE", "/run/canopy-services/services.json"))
    while True:
        try:
            data = probe()
        except Exception:
            data = {"timestamp": time.time(), "services": [], "error": "User service status could not be collected."}
        temp = target.with_suffix(".tmp")
        temp.write_text(json.dumps(data))
        temp.chmod(0o640)
        temp.replace(target)
        time.sleep(5)


if __name__ == "__main__":
    main()
