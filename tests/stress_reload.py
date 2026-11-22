import sys
from playwright.sync_api import sync_playwright
APP=sys.argv[1]; N=int(sys.argv[2])
def count(pg, pid):
    return pg.evaluate("""async (id) => { const db = await new Promise(r=>{const q=indexedDB.open('mindboard');q.onsuccess=()=>r(q.result)});
      const s = await new Promise(r=>{const q=db.transaction('scenes').objectStore('scenes').get(id);q.onsuccess=()=>r(q.result)}); db.close();
      return s ? s.elements.filter(e=>!e.isDeleted).length : -1 }""", pid)
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome"); pg=b.new_page(viewport={"width":1400,"height":900})
    pg.goto(APP); pg.get_by_role("button", name="New mindboard").first.click()
    pg.wait_for_selector(".excalidraw canvas"); pg.wait_for_timeout(800)
    pid=pg.url.split("/project/")[1]; lost=0
    for i in range(N):
        pg.keyboard.press("r"); x=300+(i%10)*80; y=200+(i//10)*120
        pg.mouse.move(x,y); pg.mouse.down(); pg.mouse.move(x+50,y+50,steps=4); pg.mouse.up(); pg.keyboard.press("Escape")
        pg.reload(); pg.wait_for_selector(".excalidraw canvas"); pg.wait_for_timeout(400)
        c=count(pg,pid)
        if c != i+1: lost+=1; print(f"round {i+1}: expected {i+1}, got {c}")
    print(f"{N-lost}/{N} rounds kept the last shape; final count {count(pg,pid)}")
    b.close()
