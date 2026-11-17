"""End-to-end QA for Mindboard. Usage: python3 e2e.py <base_url> <out_dir>"""
import sys, json, time, os
from playwright.sync_api import sync_playwright, expect

BASE, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail)); print(("PASS " if cond else "FAIL ") + name, detail)

def draw_rect(page, x1, y1, x2, y2):
    page.keyboard.press("r")
    page.mouse.move(x1, y1); page.mouse.down(); page.mouse.move(x2, y2, steps=8); page.mouse.up()
    page.keyboard.press("Escape")

def scene_count(page):
    # count non-deleted elements in IndexedDB for the current project
    return page.evaluate("""async (id) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('mindboard'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
      const s = await new Promise((res) => { const r = db.transaction('scenes').objectStore('scenes').get(id); r.onsuccess=()=>res(r.result); });
      db.close(); return s ? s.elements.length : -1; }""", page.url.split('/project/')[1])

with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.environ.get("PW_CHANNEL") or None, headless=True)
    ctx = browser.new_context(viewport={"width": 1400, "height": 900}, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))

    # 1. Empty dashboard
    page.goto(BASE + "/")
    page.wait_for_selector(".mb-empty", timeout=10000)
    page.screenshot(path=f"{OUT}/01-empty-dashboard.png")
    check("empty state shows", page.locator(".mb-empty").is_visible())

    # 2. Create project -> editor
    page.get_by_role("button", name="New mind map").first.click()
    page.wait_for_url("**/project/*")
    page.wait_for_selector(".excalidraw canvas", timeout=20000)
    page.wait_for_timeout(1000)
    page.screenshot(path=f"{OUT}/02-new-editor.png")
    pid1 = page.url.split("/project/")[1]
    check("editor renders excalidraw", page.locator(".excalidraw .App-toolbar").count() > 0 or page.locator(".excalidraw").count() > 0)
    check("default name", "Untitled mind map" in page.locator(".mb-editor-header").inner_text())

    # 3. Draw shapes, check autosave
    draw_rect(page, 500, 300, 700, 420)
    page.keyboard.press("o")
    page.mouse.move(800, 300); page.mouse.down(); page.mouse.move(950, 420, steps=8); page.mouse.up()
    page.keyboard.press("Escape")
    # arrow binding rect->ellipse
    page.keyboard.press("a")
    page.mouse.move(700, 360); page.mouse.down(); page.mouse.move(820, 360, steps=8); page.mouse.up()
    page.keyboard.press("Escape")
    # text
    page.keyboard.press("t")
    page.mouse.click(520, 520)
    page.keyboard.type("Central idea")
    page.keyboard.press("Escape")
    saving_seen = "Saving" in page.locator(".mb-save").inner_text()
    page.wait_for_function("document.querySelector('.mb-save')?.innerText.includes('Saved')", timeout=8000)
    check("saving indicator appeared", saving_seen)
    n = scene_count(page)
    check("4 elements persisted", n == 4, f"count={n}")

    # 4. Undo/redo
    page.keyboard.press("Control+z")
    page.wait_for_timeout(1500)
    check("undo persisted", scene_count(page) == 3, f"count={scene_count(page)}")
    page.keyboard.press("Control+Shift+z")
    page.wait_for_timeout(1500)
    check("redo persisted", scene_count(page) == 4)

    # 5. Pan/zoom then refresh: viewport + elements restored
    page.keyboard.press("Control+Equal")
    page.mouse.wheel(0, 200)
    page.wait_for_timeout(1500)
    zoom_before = page.locator(".excalidraw .zoom-actions, .excalidraw [title*='Reset zoom']").first.inner_text() if page.locator(".excalidraw [title*='Reset zoom']").count() else ""
    page.screenshot(path=f"{OUT}/03-drawn.png")
    page.reload()
    page.wait_for_selector(".excalidraw canvas", timeout=20000)
    page.wait_for_timeout(1500)
    zoom_after = page.locator(".excalidraw [title*='Reset zoom']").first.inner_text() if page.locator(".excalidraw [title*='Reset zoom']").count() else ""
    check("elements survive refresh", scene_count(page) == 4)
    check("zoom restored", zoom_before and zoom_before == zoom_after, f"{zoom_before!r} vs {zoom_after!r}")
    page.screenshot(path=f"{OUT}/04-after-refresh.png")

    # 6. Rename in header
    page.locator(".mb-name-button").click()
    page.locator(".mb-name-input").fill("Product brainstorm")
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)

    # 7. Image insertion via paste-like API: use excalidraw file input
    png = os.path.join(OUT, "sample.png")
    page.screenshot(path=png, clip={"x": 0, "y": 0, "width": 120, "height": 80})
    page.keyboard.press("9")  # image tool shortcut
    try:
        with page.expect_file_chooser(timeout=3000) as fc:
            pass
        fc.value.set_files(png)
    except Exception:
        # fallback: drop file onto canvas
        data = open(png, "rb").read()
        page.evaluate("""async (b64) => {
          const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const file = new File([bin], 'sample.png', {type: 'image/png'});
          const dt = new DataTransfer(); dt.items.add(file);
          const target = document.querySelector('.excalidraw .excalidraw__canvas.interactive') || document.querySelector('.excalidraw canvas');
          for (const type of ['dragover','drop']) target.dispatchEvent(new DragEvent(type, {dataTransfer: dt, bubbles: true, cancelable: true, clientX: 300, clientY: 600}));
        }""", __import__("base64").b64encode(data).decode())
    page.wait_for_timeout(500)
    page.mouse.click(300, 650)
    page.wait_for_timeout(2500)
    files_count = page.evaluate("""async () => {
      const db = await new Promise((res) => { const r = indexedDB.open('mindboard'); r.onsuccess=()=>res(r.result); });
      const n = await new Promise((res) => { const r = db.transaction('files').objectStore('files').count(); r.onsuccess=()=>res(r.result); });
      db.close(); return n; }""")
    check("image file persisted", files_count >= 1, f"files={files_count}")

    # 8. Back to dashboard -> card w/ thumbnail
    page.get_by_role("link", name="Projects").click()
    page.wait_for_selector("[data-testid=project-card]")
    page.wait_for_function("document.querySelector('.mb-card__preview img')", timeout=8000)
    check("card shows renamed title", "Product brainstorm" in page.locator(".mb-card__title").first.inner_text())
    check("thumbnail generated", page.locator(".mb-card__preview img").count() == 1)

    # reopen: image still there
    page.locator(".mb-card__title").first.click()
    page.wait_for_selector(".excalidraw canvas"); page.wait_for_timeout(1500)
    n_with_img = scene_count(page)
    check("image element restored", n_with_img == 5, f"count={n_with_img}")
    page.screenshot(path=f"{OUT}/05-reopened-with-image.png")
    page.get_by_role("link", name="Projects").click()
    page.wait_for_selector("[data-testid=project-card]")

    # 9. Duplicate, independence
    page.get_by_role("button", name="More options for Product brainstorm").click()
    page.get_by_role("menuitem", name="Duplicate").click()
    page.wait_for_function("document.querySelectorAll('[data-testid=project-card]').length === 2", timeout=5000)
    check("duplicate created", page.locator("[data-testid=project-card]").count() == 2)
    page.get_by_role("link", name="Product brainstorm (copy)", exact=True).click()
    page.wait_for_selector(".excalidraw canvas"); page.wait_for_timeout(1200)
    check("duplicate has same content", scene_count(page) == 5)
    page.keyboard.press("Control+a"); page.keyboard.press("Delete")
    page.wait_for_function("document.querySelector('.mb-save')?.innerText.includes('Saved')", timeout=8000)
    page.wait_for_timeout(1200)
    check("copy cleared", scene_count(page) == 0)
    page.goto(f"{BASE}/project/{pid1}")
    page.wait_for_selector(".excalidraw canvas"); page.wait_for_timeout(1200)
    check("original unaffected by copy edit", scene_count(page) == 5)

    # 10. Rapid edits then immediate navigation (flush on unmount)
    for i in range(6):
        draw_rect(page, 400 + i*50, 150, 440 + i*50, 190)
    page.get_by_role("link", name="Projects").click()
    page.wait_for_selector("[data-testid=project-card]")
    page.wait_for_timeout(1500)
    page.goto(f"{BASE}/project/{pid1}")
    page.wait_for_selector(".excalidraw canvas"); page.wait_for_timeout(1000)
    check("rapid edits flushed on navigation", scene_count(page) == 11, f"count={scene_count(page)}")

    # 11. Rapid edits then immediate reload (flush on pagehide)
    draw_rect(page, 400, 700, 460, 760)
    page.reload()
    page.wait_for_selector(".excalidraw canvas"); page.wait_for_timeout(1000)
    check("edit before reload survives", scene_count(page) == 12, f"count={scene_count(page)}")

    # 12. Export .excalidraw from editor
    page.get_by_role("button", name="Project actions").click()
    with page.expect_download() as dl:
        page.get_by_role("menuitem", name="Download .excalidraw").click()
    path = os.path.join(OUT, "export.excalidraw"); dl.value.save_as(path)
    data = json.load(open(path))
    check("export is excalidraw json", data.get("type") == "excalidraw" and len(data["elements"]) == 12 and len(data.get("files", {})) >= 1, f"els={len(data['elements'])} files={len(data.get('files',{}))}")
    for fmt in ["PNG", "SVG"]:
        page.get_by_role("button", name="Project actions").click()
        with page.expect_download() as dl:
            page.get_by_role("menuitem", name=f"Export as {fmt}").click()
        dl.value.save_as(os.path.join(OUT, f"export.{fmt.lower()}"))
        check(f"{fmt} export", os.path.getsize(os.path.join(OUT, f"export.{fmt.lower()}")) > 1000)

    # 13. Dark mode via excalidraw shortcut, header follows
    page.keyboard.press("Alt+Shift+d")
    page.wait_for_timeout(800)
    check("dark mode applied", page.evaluate("document.documentElement.dataset.theme") == "dark")
    page.screenshot(path=f"{OUT}/06-dark-editor.png")

    # 14. Import on dashboard
    page.get_by_role("link", name="Projects").click()
    page.wait_for_selector("[data-testid=project-card]")
    page.locator("input[type=file]").set_input_files(path)
    page.wait_for_function("document.querySelectorAll('[data-testid=project-card]').length === 3", timeout=8000)
    check("import creates project", page.locator("[data-testid=project-card]").count() == 3)
    page.wait_for_timeout(1500)
    page.screenshot(path=f"{OUT}/07-dark-dashboard.png")

    # 15. Search + sort
    page.get_by_label("Search mind maps").fill("copy")
    check("search filters", page.locator("[data-testid=project-card]").count() == 1)
    page.get_by_label("Search mind maps").fill("")
    page.get_by_label("Sort projects").select_option("name")
    titles = page.locator(".mb-card__title").all_inner_texts()
    check("sort by name", titles == sorted(titles, key=str.lower), str(titles))

    # 16. Card rename
    page.get_by_role("button", name="More options for export").click()
    page.get_by_role("menuitem", name="Rename").click()
    page.locator(".mb-card__rename").fill("Imported map")
    page.keyboard.press("Enter")
    page.wait_for_timeout(500)
    check("card rename", "Imported map" in page.locator(".mb-grid").inner_text())

    # 17. Delete with confirm
    page.get_by_role("button", name="More options for Imported map").click()
    page.get_by_role("menuitem", name="Delete").click()
    page.get_by_role("button", name="Cancel").click()
    check("cancel keeps project", page.locator("[data-testid=project-card]").count() == 3)
    page.get_by_role("button", name="More options for Imported map").click()
    page.get_by_role("menuitem", name="Delete").click()
    page.get_by_role("alertdialog").get_by_role("button", name="Delete").click()
    page.wait_for_function("document.querySelectorAll('[data-testid=project-card]').length === 2", timeout=5000)
    check("delete removes project", page.locator("[data-testid=project-card]").count() == 2)

    # 18. Missing project route
    page.goto(BASE + "/project/does-not-exist")
    page.wait_for_selector(".mb-fullscreen-message h1")
    check("missing project message", "doesn't exist" in page.inner_text("h1"))

    # 19. Light mode + mobile size screenshots
    page.goto(BASE + "/")
    page.get_by_role("button", name="Switch to light mode").click()
    page.wait_for_timeout(800)
    page.screenshot(path=f"{OUT}/08-light-dashboard.png")
    page.set_viewport_size({"width": 390, "height": 800})
    page.goto(f"{BASE}/project/{pid1}")
    page.wait_for_selector(".excalidraw canvas"); page.wait_for_timeout(1500)
    page.screenshot(path=f"{OUT}/09-mobile-editor.png")

    real_errors = [e for e in errors if "favicon" not in e and "workers for subsetting" not in e]
    check("no console/page errors", not real_errors, "\n".join(real_errors[:5]))
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results)-len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
