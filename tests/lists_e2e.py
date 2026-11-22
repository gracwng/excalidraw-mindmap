"""Bullet/numbered lists in canvas text, and tab menus. Usage: lists_e2e.py <app_url> <out_dir>"""
import sys, os
from playwright.sync_api import sync_playwright

APP, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond))); print(("PASS " if cond else "FAIL ") + name, detail)

TEXTS_JS = """async (id) => {
  const db = await new Promise((res) => { const r = indexedDB.open('mindboard'); r.onsuccess = () => res(r.result); });
  const s = await new Promise((res) => { const r = db.transaction('scenes').objectStore('scenes').get(id); r.onsuccess = () => res(r.result); });
  db.close();
  const tab = s.tabs.filter(t => !t.deleted).sort((a, b) => a.order - b.order)[0];
  return tab.elements.filter(e => !e.isDeleted && e.type === 'text')
    .map(e => ({ id: e.id, text: e.originalText, containerId: e.containerId, align: e.textAlign, x: e.x }));
}"""

with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.environ.get("PW_CHANNEL") or None)
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(APP + "/")
    page.get_by_role("button", name="New mindboard").first.click()
    page.wait_for_url("**/project/*"); page.wait_for_selector(".excalidraw canvas"); page.wait_for_timeout(800)
    pid = page.url.split("/project/")[1]
    kb = page.keyboard

    def editor_value():
        return page.evaluate("document.querySelector('.excalidraw-wysiwyg')?.value ?? null")

    def finish():
        kb.press("Escape"); page.wait_for_timeout(300)

    def texts():
        page.wait_for_function("document.querySelector('.mb-save')?.innerText.includes('Saved')", timeout=8000)
        page.wait_for_timeout(300)
        return page.evaluate(TEXTS_JS, pid)

    def start_text(x, y):
        kb.press("t"); page.mouse.click(x, y); page.wait_for_selector(".excalidraw-wysiwyg")

    # 1. bullets: "- " autoformats, Enter continues, Enter on empty item ends the list
    start_text(300, 200)
    kb.type("Groceries"); kb.press("Enter")
    kb.type("- milk")
    check("'- ' becomes a bullet", editor_value() == "Groceries\n• milk", repr(editor_value()))
    kb.press("Enter"); kb.type("eggs")
    kb.press("Enter")
    check("Enter continues the list", editor_value() == "Groceries\n• milk\n• eggs\n• ", repr(editor_value()))
    kb.press("Enter")
    kb.type("After the list")
    check("Enter on an empty item ends the list", editor_value() == "Groceries\n• milk\n• eggs\nAfter the list", repr(editor_value()))
    finish()

    # 2. numbered: continues, and renumbers when you insert in the middle
    start_text(700, 200)
    kb.type("1. first"); kb.press("Enter"); kb.type("second"); kb.press("Enter"); kb.type("third")
    check("numbered list continues", editor_value() == "1. first\n2. second\n3. third", repr(editor_value()))
    kb.press("ArrowUp"); kb.press("ArrowUp"); kb.press("End"); kb.press("Enter"); kb.type("inserted")
    check("inserting renumbers the rest", editor_value() == "1. first\n2. inserted\n3. second\n4. third", repr(editor_value()))
    # delete the inserted line entirely -> renumber back
    kb.press("Home"); kb.down("Shift"); kb.press("End"); kb.up("Shift"); kb.press("Backspace")  # clears "2. inserted" text incl marker
    kb.press("Backspace")  # joins with previous line
    check("deleting a line renumbers", editor_value() == "1. first\n2. second\n3. third", repr(editor_value()))
    finish()

    # 3. Backspace right after a marker removes it
    start_text(300, 450)
    kb.type("* ")
    check("'* ' also becomes a bullet", editor_value() == "• ", repr(editor_value()))
    kb.press("Backspace")
    check("Backspace after a marker removes it", editor_value() == "", repr(editor_value()))
    kb.type("plain a"); kb.press("Enter"); kb.type("plain b")

    # 4. Docs shortcuts on selected lines while editing
    kb.press("Control+a"); kb.press("Control+Shift+Digit8")
    check("Ctrl+Shift+8 bullets the lines", editor_value() == "• plain a\n• plain b", repr(editor_value()))
    kb.press("Control+a"); kb.press("Control+Shift+Digit7")
    check("Ctrl+Shift+7 numbers them", editor_value() == "1. plain a\n2. plain b", repr(editor_value()))
    kb.press("Control+a"); kb.press("Control+Shift+Digit7")
    check("pressing it again removes numbering", editor_value() == "plain a\nplain b", repr(editor_value()))
    finish()

    # 5. shortcut on a selected (not editing) text element
    kb.press("Control+Shift+Digit8"); page.wait_for_timeout(500)
    t = next((x for x in texts() if x["text"].endswith("plain b")), None)
    check("Ctrl+Shift+8 on a selected text element", t and t["text"] == "• plain a\n• plain b", t and repr(t["text"]))

    # 6. nested numbering inside a box label with Tab
    kb.press("Escape"); kb.press("r")
    page.mouse.move(800, 420); page.mouse.down(); page.mouse.move(1150, 620, steps=6); page.mouse.up()
    kb.press("Enter"); page.wait_for_selector(".excalidraw-wysiwyg")   # Enter on a selected box edits its label
    kb.type("1. plan"); kb.press("Enter"); kb.press("Tab"); kb.type("research"); kb.press("Enter"); kb.type("sketch")
    kb.press("Enter"); kb.press("Shift+Tab"); kb.type("build")
    expected = "1. plan\n    1. research\n    2. sketch\n2. build"
    check("Tab nests and numbering restarts per level", editor_value() == expected, repr(editor_value()))
    finish()
    label = next((x for x in texts() if x["containerId"]), None)
    check("box label saved with the list", label and label["text"] == expected, label and repr(label["text"]))
    check("a list in a box label is left-aligned", label and label["align"] == "left", label and label["align"])
    check("…and sits at the box's left edge", label and 800 <= label["x"] <= 815, label and label["x"])
    page.screenshot(path=f"{OUT}/l1-lists.png")

    # 7. normal text isn't touched
    start_text(300, 700)
    kb.type("Pi is 3.14 and -5 is negative"); kb.press("Enter"); kb.type("ok")
    check("ordinary text isn't turned into a list", editor_value() == "Pi is 3.14 and -5 is negative\nok", repr(editor_value()))
    finish()

    # ---------- Tab menus ----------
    page.get_by_role("button", name="Options for tab Tab 1").click()
    delete = page.get_by_role("menuitem", name="Delete tab")
    check("with one tab, Delete tab is shown but disabled", delete.is_visible() and delete.is_disabled())
    check("…with a reason", "at least one tab" in delete.inner_text(), delete.inner_text())
    kb.press("Escape")
    page.get_by_role("button", name="Add tab").click(); page.wait_for_timeout(700)
    page.locator(".mb-tab__label", has_text="Tab 1").click(button="right")
    check("right-click opens a tab's menu", page.get_by_role("menuitem", name="Delete tab").is_enabled())
    box = page.get_by_role("menu").bounding_box()
    check("the menu opens below the tab, fully visible", box and 30 <= box["y"] <= 60 and box["height"] > 120, str(box))
    check("tabs stay visible while the menu is open", page.locator(".mb-tab__label", has_text="Tab 1").is_visible())
    page.wait_for_timeout(300); page.screenshot(path=f"{OUT}/l2-tab-menu.png")
    page.get_by_role("menuitem", name="Delete tab").click()
    page.get_by_role("alertdialog").get_by_role("button", name="Delete").click()
    page.wait_for_function("document.querySelectorAll('.mb-tab__label').length === 1")
    labels = page.locator(".mb-tab__label").all_inner_texts()
    check("deleting via right-click works", labels == ["Tab 2"], str(labels))

    real = [e for e in errors if "workers for subsetting" not in e]
    check("no page errors", not real, "; ".join(real[:3]))
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
