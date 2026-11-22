"""Tabs syncing between two browsers. Usage: tabs_sync_e2e.py <app_url> <sync_url> <out>"""
import sys, os, time
from playwright.sync_api import sync_playwright

APP, SYNC, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond))); print(("PASS " if cond else "FAIL ") + name, detail)

def wait_until(fn, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v: return v
        time.sleep(0.25)
    return fn()

TAB_COUNT_JS = """async ([id, name]) => {
  const db = await new Promise((res) => { const r = indexedDB.open('mindboard'); r.onsuccess = () => res(r.result); });
  const s = await new Promise((res) => { const r = db.transaction('scenes').objectStore('scenes').get(id); r.onsuccess = () => res(r.result); });
  db.close();
  const t = (s?.tabs ?? []).find(t => t.name === name && !t.deleted);
  return t ? t.elements.filter(e => !e.isDeleted).length : -1;
}"""
def count(page, pid, name): return page.evaluate(TAB_COUNT_JS, [pid, name])
def strip(page): return page.locator(".mb-tab__label").all_inner_texts()
def active(page): return page.locator(".mb-tab--active .mb-tab__label").inner_text()
def draw(page, key, x1, y1, x2, y2):
    page.keyboard.press(key); page.mouse.move(x1, y1); page.mouse.down(); page.mouse.move(x2, y2, steps=6); page.mouse.up(); page.keyboard.press("Escape")

with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.environ.get("PW_CHANNEL") or None)
    laptop = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
    ipad = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
    errors = []
    for pg in (laptop, ipad): pg.on("pageerror", lambda e: errors.append(str(e)))
    laptop.goto(APP + "/"); ipad.goto(APP + "/")
    laptop.wait_for_selector("[data-testid=sync-status]")

    laptop.get_by_role("button", name="New mindboard").first.click()
    laptop.wait_for_selector(".excalidraw canvas"); laptop.wait_for_timeout(600)
    pid = laptop.url.split("/project/")[1]
    draw(laptop, "r", 500, 300, 650, 400)
    laptop.get_by_role("button", name="Add tab").click(); laptop.wait_for_timeout(700)
    draw(laptop, "o", 500, 300, 650, 400)

    ipad.wait_for_selector("[data-testid=project-card]", timeout=15000)
    ok = wait_until(lambda: count(ipad, pid, "Tab 2") == 1, 15)
    check("new tab and its drawing reach the iPad", ok)
    ipad.locator(".mb-card__title").first.click()
    ipad.wait_for_selector(".excalidraw canvas"); ipad.wait_for_timeout(800)
    check("iPad shows both tabs", strip(ipad) == ["Tab 1", "Tab 2"], str(strip(ipad)))

    # both on Tab 2; laptop draws -> iPad canvas updates live
    ipad.locator(".mb-tab__label", has_text="Tab 2").click(); ipad.wait_for_timeout(700)
    draw(laptop, "d", 800, 300, 900, 400)
    ok = wait_until(lambda: count(ipad, pid, "Tab 2") == 2, 15)
    check("drawing in the same tab appears live on the iPad", ok, str(count(ipad, pid, "Tab 2")))

    # laptop edits Tab 1 while iPad is on Tab 2: iPad's open canvas is untouched, Tab 1 updates in storage
    laptop.locator(".mb-tab__label", has_text="Tab 1").click(); laptop.wait_for_timeout(700)
    draw(laptop, "r", 800, 500, 900, 600)
    ok = wait_until(lambda: count(ipad, pid, "Tab 1") == 2, 15)
    check("edits to another tab sync in the background", ok)
    check("iPad stays on its tab", active(ipad) == "Tab 2")

    # rename on iPad -> laptop strip updates
    ipad.get_by_role("button", name="Options for tab Tab 2").click()
    ipad.get_by_role("menuitem", name="Rename").click()
    ipad.locator(".mb-tab--editing").fill("Research"); ipad.keyboard.press("Enter")
    ok = wait_until(lambda: strip(laptop) == ["Tab 1", "Research"], 15)
    check("tab rename appears on the laptop", ok, str(strip(laptop)))

    # writes settle
    time.sleep(4)
    import json, urllib.request
    w1 = json.load(urllib.request.urlopen(SYNC + "/debug"))["writes"]; time.sleep(5)
    w2 = json.load(urllib.request.urlopen(SYNC + "/debug"))["writes"]
    check("no sync loop with tabs", w1 == w2, f"{w1} -> {w2}")

    # laptop deletes the tab the iPad is looking at
    laptop.locator(".mb-tab__label", has_text="Research").click(); laptop.wait_for_timeout(600)
    laptop.get_by_role("button", name="Options for tab Research").click()
    laptop.get_by_role("menuitem", name="Delete tab").click()
    laptop.get_by_role("alertdialog").get_by_role("button", name="Delete").click()
    ok = wait_until(lambda: strip(ipad) == ["Tab 1"] and active(ipad) == "Tab 1", 15)
    check("deleting the open tab moves the iPad to Tab 1", ok, f"{strip(ipad)}")
    ipad.wait_for_timeout(800)
    check("iPad shows Tab 1's drawing", count(ipad, pid, "Tab 1") == 2)
    ipad.screenshot(path=f"{OUT}/ts-ipad.png")

    # iPad keeps editing afterwards and it syncs back
    draw(ipad, "o", 300, 600, 400, 700)
    ok = wait_until(lambda: count(laptop, pid, "Tab 1") == 3, 15)
    check("editing continues normally after the switch", ok)

    real = [e for e in errors if "workers for subsetting" not in e]
    check("no page errors", not real, "; ".join(real[:3]))
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
