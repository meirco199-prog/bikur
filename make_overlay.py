#!/usr/bin/env python3
"""Create PNG overlay images for the business card video."""
from PIL import Image, ImageDraw, ImageFont
from bidi.algorithm import get_display
import os

W, H = 576, 1024
OUT = "/home/user/bikur/video_work"
os.makedirs(OUT, exist_ok=True)

BOLD_FONT = "/usr/share/fonts/truetype/noto/NotoSansHebrew-CondensedExtraBold.ttf"
REG_FONT  = "/usr/share/fonts/truetype/noto/NotoSansHebrew-SemiCondensedExtraLight.ttf"
ORANGE    = (249, 115, 22, 255)
WHITE     = (255, 255, 255, 255)
BLACK_0   = (0, 0, 0, 0)


def rtl(text):
    return get_display(text)


def make_gradient_bar():
    """Semi-transparent dark gradient bar for the bottom."""
    img = Image.new("RGBA", (W, H), BLACK_0)
    draw = ImageDraw.Draw(img)
    # gradient from transparent to semi-dark from y=580 to y=1024
    for y in range(580, H):
        alpha = int(210 * ((y - 580) / (H - 580)) ** 0.7)
        draw.line([(0, y), (W, y)], fill=(10, 10, 10, alpha))
    return img


def make_text_layer():
    """Text overlay: name + title + tagline."""
    img = Image.new("RGBA", (W, H), BLACK_0)
    draw = ImageDraw.Draw(img)

    # Orange accent line
    draw.rectangle([(40, 800), (W - 40, 804)], fill=ORANGE)

    # Company tag (small, orange, uppercase)
    tag_font = ImageFont.truetype(BOLD_FONT, 22)
    tag_text = rtl("יהב ביטוח ופיננסים")
    tag_bbox = draw.textbbox((0, 0), tag_text, font=tag_font)
    tag_w = tag_bbox[2] - tag_bbox[0]
    draw.text(((W - tag_w) / 2, 815), tag_text, font=tag_font, fill=ORANGE)

    # Main name
    name_font = ImageFont.truetype(BOLD_FONT, 68)
    name_text = rtl("מאיר כהן")
    name_bbox = draw.textbbox((0, 0), name_text, font=name_font)
    name_w = name_bbox[2] - name_bbox[0]
    draw.text(((W - name_w) / 2, 848), name_text, font=name_font, fill=WHITE)

    # Title / role
    title_font = ImageFont.truetype(REG_FONT, 28)
    title_text = rtl("סוכן ביטוח | ייעוץ פיננסי | תכנון פרישה")
    title_bbox = draw.textbbox((0, 0), title_text, font=title_font)
    title_w = title_bbox[2] - title_bbox[0]
    draw.text(((W - title_w) / 2, 930), title_text, font=title_font, fill=(200, 200, 200, 255))

    return img


def make_top_badge():
    """Subtle top-left orange dot badge."""
    img = Image.new("RGBA", (W, H), BLACK_0)
    draw = ImageDraw.Draw(img)
    # thin orange top bar
    draw.rectangle([(0, 0), (W, 6)], fill=ORANGE)
    return img


def make_vignette():
    """Black vignette overlay."""
    img = Image.new("RGBA", (W, H), BLACK_0)
    draw = ImageDraw.Draw(img)
    cx, cy = W // 2, H // 2
    max_r = ((cx**2 + cy**2) ** 0.5)
    for r in range(int(max_r), 0, -1):
        alpha = int(140 * ((r / max_r) ** 2))
        draw.ellipse(
            [cx - r, cy - r, cx + r, cy + r],
            fill=(0, 0, 0, 0),
            outline=(0, 0, 0, max(0, 140 - alpha))
        )
    # Simpler: radial vignette via layered rectangles from edges
    for i in range(80):
        a = int(i * 1.8)
        draw.rectangle([i, i, W - i, H - i], outline=(0, 0, 0, a))
    return img


# Compose all layers
gradient = make_gradient_bar()
text     = make_text_layer()
badge    = make_top_badge()
vignette = make_vignette()

# Full overlay (gradient + text + badge + vignette)
overlay = Image.new("RGBA", (W, H), BLACK_0)
overlay = Image.alpha_composite(overlay, vignette)
overlay = Image.alpha_composite(overlay, gradient)
overlay = Image.alpha_composite(overlay, badge)
overlay = Image.alpha_composite(overlay, text)

overlay.save(f"{OUT}/overlay_full.png")
print(f"Saved {OUT}/overlay_full.png")

# Also save just the vignette+badge for always-on
always_on = Image.new("RGBA", (W, H), BLACK_0)
always_on = Image.alpha_composite(always_on, vignette)
always_on = Image.alpha_composite(always_on, badge)
always_on.save(f"{OUT}/overlay_always.png")
print(f"Saved {OUT}/overlay_always.png")
