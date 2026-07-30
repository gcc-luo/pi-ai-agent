import json
import shutil
import tempfile
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright


API = "http://127.0.0.1:8080/api"
WEB = "http://127.0.0.1:3000"


def request(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        API + path,
        data=data,
        method=method,
        headers={"content-type": "application/json"} if data else {},
    )
    with urllib.request.urlopen(req) as response:
        content = response.read()
        return json.loads(content) if content else {}


workdir = Path(tempfile.mkdtemp(prefix="pi-browser-e2e-workdir-"))
try:
    project = request("POST", "/projects", {
        "name": "Browser E2E",
        "workdir": str(workdir),
    })
    session = request("POST", f"/projects/{project['id']}/sessions", {})

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(WEB)
        page.wait_for_load_state("networkidle")

        toggle = page.locator("[data-test='browser-capability-toggle']")
        toggle.wait_for(state="visible")
        assert "enabled" not in (toggle.get_attribute("class") or "")

        toggle.click()
        page.wait_for_function(
            """() => document.querySelector(
              "[data-test='browser-capability-toggle']"
            )?.classList.contains("running")""",
        )

        enabled = request("GET", f"/sessions/{session['id']}/browser")
        assert enabled["enabled"] is True
        assert enabled["status"] == "running"
        assert enabled["pageCount"] == 1

        page.reload()
        page.wait_for_load_state("networkidle")
        toggle = page.locator("[data-test='browser-capability-toggle']")
        page.wait_for_function(
            """() => document.querySelector(
              "[data-test='browser-capability-toggle']"
            )?.classList.contains("running")""",
        )

        toggle.click()
        page.wait_for_function(
            """() => !document.querySelector(
              "[data-test='browser-capability-toggle']"
            )?.classList.contains("enabled")""",
        )
        disabled = request("GET", f"/sessions/{session['id']}/browser")
        assert disabled["enabled"] is False
        assert disabled["status"] == "disabled"
        assert disabled["pageCount"] == 0
        browser.close()
finally:
    shutil.rmtree(workdir, ignore_errors=True)
