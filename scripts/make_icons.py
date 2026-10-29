"""Vẽ icon extension (PNG trong suốt) ở các kích thước Chrome Web Store yêu cầu."""
from pathlib import Path

from PIL import Image, ImageDraw

SIZES = (16, 48, 128)
CANVAS = 1024
BACKGROUND = (79, 70, 229, 255)
CARD = (255, 255, 255, 255)
CARD_BACK = (255, 255, 255, 120)
LINE = (79, 70, 229, 255)
OUT_DIR = Path(__file__).resolve().parent.parent / "icons"


def draw_master() -> Image.Image:
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle((0, 0, CANVAS - 1, CANVAS - 1), radius=230, fill=BACKGROUND)

    back = Image.new("RGBA", image.size, (0, 0, 0, 0))
    ImageDraw.Draw(back).rounded_rectangle((300, 170, 860, 640), radius=70, fill=CARD_BACK)
    image.alpha_composite(back)

    draw.rounded_rectangle((170, 330, 740, 850), radius=80, fill=CARD)
    for top, right in ((470, 620), (590, 540), (710, 440)):
        draw.rounded_rectangle((270, top, right, top + 50), radius=25, fill=LINE)
    return image


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    master = draw_master()
    for size in SIZES:
        master.resize((size, size), Image.LANCZOS).save(OUT_DIR / f"icon{size}.png")


if __name__ == "__main__":
    main()
