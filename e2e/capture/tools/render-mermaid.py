"""Render every mermaid block of a Zenn book with mermaid itself, one PNG per
diagram, to check syntax and layout. The Zenn preview loads diagrams through
an external embed, which a headless browser does not finish loading.

Usage: python3 -I render-mermaid.py <book dir> <output dir>
Then open the PNGs. A diagram that fails to parse shows "ERR <message>".
"""
import html
import pathlib
import re
import subprocess
import sys

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
MERMAID = "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs"

book, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
for md in sorted(book.glob("*.md")):
    blocks = re.findall(r"```mermaid\n(.*?)\n```", md.read_text(encoding="utf-8"), re.S)
    for i, src in enumerate(blocks):
        page = out / f"{md.stem}-{i}.html"
        page.write_text(
            '<!doctype html><meta charset=utf-8>'
            '<body style="width:900px;font-family:sans-serif;background:#fff">'
            f'<pre class="mermaid">{html.escape(src)}</pre>'
            f'<script type="module">import mermaid from "{MERMAID}";'
            "mermaid.initialize({startOnLoad:false});"
            "try{await mermaid.run()}catch(e){document.body.insertAdjacentHTML("
            '"beforeend","<h1>ERR "+e.message+"</h1>")}</script>',
            encoding="utf-8",
        )
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
             "--window-size=950,1000", "--virtual-time-budget=15000",
             f"--screenshot={page.with_suffix('.png')}", page.as_uri()],
            stderr=subprocess.DEVNULL, check=True,
        )
        print(page.with_suffix(".png"))
