"""Tabs and links, in a real browser. Usage: tabs_links_e2e.py <app_url> <out_dir>"""
import sys, os, json, re
from playwright.sync_api import sync_playwright

APP, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond))); print(("PASS " if cond else "FAIL ") + name, detail)

TABS_JS = """async (id) => {
  const db = await new Promise((res) => { const r = indexedDB.open('mindboard'); r.onsuccess = () => res(r.result); });
  const s = await new Promise((res) => { const r = db.transaction('scenes').objectStore('scenes').get(id); r.onsuccess = () => res(r.result); });
  db.close();
  return (s?.tabs ?? []).filter(t => !t.deleted).sort((a, b) => a.order - b.order)
    .map(t => ({ id: t.id, name: t.name, elements: t.elements.filter(e => !e.isDeleted) }));
}"""

def tabs(page, pid): return page.evaluate(TABS_JS, pid)
def tab(page, pid, name): return next((t for t in tabs(page, pid) if t["name"] == name), None)
def strip(page): return page.locator(".mb-tab__label").all_inner_texts()
def active_tab(page): return page.locator(".mb-tab--active .mb-tab__label").inner_text()

def draw(page, key, x1, y1, x2, y2):
    page.keyboard.press(key)
    page.mouse.move(x1, y1); page.mouse.down(); page.mouse.move(x2, y2, steps=6); page.mouse.up()
    page.keyboard.press("Escape")

def type_text(page, x, y, text):
    page.keyboard.press("t"); page.mouse.click(x, y)
    page.keyboard.type(text); page.keyboard.press("Escape")

def wait_saved(page):
    page.wait_for_function("document.querySelector('.mb-save')?.innerText.includes('Saved')", timeout=8000)
    page.wait_for_timeout(300)

with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.environ.get("PW_CHANNEL") or None)
    ctx = browser.new_context(viewport={"width": 1400, "height": 900}, accept_downloads=True)
    # Link targets: answer locally so opened tabs don't need the internet.
    ctx.route(re.compile(r"https://[a-z]+\.example\.(com|org).*"), lambda route: route.fulfill(body="ok"))
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(APP + "/")
    page.get_by_role("button", name="New mindboard").first.click()
    page.wait_for_url("**/project/*"); page.wait_for_selector(".excalidraw canvas"); page.wait_for_timeout(800)
    pid = page.url.split("/project/")[1]
    page.locator(".mb-name-button").click(); page.locator(".mb-name-input").fill("Plan"); page.keyboard.press("Enter")

    # ---------- Tabs ----------
    check("new project has one tab", strip(page) == ["Tab 1"], str(strip(page)))
    draw(page, "r", 500, 300, 700, 420)
    page.get_by_role("button", name="Add tab").click()
    page.wait_for_function("document.querySelectorAll('.mb-tab__label').length === 2")
    page.wait_for_timeout(600)
    check("add tab opens Tab 2", active_tab(page) == "Tab 2" and strip(page) == ["Tab 1", "Tab 2"])
    draw(page, "o", 500, 300, 650, 420)
    draw(page, "o", 800, 300, 950, 420)
    wait_saved(page)
    t = {x["name"]: len(x["elements"]) for x in tabs(page, pid)}
    check("each tab has its own canvas", t == {"Tab 1": 1, "Tab 2": 2}, str(t))

    page.locator(".mb-tab__label", has_text="Tab 1").click(); page.wait_for_timeout(800)
    check("switch back to Tab 1", active_tab(page) == "Tab 1")
    page.screenshot(path=f"{OUT}/t1-tab1.png")

    # rename by double-click
    page.locator(".mb-tab__label", has_text="Tab 2").dblclick()
    page.wait_for_timeout(300)
    if page.locator(".mb-tab--editing").count() == 0:
        # first click switched tabs; double-click again on the now-active tab
        page.locator(".mb-tab__label", has_text="Tab 2").dblclick()
    page.locator(".mb-tab--editing").fill("Ideas"); page.keyboard.press("Enter")
    page.wait_for_timeout(400)
    check("rename tab", "Ideas" in strip(page), str(strip(page)))

    # remembered tab + persistence across reload
    page.locator(".mb-tab__label", has_text="Tab 1").click(); page.wait_for_timeout(600)
    page.reload(); page.wait_for_selector(".excalidraw canvas"); page.wait_for_timeout(800)
    check("tabs persist after reload", strip(page) == ["Tab 1", "Ideas"], str(strip(page)))
    check("reopens the last tab you used", active_tab(page) == "Tab 1")

    # duplicate, move, delete via tab menu
    page.locator(".mb-tab__label", has_text="Ideas").click(); page.wait_for_timeout(700)
    page.get_by_role("button", name="Options for tab Ideas").click()
    page.get_by_role("menuitem", name="Duplicate").click()
    page.wait_for_function("document.querySelectorAll('.mb-tab__label').length === 3"); page.wait_for_timeout(700)
    check("duplicate tab", strip(page) == ["Tab 1", "Ideas", "Ideas (copy)"] and active_tab(page) == "Ideas (copy)", str(strip(page)))
    wait_saved(page)
    check("duplicate has the content", len(tab(page, pid, "Ideas (copy)")["elements"]) == 2)
    page.get_by_role("button", name="Options for tab Ideas (copy)").click()
    page.get_by_role("menuitem", name="Move left").click(); page.wait_for_timeout(400)
    check("move tab left", strip(page) == ["Tab 1", "Ideas (copy)", "Ideas"], str(strip(page)))
    page.get_by_role("button", name="Options for tab Ideas (copy)").click()
    page.get_by_role("menuitem", name="Delete tab").click()
    page.get_by_role("alertdialog").get_by_role("button", name="Delete").click()
    page.wait_for_function("document.querySelectorAll('.mb-tab__label').length === 2"); page.wait_for_timeout(600)
    check("delete tab (with confirm) and land on neighbour", strip(page) == ["Tab 1", "Ideas"] and active_tab(page) == "Tab 1", f"{strip(page)} active={active_tab(page)}")

    # an empty tab deletes without a dialog
    page.get_by_role("button", name="Add tab").click(); page.wait_for_timeout(700)
    page.get_by_role("button", name="Options for tab Tab 3").click()
    page.get_by_role("menuitem", name="Delete tab").click(); page.wait_for_timeout(600)
    check("empty tab deletes without confirm", page.get_by_role("alertdialog").count() == 0 and strip(page) == ["Tab 1", "Ideas"])
    check("…and lands on its neighbour", active_tab(page) == "Ideas")
    page.locator(".mb-tab__label", has_text="Tab 1").click(); page.wait_for_timeout(700)

    # tab-scoped export
    page.get_by_role("button", name="Project actions").click()
    with page.expect_download() as dl:
        page.get_by_role("menuitem", name="Download .excalidraw (this tab)").click()
    check("export names file after the tab", dl.value.suggested_filename == "Plan - Tab 1.excalidraw", dl.value.suggested_filename)
    path = os.path.join(OUT, "tab.excalidraw"); dl.value.save_as(path)
    check("export holds only that tab", len(json.load(open(path))["elements"]) == 1)

    # ---------- Links ----------
    type_text(page, 300, 600, "Read [the docs](https://example.com/docs) first")
    page.wait_for_timeout(800)
    wait_saved(page)
    els = tab(page, pid, "Tab 1")["elements"]
    md = next((e for e in els if e["type"] == "text" and "docs" in e["originalText"]), None)
    check("[label](url) becomes the label", md and md["originalText"] == "Read the docs first", md and md["originalText"])
    check("…and links the text", md and md.get("link") == "https://example.com/docs")
    check("…and the text box shrinks to fit", md and md["width"] < 220, md and md["width"])

    type_text(page, 300, 700, "https://example.org/page")
    page.wait_for_timeout(800); wait_saved(page)
    els = tab(page, pid, "Tab 1")["elements"]
    bare = next((e for e in els if e["type"] == "text" and e["originalText"].startswith("https://example.org")), None)
    check("a typed URL is linked, text unchanged", bare and bare.get("link") == "https://example.org/page")

    # label inside a box: the box gets the link
    draw(page, "r", 900, 550, 1150, 650)
    page.mouse.dblclick(1025, 600); page.wait_for_timeout(300)
    page.keyboard.type("Spec [here](https://spec.example.com)"); page.keyboard.press("Escape")
    page.wait_for_timeout(800); wait_saved(page)
    els = tab(page, pid, "Tab 1")["elements"]
    label = next((e for e in els if e["type"] == "text" and e.get("containerId")), None)
    box = next((e for e in els if label and e["id"] == label["containerId"]), None)
    check("box label shows just the words", label and label["originalText"] == "Spec here", label and label["originalText"])
    check("…and the box itself is linked", box and box.get("link") == "https://spec.example.com", box and box.get("link"))
    if label and box:
        offset = abs((label["y"] + label["height"] / 2) - (box["y"] + box["height"] / 2))
        check("…and the label stays centred in the box", offset < 2, f"off by {offset:.1f}px")
    page.screenshot(path=f"{OUT}/t2-links.png")

    # paste a URL onto a selected shape
    page.keyboard.press("v"); page.mouse.click(600, 305)  # select the first rectangle (its edge)
    page.wait_for_timeout(200)
    page.evaluate("""() => {
      const dt = new DataTransfer(); dt.setData('text/plain', 'https://pasted.example.com');
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    }""")
    page.wait_for_timeout(800); wait_saved(page)
    els = tab(page, pid, "Tab 1")["elements"]
    rect = next((e for e in els if e["type"] == "rectangle" and e.get("link") == "https://pasted.example.com"), None)
    check("pasting a URL links the selected shape", rect is not None)
    check("…without adding a URL text box", not any(e["type"] == "text" and "pasted.example" in e["originalText"] for e in els))
    page.keyboard.press("Escape"); page.mouse.click(1300, 800)

    # ctrl/cmd-click opens the link
    def ctrl_click(x, y):
        page.keyboard.down("Control"); page.mouse.click(x, y); page.keyboard.up("Control")
    with ctx.expect_page(timeout=5000) as popup:
        ctrl_click(600, 360)
    check("ctrl-click a linked shape opens its link", "pasted.example.com" in popup.value.url, popup.value.url)
    popup.value.close()
    with ctx.expect_page(timeout=5000) as popup:
        ctrl_click(1025, 600)
    check("ctrl-click a linked box's label opens the box link", "spec.example.com" in popup.value.url, popup.value.url)
    popup.value.close()

    # thumbnail comes from the first tab
    page.get_by_role("link", name="Projects").click()
    page.wait_for_function("document.querySelector('.mb-card__preview img')", timeout=8000)
    page.screenshot(path=f"{OUT}/t3-dashboard.png")
    check("dashboard thumbnail generated", page.locator(".mb-card__preview img").count() == 1)

    # dashboard export of a multi-tab project downloads one file per tab
    downloads = []
    page.on("download", lambda d: downloads.append(d.suggested_filename))
    page.get_by_role("button", name="More options for Plan").click()
    page.get_by_role("menuitem", name="Download .excalidraw").click()
    page.wait_for_timeout(2500)
    check("dashboard export: one file per tab", sorted(downloads) == ["Plan - Ideas.excalidraw", "Plan - Tab 1.excalidraw"], str(downloads))

    # duplicating a project keeps its tabs
    page.get_by_role("button", name="More options for Plan").click()
    page.get_by_role("menuitem", name="Duplicate").click()
    page.wait_for_function("document.querySelectorAll('[data-testid=project-card]').length === 2")
    page.get_by_role("link", name="Plan (copy)", exact=True).click()
    page.wait_for_selector(".excalidraw canvas"); page.wait_for_timeout(800)
    check("duplicated project keeps its tabs", strip(page) == ["Tab 1", "Ideas"], str(strip(page)))

    real = [e for e in errors if "workers for subsetting" not in e]
    check("no page errors", not real, "; ".join(real[:3]))
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
