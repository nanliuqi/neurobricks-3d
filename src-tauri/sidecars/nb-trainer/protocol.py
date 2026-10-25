"""Thread-safe JSON-lines protocol shared by the trainer entry point and workers."""

import json
import threading
import time


_stdout_lock = threading.Lock()
_heartbeat_lease_lock = threading.Lock()
_heartbeat_lease_deadline = 0.0


class TrainerError(Exception):
    """Expected protocol failure with a stable machine-readable code."""

    def __init__(self, error_code, message, details=None):
        super().__init__(message)
        self.error_code = str(error_code)
        self.details = details if isinstance(details, dict) else {}


def renew_heartbeat(lease_seconds=180.0):
    """Allow background heartbeats only while the main training thread is making progress."""
    global _heartbeat_lease_deadline
    with _heartbeat_lease_lock:
        _heartbeat_lease_deadline = time.monotonic() + lease_seconds


def _heartbeat_lease_is_active():
    with _heartbeat_lease_lock:
        return time.monotonic() < _heartbeat_lease_deadline


def log_message(msg_type, **kwargs):
    """Write exactly one UTF-8 JSON object per stdout line."""
    # 真实业务消息证明主训练线程向前推进；后台 heartbeat 自身不能无限续租，
    # 否则计算线程死锁时看门狗永远无法触发。
    if msg_type != "heartbeat":
        renew_heartbeat()
    message = {"type": msg_type, **kwargs}
    encoded = json.dumps(message)
    with _stdout_lock:
        print(encoded, flush=True)


def start_heartbeat(interval_seconds=5.0):
    """Keep the Rust watchdog informed during imports, data loading, eval and saves."""
    stop_event = threading.Event()
    renew_heartbeat()

    def heartbeat_loop():
        while not stop_event.wait(interval_seconds):
            if _heartbeat_lease_is_active():
                log_message("heartbeat")

    thread = threading.Thread(target=heartbeat_loop, name="nb-protocol-heartbeat", daemon=True)
    thread.start()
    return stop_event, thread


def stop_heartbeat(handle):
    """Stop and briefly join a heartbeat returned by start_heartbeat."""
    if handle is None:
        return
    stop_event, thread = handle
    stop_event.set()
    thread.join(timeout=1.0)
