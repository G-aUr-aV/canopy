from __future__ import annotations

from collections import deque
import copy
import json
import os
import platform
from pathlib import Path
import threading
import time

import psutil


class Collector:
    def __init__(self):
        self.history = deque(maxlen=1800)
        self.current = None
        self.error = None
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self.run, name="canopy-metrics", daemon=True)
        self.previous_net = None
        self.previous_disk = None
        self.previous_clock = None
        self.seen_processes = set()

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.thread.join(timeout=5)

    def run(self):
        psutil.cpu_percent(percpu=True)
        while not self.stop_event.is_set():
            started = time.monotonic()
            try:
                self.sample()
                self.error = None
            except Exception:
                self.error = "Some system measurements could not be collected. Retrying."
            self.stop_event.wait(max(0.2, 2 - (time.monotonic() - started)))

    def sample(self):
        now = time.time()
        clock = time.monotonic()
        elapsed = clock - self.previous_clock if self.previous_clock is not None else None
        cores = psutil.cpu_percent(percpu=True)
        cpu = round(sum(cores) / max(1, len(cores)), 1) if elapsed else None
        mem = psutil.virtual_memory()
        swap = psutil.swap_memory()
        disks = []
        seen_mounts = set()
        for partition in [None, *psutil.disk_partitions(all=False)]:
            mount = partition.mountpoint if partition else "/"
            if mount in seen_mounts or mount.startswith(("/snap/", "/srv/canopy/", "/proc/", "/sys/", "/run/")):
                continue
            seen_mounts.add(mount)
            try:
                usage = psutil.disk_usage(mount)
                fs = os.statvfs(mount)
                disks.append({"mount": mount, "device": partition.device if partition else "Root volume",
                              "filesystem": partition.fstype if partition else "",
                              "total": usage.total, "used": usage.used, "available": usage.free, "percent": usage.percent,
                              "inodes_total": fs.f_files, "inodes_used": fs.f_files - fs.f_ffree,
                              "inodes_percent": round(100 * (fs.f_files - fs.f_ffree) / fs.f_files, 1) if fs.f_files else None})
            except (OSError, PermissionError):
                continue
        interfaces = []
        network = psutil.net_io_counters(pernic=True)
        for name, counters in network.items():
            if name == "lo":
                continue
            previous = self.previous_net.get(name) if self.previous_net else None
            interfaces.append({"name": name, "received": counters.bytes_recv, "sent": counters.bytes_sent,
                               "rx": max(0, (counters.bytes_recv - previous.bytes_recv) / elapsed) if previous and elapsed else None,
                               "tx": max(0, (counters.bytes_sent - previous.bytes_sent) / elapsed) if previous and elapsed else None,
                               "errors": counters.errin + counters.errout, "drops": counters.dropin + counters.dropout})
        primary = [x for x in interfaces if not x["name"].startswith(("veth", "docker", "br-", "tun", "wg"))]
        rate = lambda key: sum(x[key] for x in primary if x[key] is not None) if elapsed and primary else None
        diskio = psutil.disk_io_counters()
        read_rate = write_rate = None
        if diskio and self.previous_disk and elapsed:
            read_rate = max(0, (diskio.read_bytes - self.previous_disk.read_bytes) / elapsed)
            write_rate = max(0, (diskio.write_bytes - self.previous_disk.write_bytes) / elapsed)
        processes = []
        seen = set()
        for process in psutil.process_iter(["pid", "name", "username", "status", "memory_info", "create_time"]):
            try:
                info = process.info
                identity = (info["pid"], info["create_time"])
                seen.add(identity)
                pcpu = process.cpu_percent()
                rss = info["memory_info"].rss if info["memory_info"] else 0
                processes.append({"pid": info["pid"], "name": info["name"], "user": info["username"],
                                  "status": info["status"], "cpu": pcpu if identity in self.seen_processes else None,
                                  "memory": rss, "memory_percent": round(100 * rss / mem.total, 2)})
            except (psutil.Error, OSError):
                continue
        self.seen_processes = seen
        count = len(processes)
        processes.sort(key=lambda x: (x["cpu"] or 0, x["memory"]), reverse=True)
        snapshot = {"timestamp": now, "hostname": os.getenv("CANOPY_LABEL", platform.node()),
                    "os": platform.freedesktop_os_release().get("PRETTY_NAME", "Linux"),
                    "kernel": platform.release(), "architecture": platform.machine(),
                    "region": os.getenv("CANOPY_REGION", ""), "uptime": now - psutil.boot_time(),
                    "cpu": cpu, "cores": cores if elapsed else [], "logical_cpus": psutil.cpu_count(),
                    "physical_cpus": psutil.cpu_count(logical=False), "load": list(os.getloadavg()),
                    "memory": {"total": mem.total, "used": mem.total - mem.available,
                               "available": mem.available, "percent": mem.percent,
                               "cached": getattr(mem, "cached", 0), "buffers": getattr(mem, "buffers", 0)},
                    "swap": {"total": swap.total, "used": swap.used, "percent": swap.percent},
                    "disks": disks, "interfaces": interfaces, "network": {"rx": rate("rx"), "tx": rate("tx")},
                    "disk_io": {"read": read_rate, "write": write_rate},
                    "processes": processes[:400], "process_count": count, "processes_limited": count > 400}
        point = {"timestamp": now, "cpu": cpu, "memory": mem.percent,
                 "rx": rate("rx"), "tx": rate("tx"), "disk_read": read_rate, "disk_write": write_rate}
        with self.lock:
            self.current = snapshot
            self.history.append(point)
        self.previous_net = network
        self.previous_disk = diskio
        self.previous_clock = clock

    def get(self, minutes=15):
        with self.lock:
            if self.current is None:
                return None
            snapshot = copy.deepcopy(self.current)
            points = [p.copy() for p in self.history if p["timestamp"] >= time.time() - minutes * 60]
        stride = max(1, len(points) // 300)
        snapshot["history"] = points[::stride]
        if points and snapshot["history"][-1] != points[-1]:
            snapshot["history"].append(points[-1])
        snapshot["collection_error"] = self.error
        snapshot["history_seconds"] = int(points[-1]["timestamp"] - points[0]["timestamp"]) if points else 0
        return snapshot


def read_services():
    path = Path(os.getenv("CANOPY_SERVICES_FILE", "/run/canopy-services/services.json"))
    try:
        data = json.loads(path.read_text())
        stale = time.time() - data["timestamp"] > 30
        return {**data, "stale": stale}
    except (OSError, ValueError, KeyError):
        return {"services": [], "timestamp": None, "stale": True,
                "error": "The service observer is unavailable. System metrics are still collecting."}
