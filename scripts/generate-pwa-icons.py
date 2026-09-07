from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "icons"
FONT = ROOT / "public" / "brand" / "morita-script.ttf"

PAPER = "#F8F7F4"
LAVENDER = "#B9B4E8"
BLUSH = "#F8E3DF"


def create_icon(size: int, filename: str, *, maskable: bool = False) -> None:
    scale = 4
    canvas_size = size * scale
    image = Image.new("RGB", (canvas_size, canvas_size), LAVENDER if maskable else PAPER)
    draw = ImageDraw.Draw(image)

    if not maskable:
        margin = round(canvas_size * 0.035)
        draw.ellipse((margin, margin, canvas_size - margin, canvas_size - margin), fill=LAVENDER)

    font_size = round(canvas_size * (0.245 if not maskable else 0.22))
    font = ImageFont.truetype(str(FONT), font_size)
    text = "morita"
    box = draw.textbbox((0, 0), text, font=font)
    text_width = box[2] - box[0]
    text_height = box[3] - box[1]
    draw.text(
        ((canvas_size - text_width) / 2, (canvas_size - text_height) / 2 - box[1]),
        text,
        fill=BLUSH,
        font=font,
    )

    image.resize((size, size), Image.Resampling.LANCZOS).save(OUTPUT / filename, optimize=True)


OUTPUT.mkdir(parents=True, exist_ok=True)
create_icon(192, "morita-192.png")
create_icon(512, "morita-512.png")
create_icon(512, "morita-maskable-512.png", maskable=True)
create_icon(180, "apple-touch-icon.png")
create_icon(32, "favicon-32.png")
