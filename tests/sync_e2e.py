"""Two-device sync test against scripts/dev-sync-server.mjs. Usage: sync_e2e.py <app_url> <sync_url> <out>"""
import sys, os, json, time, base64, urllib.request
from playwright.sync_api import sync_playwright

APP, SYNC, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond))); print(("PASS " if cond else "FAIL ") + name, detail)

def server():
    return json.load(urllib.request.urlopen(SYNC + "/debug"))

def live_count(page, pid):
    return page.evaluate("""async (id) => {
      const db = await new Promise((res) => { const r = indexedDB.open('mindboard'); r.onsuccess=()=>res(r.result); });
      const s = await new Promise((res) => { const r = db.transaction('scenes').objectStore('scenes').get(id); r.onsuccess=()=>res(r.result); });
      db.close(); return s ? s.elements.filter(e => !e.isDeleted).length : -1; }""", pid)

def wait_until(fn, timeout=15, interval=0.25):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = fn()
        if last: return last
        time.sleep(interval)
    return last

def draw(page, tool, x1, y1, x2, y2):
    page.keyboard.press(tool)
    page.mouse.move(x1, y1); page.mouse.down(); page.mouse.move(x2, y2, steps=8); page.mouse.up()
    page.keyboard.press("Escape")

with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.environ.get("PW_CHANNEL") or None)
    # Two isolated contexts = two devices with separate IndexedDB.
    laptop = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
    ipad = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
    errors = []
    for pg in (laptop, ipad):
        pg.on("pageerror", lambda e: errors.append(str(e)))

    laptop.goto(APP + "/"); ipad.goto(APP + "/")
    laptop.wait_for_selector("[data-testid=sync-status]", timeout=10000)
    check("signed-in sync status shown", "Synced" in wait_until(lambda: laptop.inner_text("[data-testid=sync-status]") if "Synced" in laptop.inner_text("[data-testid=sync-status]") else None, 10) or "")

    # 1. Create + draw on laptop -> appears on iPad dashboard
    laptop.get_by_role("button", name="New mind map").first.click()
    laptop.wait_for_url("**/project/*"); laptop.wait_for_selector(".excalidraw canvas"); laptop.wait_for_timeout(800)
    pid = laptop.url.split("/project/")[1]
    draw(laptop, "r", 500, 300, 700, 420)
    laptop.locator(".mb-name-button").click(); laptop.locator(".mb-name-input").fill("Shared map"); laptop.keyboard.press("Enter")
    ok = wait_until(lambda: any(pr["id"] == pid and pr["name"] == "Shared map" and len(pr["elements"]) == 1 for pr in server()["projects"]))
    check("laptop project reaches cloud", ok)
    ok = wait_until(lambda: ipad.locator(".mb-card__title", has_text="Shared map").count() == 1)
    check("appears on iPad dashboard live", ok)
    ok = wait_until(lambda: ipad.locator(".mb-card__preview img").count() == 1)
    check("iPad generates thumbnail for synced project", ok)
    ipad.screenshot(path=f"{OUT}/s1-ipad-dashboard.png")

    # 2. Both open; laptop draws -> iPad canvas updates live
    ipad.locator(".mb-card__title", has_text="Shared map").click()
    ipad.wait_for_selector(".excalidraw canvas"); ipad.wait_for_timeout(800)
    check("iPad opens synced drawing", live_count(ipad, pid) == 1)
    draw(laptop, "o", 800, 300, 950, 420)
    ok = wait_until(lambda: live_count(ipad, pid) == 2)
    check("laptop edit appears in open iPad editor", ok, f"ipad={live_count(ipad, pid)}")
    ipad.wait_for_timeout(500)
    ipad.screenshot(path=f"{OUT}/s2-ipad-live.png")

    # 3. iPad draws -> laptop updates
    draw(ipad, "r", 500, 550, 650, 650)
    ok = wait_until(lambda: live_count(laptop, pid) == 3)
    check("iPad edit appears on laptop", ok, f"laptop={live_count(laptop, pid)}")

    # 4. Concurrent edits on both
    draw(laptop, "d", 300, 600, 400, 700)
    draw(ipad, "d", 1000, 600, 1100, 700)
    ok = wait_until(lambda: live_count(laptop, pid) == 5 and live_count(ipad, pid) == 5, 20)
    check("concurrent edits merge on both devices", ok, f"laptop={live_count(laptop, pid)} ipad={live_count(ipad, pid)}")

    # 5. No ping-pong: writes settle
    time.sleep(4); w1 = server()["writes"]; time.sleep(5); w2 = server()["writes"]
    check("no sync loop (writes settle)", w1 == w2, f"{w1} -> {w2}")

    # 6. Delete a shape on iPad -> gone on laptop
    ipad.keyboard.press("Control+a"); ipad.keyboard.press("Delete")
    ok = wait_until(lambda: live_count(laptop, pid) == 0, 15)
    check("delete-all on iPad syncs to laptop", ok, f"laptop={live_count(laptop, pid)}")
    ipad.keyboard.press("Control+z")
    ok = wait_until(lambda: live_count(laptop, pid) == 5, 15)
    check("undo on iPad restores on laptop", ok, f"laptop={live_count(laptop, pid)}")

    # 7. Image on laptop -> iPad gets file
    png = os.path.join(OUT, "img.png"); laptop.screenshot(path=png, clip={"x": 0, "y": 0, "width": 100, "height": 60})
    data = base64.b64encode(open(png, "rb").read()).decode()
    laptop.evaluate("""async (b64) => {
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const file = new File([bin], 'img.png', {type: 'image/png'});
      const dt = new DataTransfer(); dt.items.add(file);
      const t = document.querySelector('.excalidraw .excalidraw__canvas.interactive') || document.querySelector('.excalidraw canvas');
      for (const type of ['dragover','drop']) t.dispatchEvent(new DragEvent(type, {dataTransfer: dt, bubbles: true, cancelable: true, clientX: 300, clientY: 250}));
    }""", data)
    ok = wait_until(lambda: len(server()["files"]) == 1, 15)
    check("image uploaded to cloud", ok, str(server()["files"]))
    ok = wait_until(lambda: ipad.evaluate("""async (id) => {
      const db = await new Promise((res) => { const r = indexedDB.open('mindboard'); r.onsuccess=()=>res(r.result); });
      const n = await new Promise((res) => { const r = db.transaction('files').objectStore('files').index('byProject').count(id); r.onsuccess=()=>res(r.result); });
      db.close(); return n === 1; }""", pid), 15)
    check("image downloaded on iPad", ok)
    ipad.wait_for_timeout(1000)
    ipad.screenshot(path=f"{OUT}/s3-ipad-image.png")

    # 8. Rename on iPad dashboard -> laptop header updates
    ipad.get_by_role("link", name="Projects").click(); ipad.wait_for_selector("[data-testid=project-card]")
    ipad.get_by_role("button", name="More options for Shared map").click()
    ipad.get_by_role("menuitem", name="Rename").click()
    ipad.locator(".mb-card__rename").fill("Renamed on iPad"); ipad.keyboard.press("Enter")
    ok = wait_until(lambda: "Renamed on iPad" in laptop.inner_text(".mb-editor-header"), 15)
    check("rename reaches open laptop editor", ok)

    # 9. Persisted after reload on both
    laptop.reload(); laptop.wait_for_selector(".excalidraw canvas"); laptop.wait_for_timeout(1500)
    check("laptop state after reload", live_count(laptop, pid) == 6, f"{live_count(laptop, pid)}")

    # 10. Delete project on iPad -> laptop editor kicked to dashboard, project gone
    ipad.get_by_role("button", name="More options for Renamed on iPad").click()
    ipad.get_by_role("menuitem", name="Delete").click()
    ipad.get_by_role("alertdialog").get_by_role("button", name="Delete").click()
    ok = wait_until(lambda: laptop.evaluate("location.pathname") == "/" and laptop.locator("[data-testid=project-card]").count() == 0, 15)
    check("project delete syncs and closes laptop editor", ok, laptop.url)
    check("cloud project marked deleted", any(pr["id"] == pid and pr["deleted"] for pr in server()["projects"]))
    check("cloud images removed", server()["files"] == [])

    # 11. Offline then online
    ctx = laptop.context
    ctx.set_offline(True)
    laptop.get_by_role("button", name="New mind map").first.click()
    laptop.wait_for_selector(".excalidraw canvas"); laptop.wait_for_timeout(500)
    pid2 = laptop.url.split("/project/")[1]
    draw(laptop, "r", 500, 300, 600, 400)
    laptop.wait_for_timeout(2500)
    check("offline edit not in cloud yet", not any(pr["id"] == pid2 for pr in server()["projects"]))
    ctx.set_offline(False)
    ok = wait_until(lambda: any(pr["id"] == pid2 and len(pr["elements"]) == 1 for pr in server()["projects"]), 20)
    check("offline edit uploads after reconnect", ok)
    laptop.screenshot(path=f"{OUT}/s4-laptop.png")

    # 12. Sign out UI
    laptop.get_by_role("link", name="Projects").click()
    laptop.locator("[data-testid=sync-status]").click()
    laptop.screenshot(path=f"{OUT}/s5-account-menu.png")
    laptop.get_by_role("menuitem", name="Sign out").click()
    ok = wait_until(lambda: laptop.get_by_role("button", name="Sign in to sync").count() == 1, 5)
    check("sign out shows sign-in button", ok)
    check("local projects kept after sign out", laptop.locator("[data-testid=project-card]").count() == 1)

    real = [e for e in errors if "workers for subsetting" not in e]
    check("no page errors", not real, "; ".join(real[:3]))
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results)-len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
