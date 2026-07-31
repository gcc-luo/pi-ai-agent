"""Smoke test for plugin management and per-session plugin selection."""

import json
import os
import re
import shutil
import urllib.request
import atexit
from pathlib import Path

from playwright.sync_api import sync_playwright


API = "http://127.0.0.1:8080/api"
WEB = "http://127.0.0.1:3000"
REPO = Path(__file__).resolve().parents[4]
WORKDIR = REPO / f".tmp-plugin-e2e-workdir-{os.getpid()}"
SCREENSHOT = REPO / ".tmp-plugin-manager.png"


def request(method: str, path: str, payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        API + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    with urllib.request.urlopen(req) as response:
        body = response.read()
        return json.loads(body) if body else None


WORKDIR.mkdir(parents=True, exist_ok=True)
project = request(
    "POST",
    "/projects",
    {"name": f"Plugin E2E {os.getpid()}", "workdir": str(WORKDIR)},
)
session = request("POST", f"/projects/{project['id']}/sessions", {})


def cleanup():
    try:
        request("DELETE", f"/projects/{project['id']}")
        request("POST", "/trash/destroy", {"kind": "project", "id": project["id"]})
    except Exception:
        pass
    if os.environ.get("KEEP_E2E_ARTIFACTS") != "1":
        SCREENSHOT.unlink(missing_ok=True)
        shutil.rmtree(WORKDIR, ignore_errors=True)


atexit.register(cleanup)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)

    page.goto(WEB)
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name=re.compile(r"插件|Plugins")).click()
    page.get_by_text("Browser Use", exact=True).wait_for()
    page.get_by_text("Computer Use", exact=True).wait_for()
    assert page.get_by_text(re.compile(r"内置|Built-in"), exact=True).count() == 2
    assert page.get_by_text(re.compile(r"官方|Official"), exact=True).count() == 2
    page.screenshot(path=str(SCREENSHOT), full_page=True)

    page.get_by_role("button", name=re.compile(r"对话|Chat")).click()
    selector = page.locator("[data-test='session-plugin-select']")
    selector.wait_for()
    selector.click()
    page.get_by_text("🌐 Browser Use", exact=True).click()
    page.wait_for_timeout(400)

    selected = request("GET", f"/sessions/{session['id']}/plugins")
    assert selected["selectedPluginIds"] == ["browser-use"]
    assert not console_errors, console_errors
    browser.close()

print(json.dumps({"ok": True, "screenshot": str(SCREENSHOT)}, ensure_ascii=False))
