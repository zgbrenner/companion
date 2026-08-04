#!/usr/bin/env python3
"""Compose Chrome Web Store and launch images from real COMPANION renders."""

from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "test-artifacts" / "brand"

GRAPHITE = "#111827"
DEEP = "#0B1220"
SLATE = "#334155"
SOFT = "#F8FAFC"
PAPER = "#FFFFFF"
MINT = "#35D6A6"
MINT_DARK = "#168363"
MINT_DEEP = "#0F6D52"
IRIS = "#7C6CFF"
BLUE = "#536DFE"
MUTED = "#526174"
BORDER = "#D7E0EA"

BRAND_FONT = Path(os.environ.get("COMPANION_BRAND_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
UI_FONT = Path(os.environ.get("COMPANION_UI_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
UI_BOLD_FONT = Path(os.environ.get("COMPANION_UI_BOLD_FONT", str(UI_FONT)))


def face(size: int, weight: int = 400, brand: bool = False) -> ImageFont.FreeTypeFont:
    path = BRAND_FONT if brand else (UI_BOLD_FONT if weight >= 600 else UI_FONT)
    result = ImageFont.truetype(str(path), size)
    if not brand and hasattr(result, "set_variation_by_axes"):
        try:
            result.set_variation_by_axes([weight])
        except Exception:
            pass
    return result


def rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[index:index + 2], 16) for index in (0, 2, 4))


def vertical_gradient(size: tuple[int, int], top: str, bottom: str) -> Image.Image:
    width, height = size
    first, last = rgb(top), rgb(bottom)
    image = Image.new("RGB", size)
    pixels = image.load()
    for y in range(height):
        ratio = y / max(1, height - 1)
        color = tuple(round(first[i] * (1 - ratio) + last[i] * ratio) for i in range(3))
        for x in range(width):
            pixels[x, y] = color
    return image


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def add_shadow(base: Image.Image, box: tuple[int, int, int, int], radius: int = 24) -> None:
    x0, y0, x1, y1 = box
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x0, y0 + 10, x1, y1 + 10), radius=radius, fill=(0, 0, 0, 72))
    base.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(radius)))


def paste_card(base: Image.Image, image: Image.Image, box: tuple[int, int, int, int], radius: int = 24, border: str = BORDER) -> None:
    x0, y0, x1, y1 = map(int, box)
    add_shadow(base, (x0, y0, x1, y1), radius)
    rendered = image.resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS).convert("RGBA")
    rendered.putalpha(rounded_mask(rendered.size, radius))
    base.alpha_composite(rendered, (x0, y0))
    ImageDraw.Draw(base).rounded_rectangle((x0, y0, x1 - 1, y1 - 1), radius=radius, outline=border, width=2)


def contain(image: Image.Image, max_width: int, max_height: int) -> Image.Image:
    ratio = min(max_width / image.width, max_height / image.height)
    return image.resize((round(image.width * ratio), round(image.height * ratio)), Image.Resampling.LANCZOS)


def orbit_icon(size: int) -> Image.Image:
    scale = 4
    side = size * scale
    image = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, side - 1, side - 1), radius=round(side * 0.22), fill=GRAPHITE)
    pad = side * 0.20
    stroke = max(4, round(side * 0.075))
    draw.arc((pad, pad, side - pad, side - pad), start=42, end=318, fill=SOFT, width=stroke)
    radius = (side - 2 * pad) / 2
    center = side / 2
    for angle in (42, 318):
        radians = math.radians(angle)
        x = center + radius * math.cos(radians)
        y = center + radius * math.sin(radians)
        cap = stroke / 2
        draw.ellipse((x - cap, y - cap, x + cap, y + cap), fill=SOFT)
    draw.ellipse((side * 0.38, side * 0.38, side * 0.62, side * 0.62), fill=MINT)
    radians = math.radians(318)
    x = center + radius * math.cos(radians)
    y = center + radius * math.sin(radians)
    endpoint = side * 0.047
    draw.ellipse((x - endpoint, y - endpoint, x + endpoint, y + endpoint), fill=MINT)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def spaced(draw: ImageDraw.ImageDraw, xy: tuple[float, float], text: str, font: ImageFont.FreeTypeFont, fill: str, spacing: int) -> float:
    x, y = xy
    for character in text:
        draw.text((x, y), character, font=font, fill=fill)
        x += draw.textlength(character, font=font) + spacing
    return x


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = word if not current else f"{current} {word}"
        if draw.textlength(candidate, font=font) <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def wrapped(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font: ImageFont.FreeTypeFont, fill: str, max_width: int, gap: int = 8, limit: int | None = None) -> int:
    x, y = xy
    lines = wrap(draw, text, font, max_width)
    if limit:
        lines = lines[:limit]
    line_height = font.getbbox("Ag")[3] - font.getbbox("Ag")[1]
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += line_height + gap
    return y


def pill(draw: ImageDraw.ImageDraw, xy: tuple[int, int], label: str, accent: str) -> tuple[int, int]:
    font = face(17, 650)
    x, y = xy
    width = round(draw.textlength(label, font=font) + 32)
    height = 38
    draw.rounded_rectangle((x, y, x + width, y + height), radius=height // 2, fill="#172033", outline=SLATE, width=1)
    draw.text((x + 16, y + 8), label, font=font, fill=accent)
    return width, height


def brand(base: Image.Image, x: int, y: int, icon_size: int, word_size: int, dark: bool = True, subtitle: str | None = None) -> None:
    base.alpha_composite(orbit_icon(icon_size), (x, y))
    draw = ImageDraw.Draw(base)
    spaced(draw, (x + icon_size + 20, y + icon_size * 0.17), "COMPANION", face(word_size, 700, brand=True), SOFT if dark else GRAPHITE, max(2, word_size // 8))
    if subtitle:
        draw.text((x + icon_size + 20, y + icon_size * 0.64), subtitle, font=face(18, 500), fill="#A9B6C6" if dark else MUTED)


def dark_canvas(size: tuple[int, int]) -> Image.Image:
    base = vertical_gradient(size, DEEP, GRAPHITE).convert("RGBA")
    draw = ImageDraw.Draw(base, "RGBA")
    width, height = size
    for multiplier, alpha in ((0.95, 35), (0.72, 25), (0.48, 18)):
        radius = round(min(width, height) * multiplier)
        cx, cy = round(width * 0.84), round(height * 0.18)
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), outline=(53, 214, 166, alpha), width=max(1, round(min(width, height) * 0.006)))
    for px, py, dot, alpha in ((0.91, 0.14, 5, 220), (0.82, 0.30, 4, 170), (0.95, 0.58, 3, 120), (0.08, 0.85, 3, 120)):
        x, y = width * px, height * py
        draw.ellipse((x - dot, y - dot, x + dot, y + dot), fill=(53, 214, 166, alpha))
    return base


def caption(draw: ImageDraw.ImageDraw, x: int, y: int, width: int, title: str, body: str, accent: str = MINT) -> None:
    draw.rounded_rectangle((x, y, x + width, y + 132), radius=22, fill="#172033", outline=SLATE, width=2)
    draw.rounded_rectangle((x + 18, y + 20, x + 24, y + 112), radius=3, fill=accent)
    draw.text((x + 42, y + 20), title, font=face(24, 700), fill=SOFT)
    wrapped(draw, (x + 42, y + 58), body, face(17, 400), "#B8C5D4", width - 62, 5, 3)


def save(image: Image.Image, relative: str) -> None:
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(path, optimize=True)
    print(f"{relative}: {image.size[0]}x{image.size[1]}")


def main() -> None:
    claude = Image.open(SOURCE / "popup.png").convert("RGB")
    openai = Image.open(SOURCE / "openai-popup.png").convert("RGB")
    options = Image.open(SOURCE / "options.png").convert("RGB")

    base = dark_canvas((440, 280))
    draw = ImageDraw.Draw(base)
    brand(base, 34, 32, 62, 27)
    draw.text((34, 120), "NATIVE USAGE.", font=face(29, 800), fill=SOFT)
    draw.text((34, 158), "LOCAL TOOLS.", font=face(29, 800), fill=SOFT)
    draw.text((34, 204), "PRIVATE BY DESIGN.", font=face(17, 700), fill=MINT)
    save(base, "store/promo-tile-440x280.png")

    base = dark_canvas((1400, 560))
    draw = ImageDraw.Draw(base)
    brand(base, 74, 64, 72, 34, subtitle="Claude + ChatGPT")
    draw.text((74, 190), "One private layer", font=face(58, 800), fill=SOFT)
    draw.text((74, 255), "for your AI work.", font=face(58, 800), fill=SOFT)
    wrapped(draw, (78, 345), "Native usage when available. Local prompt and file tools always. No account, analytics, telemetry, or backend.", face(23), "#B8C5D4", 560, 9, 3)
    c = contain(claude, 295, 440)
    o = contain(openai, 280, 410)
    paste_card(base, c, (820, 74, 820 + c.width, 74 + c.height), 22, SLATE)
    paste_card(base, o, (1090, 105, 1090 + o.width, 105 + o.height), 22, SLATE)
    save(base, "store/marquee-1400x560.png")

    base = dark_canvas((1280, 800))
    draw = ImageDraw.Draw(base)
    brand(base, 64, 54, 58, 28)
    draw.text((64, 158), "ONE EXTENSION.", font=face(53, 800), fill=SOFT)
    draw.text((64, 218), "CHATGPT + CLAUDE.", font=face(53, 800), fill=SOFT)
    wrapped(draw, (68, 302), "Claude, ChatGPT Chat, and Work. COMPANION follows the active page automatically, with narrow legacy route compatibility.", face(22), "#B8C5D4", 475, 8, 4)
    x = 68
    for label, color in (("Claude", MINT), ("Chat", MINT), ("Work", IRIS)):
        width, _ = pill(draw, (x, 430), label, color)
        x += width + 10
    caption(draw, 64, 520, 470, "Private by design", "No account, analytics, telemetry, remote code, or developer backend.")
    c = contain(claude, 285, 640)
    o = contain(openai, 290, 500)
    paste_card(base, c, (700, 84, 700 + c.width, 84 + c.height), 22, SLATE)
    paste_card(base, o, (965, 150, 965 + o.width, 150 + o.height), 22, SLATE)
    save(base, "store/screenshots/01-overview.png")

    base = vertical_gradient((1280, 800), SOFT, "#EAF2F7").convert("RGBA")
    draw = ImageDraw.Draw(base)
    brand(base, 64, 52, 54, 27, False, "Claude usage")
    draw.text((64, 160), "KNOW THE LIMIT", font=face(54, 800), fill=GRAPHITE)
    draw.text((64, 220), "BEFORE IT STOPS YOU.", font=face(54, 800), fill=GRAPHITE)
    wrapped(draw, (68, 310), "Exact native usage-credit spend, rolling limits, reset times, local history, pace, and plan-fit insight when Claude exposes them.", face(22), MUTED, 500, 9, 5)
    y = 500
    for title, body in (("Exact spend", "Native usage-credit counter, not a text estimate."), ("Reset-aware", "Session, weekly, Opus, and monthly views."), ("Local history", "Trends and exports stay in browser storage.")):
        draw.ellipse((70, y + 8, 82, y + 20), fill=MINT_DARK)
        draw.text((98, y), title, font=face(20, 700), fill=GRAPHITE)
        draw.text((98, y + 31), body, font=face(16), fill=MUTED)
        y += 82
    c = contain(claude, 310, 690)
    paste_card(base, c, (820, 52, 820 + c.width, 52 + c.height), 24, BORDER)
    save(base, "store/screenshots/02-claude-usage.png")

    base = dark_canvas((1280, 800))
    draw = ImageDraw.Draw(base)
    brand(base, 64, 54, 56, 27, subtitle="ChatGPT web surfaces")
    draw.text((64, 158), "THE SAME LOCAL TOOLS.", font=face(49, 800), fill=SOFT)
    draw.text((64, 216), "THE RIGHT SURFACE FIT.", font=face(49, 800), fill=SOFT)
    wrapped(draw, (68, 300), "COMPANION adapts automatically to Chat and Work, with narrow legacy route compatibility. Native OpenAI usage appears only when OpenAI exposes a supported number.", face(21), "#B8C5D4", 545, 8, 5)
    y = 484
    for label, color, description in (("CHAT", MINT, "Graphite + mint"), ("WORK", IRIS, "Restrained violet"), ("LEGACY ROUTE", BLUE, "Compatibility only")):
        draw.rounded_rectangle((68, y, 570, y + 74), radius=18, fill="#172033", outline=SLATE, width=2)
        draw.ellipse((92, y + 27, 108, y + 43), fill=color)
        draw.text((128, y + 17), label, font=face(19, 700), fill=SOFT)
        draw.text((330, y + 20), description, font=face(16), fill="#A9B6C6")
        y += 88
    o = contain(openai, 410, 665)
    paste_card(base, o, (760, 78, 760 + o.width, 78 + o.height), 24, SLATE)
    pill(draw, (800, 685), "Native data when exposed", MINT)
    save(base, "store/screenshots/03-chatgpt-work-codex.png")

    base = vertical_gradient((1280, 800), SOFT, "#E9F1F7").convert("RGBA")
    draw = ImageDraw.Draw(base)
    brand(base, 60, 48, 52, 26, False, "Settings + privacy")
    draw.text((60, 146), "CONTROL WHAT APPEARS.", font=face(47, 800), fill=GRAPHITE)
    draw.text((60, 201), "CLEAR WHAT STAYS.", font=face(47, 800), fill=GRAPHITE)
    wrapped(draw, (64, 280), "Every major display and alert feature is optional. One action clears local Claude history, OpenAI snapshots, caches, session state, and badge ownership.", face(21), MUTED, 490, 8, 5)
    y = 472
    for title, body, color in (("Local storage only", "Settings, numeric history, and bounded operational state.", MINT_DARK), ("Never stored", "Replies, raw OpenAI responses, passwords, cookies, and file contents.", IRIS), ("No third party", "No analytics, telemetry, advertising, or developer server.", BLUE)):
        draw.rounded_rectangle((60, y, 540, y + 76), radius=18, fill=PAPER, outline=BORDER, width=2)
        draw.rounded_rectangle((60, y, 68, y + 76), radius=4, fill=color)
        draw.text((88, y + 13), title, font=face(18, 700), fill=GRAPHITE)
        draw.text((88, y + 40), body, font=face(14), fill=MUTED)
        y += 88
    privacy = contain(options.crop((170, max(0, options.height - 936), 1110, options.height)), 610, 700)
    paste_card(base, privacy, (640, 64, 640 + privacy.width, 64 + privacy.height), 24, BORDER)
    save(base, "store/screenshots/04-settings-privacy.png")

    base = dark_canvas((1280, 800))
    draw = ImageDraw.Draw(base)
    brand(base, 62, 50, 54, 27, subtitle="Local efficiency tools")
    draw.text((62, 150), "FINISH MORE WORK", font=face(52, 800), fill=SOFT)
    draw.text((62, 210), "BEFORE THE LIMIT.", font=face(52, 800), fill=SOFT)
    wrapped(draw, (66, 294), "Lifejacket Mode stays visible and user-controlled. Nothing is silently sent, and selected files are parsed in a no-network sandbox.", face(21), "#B8C5D4", 500, 8, 5)
    y = 470
    for number, title, body in (("1", "Shorter answers", "Preserve important facts, steps, and caveats."), ("2", "Prompt preview", "Review optimized text, send original, or cancel."), ("3", "File to Markdown", "PDF and Office conversion stays on-device.")):
        draw.rounded_rectangle((62, y, 560, y + 88), radius=20, fill="#172033", outline=SLATE, width=2)
        draw.ellipse((82, y + 20, 130, y + 68), fill=MINT_DEEP)
        number_font = face(18, 700)
        number_width = draw.textlength(number, font=number_font)
        draw.text((106 - number_width / 2, y + 31), number, font=number_font, fill=SOFT)
        draw.text((150, y + 14), title, font=face(20, 700), fill=SOFT)
        draw.text((150, y + 47), body, font=face(15), fill="#A9B6C6")
        y += 100
    lower = min(options.height, 1550)
    cave = contain(options.crop((300, min(650, options.height - 1), 1115, lower)), 590, 650)
    paste_card(base, cave, (650, 80, 650 + cave.width, 80 + cave.height), 24, SLATE)
    pill(draw, (815, 704), "No-network parser", MINT)
    save(base, "store/screenshots/05-local-efficiency-tools.png")

    base = dark_canvas((240, 240))
    base.alpha_composite(orbit_icon(156), (42, 28))
    draw = ImageDraw.Draw(base)
    word_font = face(18, 700, brand=True)
    width = sum(draw.textlength(character, font=word_font) for character in "COMPANION") + 2 * 8
    spaced(draw, ((240 - width) / 2, 194), "COMPANION", word_font, SOFT, 2)
    save(base, "docs/launch/assets/product-hunt-thumbnail-240x240.png")

    for source, target in (("01-overview.png", "product-hunt-gallery-01-1270x760.png"), ("02-claude-usage.png", "product-hunt-gallery-02-1270x760.png"), ("04-settings-privacy.png", "product-hunt-gallery-03-1270x760.png")):
        image = Image.open(ROOT / "store" / "screenshots" / source).convert("RGB")
        image = image.crop((5, 20, 1275, 780)).resize((1270, 760), Image.Resampling.LANCZOS)
        save(image, f"docs/launch/assets/{target}")

    base = dark_canvas((1200, 630))
    draw = ImageDraw.Draw(base)
    brand(base, 70, 62, 70, 33, subtitle="Claude + ChatGPT")
    draw.text((70, 205), "NATIVE USAGE", font=face(56, 800), fill=SOFT)
    draw.text((70, 269), "WHEN AVAILABLE.", font=face(56, 800), fill=SOFT)
    draw.text((70, 353), "LOCAL TOOLS ALWAYS.", font=face(40, 800), fill=MINT)
    wrapped(draw, (74, 435), "No account. No analytics. No telemetry. No developer backend.", face(22), "#B8C5D4", 540, 8, 3)
    c = contain(claude, 245, 510)
    o = contain(openai, 245, 420)
    paste_card(base, c, (735, 58, 735 + c.width, 58 + c.height), 20, SLATE)
    paste_card(base, o, (945, 125, 945 + o.width, 125 + o.height), 20, SLATE)
    save(base, "docs/launch/assets/social-card-1200x630.png")

    expected = {
        "store/promo-tile-440x280.png": (440, 280),
        "store/marquee-1400x560.png": (1400, 560),
        "store/screenshots/01-overview.png": (1280, 800),
        "store/screenshots/02-claude-usage.png": (1280, 800),
        "store/screenshots/03-chatgpt-work-codex.png": (1280, 800),
        "store/screenshots/04-settings-privacy.png": (1280, 800),
        "store/screenshots/05-local-efficiency-tools.png": (1280, 800),
        "docs/launch/assets/product-hunt-thumbnail-240x240.png": (240, 240),
        "docs/launch/assets/product-hunt-gallery-01-1270x760.png": (1270, 760),
        "docs/launch/assets/product-hunt-gallery-02-1270x760.png": (1270, 760),
        "docs/launch/assets/product-hunt-gallery-03-1270x760.png": (1270, 760),
        "docs/launch/assets/social-card-1200x630.png": (1200, 630),
    }
    for relative, dimensions in expected.items():
        actual = Image.open(ROOT / relative).size
        if actual != dimensions:
            raise SystemExit(f"{relative}: {actual} != {dimensions}")
    print("Launch assets generated and dimension-checked.")


if __name__ == "__main__":
    main()
