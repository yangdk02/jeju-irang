from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
OLD = ASSETS / "social-carousel"
OUT = ASSETS / "social-carousel-v2"
SOURCE = OUT / "source"

W, H = 1080, 1350
IVORY = "#FFF9F0"
BROWN = "#49382F"
ORANGE = "#FF9F1C"
YELLOW = "#FFD166"
SKY = "#79CFE3"
MINT = "#82D4B7"
PINK = "#F7B6C8"

COVER_TITLE_FONT = SOURCE / "BMKkubulim.otf"
STEP_TITLE_FONT = SOURCE / "BMKkubulim.otf"
LOGO_FONT = SOURCE / "Jua-Regular.ttf"
BODY_REGULAR = SOURCE / "Pretendard-Regular.otf"
BODY_BOLD = SOURCE / "Pretendard-Bold.otf"
BODY_EXTRA = SOURCE / "Pretendard-ExtraBold.otf"


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def fit_font(path: Path, text: str, max_size: int, min_size: int, max_width: int) -> ImageFont.FreeTypeFont:
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    for size in range(max_size, min_size - 1, -2):
        candidate = font(path, size)
        box = probe.textbbox((0, 0), text, font=candidate, stroke_width=1)
        if box[2] - box[0] <= max_width:
            return candidate
    return font(path, min_size)


def canvas(accent: str) -> Image.Image:
    image = Image.new("RGBA", (W, H), IVORY)
    draw = ImageDraw.Draw(image, "RGBA")
    draw.ellipse((760, -215, 1250, 275), fill=accent + "24")
    draw.ellipse((-250, 1030, 290, 1570), fill=SKY + "18")
    return image


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def cover_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    scale = max(size[0] / image.width, size[1] / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - size[0]) // 2
    top = (resized.height - size[1]) // 2
    return resized.crop((left, top, left + size[0], top + size[1]))


def shadowed_card(content: Image.Image, size: tuple[int, int], radius: int = 34) -> Image.Image:
    resized = content.resize(size, Image.Resampling.LANCZOS).convert("RGBA")
    mask = rounded_mask(size, radius)
    card = Image.new("RGBA", size, (0, 0, 0, 0))
    card.paste(resized, (0, 0), mask)

    margin = 30
    layer = Image.new("RGBA", (size[0] + margin * 2, size[1] + margin * 2), (0, 0, 0, 0))
    shadow = Image.new("L", layer.size, 0)
    ImageDraw.Draw(shadow).rounded_rectangle(
        (margin, margin + 8, margin + size[0], margin + size[1] + 8), radius=radius, fill=95
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    layer.paste((73, 56, 47, 58), (0, 0), shadow)
    layer.alpha_composite(card, (margin, margin))
    return layer


def paste_rotated(base: Image.Image, layer: Image.Image, xy: tuple[int, int], angle: float) -> None:
    rotated = layer.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    base.alpha_composite(rotated, xy)


def fade_image_top(base: Image.Image, box: tuple[int, int, int, int]) -> None:
    """Fade the top of an image card into the ivory page background."""
    left, top, right, bottom = box
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    height = max(1, bottom - top)
    for y in range(top, bottom):
        progress = (y - top) / height
        alpha = round(255 * (1 - progress) ** 1.7)
        draw.line((left, y, right, y), fill=(255, 249, 240, alpha), width=1)
    base.alpha_composite(overlay)


def draw_logo(base: Image.Image) -> None:
    icon = Image.open(ASSETS / "jeju-irang-app-icon.png").convert("RGB").resize((58, 58), Image.Resampling.LANCZOS)
    base.paste(icon, (62, 45), rounded_mask(icon.size, 14))
    ImageDraw.Draw(base).text((132, 43), "제주아이랑", font=font(LOGO_FONT, 47), fill=ORANGE)


def draw_footer(base: Image.Image, index: int) -> None:
    draw = ImageDraw.Draw(base)
    text = f"{index} / 4"
    f = font(BODY_BOLD, 20)
    box = draw.textbbox((0, 0), text, font=f)
    draw.text((1015 - (box[2] - box[0]), 1304), text, font=f, fill="#8C7D75")


def app_screen(number: int) -> Image.Image:
    names = {2: "02-start.png", 3: "03-filter.png", 4: "04-detail-save.png", 5: "05-favorites.png"}
    source = Image.open(OLD / names[number]).convert("RGB")
    return source.crop((55, 335, 1025, 1295))


def make_cover() -> None:
    base = canvas(PINK)
    draw_logo(base)

    family = Image.open(ASSETS / "welcome-family-jeju.png").convert("RGB")
    family = cover_resize(family, (970, 500))
    family_card = shadowed_card(family, (970, 500), radius=48)
    paste_rotated(base, family_card, (25, 790), 0.0)
    fade_image_top(base, (55, 810, 1025, 930))

    draw = ImageDraw.Draw(base)
    cover_lines = [
        ("오늘", 178, ORANGE),
        ("아이랑", 148, BROWN),
        ("어디 갈까요?", 132, BROWN),
    ]
    line_top = 148
    line_gap = 20
    for text, size, color in cover_lines:
        line_font = font(COVER_TITLE_FONT, size)
        box = draw.textbbox((0, 0), text, font=line_font, stroke_width=1)
        glyph_height = box[3] - box[1]
        y = line_top - box[1]
        draw.text((68, y), text, font=line_font, fill=color, stroke_width=1, stroke_fill=color)
        line_top += glyph_height + line_gap

    draw.text((74, 650), "우리 가족에게 맞는 제주 나들이 장소를", font=font(BODY_BOLD, 31), fill=BROWN)
    draw.text((74, 694), "쉽고 빠르게 찾아보세요.", font=font(BODY_BOLD, 31), fill=BROWN)
    draw.rounded_rectangle((72, 746, 372, 814), radius=32, fill=ORANGE)
    draw.text((116, 762), "제주아이랑 시작하기", font=font(BODY_EXTRA, 25), fill="white")
    draw.rounded_rectangle((60, 1262, 500, 1326), radius=32, fill=(255, 249, 240, 242), outline=ORANGE, width=3)
    draw.text((84, 1278), "옆으로 넘겨 사용법을 확인해 보세요  →", font=font(BODY_BOLD, 21), fill=BROWN)
    base.convert("RGB").save(OUT / "01-cover.png", quality=96)


def make_step(
    output_index: int,
    source_index: int,
    title: str,
    subtitle: str,
    accent: str,
    angle: float,
    x: int,
    y: int,
) -> None:
    base = canvas(accent)
    draw_logo(base)
    draw = ImageDraw.Draw(base)

    circle_y = 137
    draw.ellipse((62, circle_y, 138, circle_y + 76), fill=accent)
    number_font = font(BODY_EXTRA, 32)
    number = f"{output_index:02d}"
    number_box = draw.textbbox((0, 0), number, font=number_font)
    draw.text((100 - (number_box[2] - number_box[0]) / 2, circle_y + 16), number, font=number_font, fill="white")

    title_font = fit_font(STEP_TITLE_FONT, title, 98, 70, 850)
    title_box = draw.textbbox((0, 0), title, font=title_font, stroke_width=1)
    title_y = circle_y + (76 - (title_box[3] - title_box[1])) / 2 - title_box[1]
    draw.text((158, title_y), title, font=title_font, fill=BROWN, stroke_width=1, stroke_fill=BROWN)

    subtitle_font = fit_font(BODY_BOLD, subtitle, 35, 27, 950)
    draw.text((64, 244), subtitle, font=subtitle_font, fill=BROWN)
    draw.rounded_rectangle((64, 296, 400, 303), radius=4, fill=accent)

    screen = app_screen(source_index)
    card = shadowed_card(screen, (970, 960), radius=36)
    paste_rotated(base, card, (x, y), angle)
    draw_footer(base, output_index)

    names = {1: "02-start.png", 2: "03-filter.png", 3: "04-detail-save.png", 4: "05-favorites.png"}
    base.convert("RGB").save(OUT / names[output_index], quality=96)


def make_preview() -> None:
    names = ["01-cover.png", "02-start.png", "03-filter.png", "04-detail-save.png", "05-favorites.png"]
    thumb_w, thumb_h, gap = 270, 338, 14
    preview = Image.new("RGB", (thumb_w * 5 + gap * 6, thumb_h + gap * 2), "#EDE5DC")
    for index, name in enumerate(names):
        slide = Image.open(OUT / name).convert("RGB").resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        preview.paste(slide, (gap + index * (thumb_w + gap), gap))
    preview.save(OUT / "carousel-preview.png", quality=95)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    make_cover()
    make_step(1, 2, "닉네임으로 시작", "닉네임과 비밀번호만 입력하면 준비 끝!", ORANGE, -0.45, 25, 315)
    make_step(2, 3, "우리 가족 조건 선택", "원하는 조건을 여러 개 골라 우리 가족에게 맞는 장소를 찾아요.", MINT, 0.35, 24, 316)
    make_step(3, 4, "상세정보 확인하고 저장", "방문 전 필요한 정보를 확인하고 마음에 드는 장소를 저장해요.", YELLOW, -0.3, 25, 315)
    make_step(4, 5, "다시 꺼내봐요", "저장한 장소와 우리 가족의 나들이 메모를 한곳에서 확인해요.", PINK, 0.25, 24, 316)
    make_preview()


if __name__ == "__main__":
    main()
