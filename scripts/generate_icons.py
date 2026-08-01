from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "app-icon-zapiski.png"
OUT = ROOT / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

with Image.open(SOURCE) as source:
    square = source.convert("RGB")
    side = min(square.size)
    left = (square.width - side) // 2
    top = (square.height - side) // 2
    square = square.crop((left, top, left + side, top + side))
    square.resize((1024, 1024), Image.Resampling.LANCZOS).save(OUT / "icon-master-1024.png", optimize=True)
    square.resize((512, 512), Image.Resampling.LANCZOS).save(OUT / "icon-512.png", optimize=True)
    square.resize((512, 512), Image.Resampling.LANCZOS).save(OUT / "icon-maskable-512.png", optimize=True)
    square.resize((192, 192), Image.Resampling.LANCZOS).save(OUT / "icon-192.png", optimize=True)
