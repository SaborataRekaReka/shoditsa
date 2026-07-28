from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
SCREENSHOTS = ROOT / "screenshots"
DESKTOP_FILES = [
    "title-series-desktop.png",
    "title-anime-desktop.png",
    "title-game-desktop.png",
    "title-city-desktop.png",
    "title-music-desktop.png",
    "title-diagnosis-desktop.png",
    "title-connections-desktop.png",
    "title-danetki-desktop.png",
]

MOBILE_FILES = [
    "mobile-390-home-viewport.png",
    "mobile-390-movie.png",
    "mobile-390-series.png",
    "mobile-390-anime.png",
    "mobile-390-game.png",
    "mobile-390-city.png",
    "mobile-390-music.png",
    "mobile-390-diagnosis.png",
    "mobile-390-connections.png",
    "mobile-390-danetki.png",
    "mobile-390-dtf.png",
    "mobile-390-kpop.png",
    "mobile-390-together.png",
    "mobile-390-archive.png",
]


def build_sheet(files, output_name, thumb_width, columns):
    label_height = 42
    gap = 24
    font = ImageFont.load_default(size=22)

    cards = []
    for filename in files:
        image = Image.open(SCREENSHOTS / filename).convert("RGB")
        ratio = thumb_width / image.width
        thumb = image.resize((thumb_width, round(image.height * ratio)), Image.Resampling.LANCZOS)
        card = Image.new("RGB", (thumb_width, label_height + thumb.height), "#f5f5f5")
        draw = ImageDraw.Draw(card)
        draw.text((12, 9), filename, fill="#111111", font=font)
        card.paste(thumb, (0, label_height))
        cards.append(card)

    rows = (len(cards) + columns - 1) // columns
    row_heights = [
        max(cards[row * columns + col].height for col in range(columns) if row * columns + col < len(cards))
        for row in range(rows)
    ]
    sheet_width = columns * thumb_width + (columns - 1) * gap
    sheet_height = sum(row_heights) + (rows - 1) * gap
    sheet = Image.new("RGB", (sheet_width, sheet_height), "#202020")

    y = 0
    for row, row_height in enumerate(row_heights):
        for col in range(columns):
            index = row * columns + col
            if index >= len(cards):
                continue
            x = col * (thumb_width + gap)
            sheet.paste(cards[index], (x, y))
        y += row_height + gap

    sheet.save(ROOT / output_name, quality=88, optimize=True)


build_sheet(DESKTOP_FILES, "title-pages-desktop-contact-sheet.jpg", 720, 2)
build_sheet(MOBILE_FILES, "mobile-390-contact-sheet.jpg", 390, 4)
