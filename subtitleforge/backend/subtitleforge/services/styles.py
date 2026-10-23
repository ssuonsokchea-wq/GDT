"""Subtitle styling: the style model, ASS translation and the shipped presets.

One style object drives three consumers: the live preview in the renderer (CSS),
the ASS file handed to libass for burn-in, and the ASS export. They must agree,
so the model is deliberately close to what ASS can express — anything the
renderer can draw that libass cannot would be a promise the export breaks.

Sizes and margins are expressed against a 1920x1080 reference frame and scaled
to the real resolution at render time, so one style looks the same on a 720p
upload and a 4K master.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from typing import Any

REFERENCE_WIDTH = 1920
REFERENCE_HEIGHT = 1080

# Numpad alignment, as in ASS: 1-3 bottom, 4-6 middle, 7-9 top.
ALIGNMENTS = {
    "bottom-left": 1, "bottom-center": 2, "bottom-right": 3,
    "middle-left": 4, "middle-center": 5, "middle-right": 6,
    "top-left": 7, "top-center": 8, "top-right": 9,
}

DEFAULT_STYLE: dict[str, Any] = {
    "fontFamily": "Arial",
    "fontSize": 54,
    "bold": False,
    "italic": False,
    "underline": False,
    "strikeout": False,
    "primaryColor": "#FFFFFF",
    "secondaryColor": "#FFFFFF",
    "outlineColor": "#000000",
    "shadowColor": "#000000",
    "backColor": "#000000",
    "textOpacity": 1.0,
    "outlineOpacity": 1.0,
    "shadowOpacity": 0.6,
    "boxOpacity": 0.0,
    "borderStyle": "outline",        # 'outline' | 'box'
    "outlineWidth": 2.4,
    "shadowDepth": 1.2,
    "alignment": 2,
    "marginLeft": 80,
    "marginRight": 80,
    "marginVertical": 64,
    "letterSpacing": 0.0,
    "scaleX": 100,
    "scaleY": 100,
    "angle": 0.0,
    "uppercase": False,
    "maxCharsPerLine": 42,
    "maxLines": 2,
}

STYLE_PRESETS: list[dict[str, Any]] = [
    {
        **DEFAULT_STYLE,
        "name": "Netflix",
        "description": "Broadcast baseline: white Arial, hairline shadow, two lines, 42 characters.",
        "fontFamily": "Arial",
        "fontSize": 52,
        "outlineWidth": 1.6,
        "shadowDepth": 1.4,
        "shadowOpacity": 0.75,
        "marginVertical": 72,
        "maxCharsPerLine": 42,
        "maxLines": 2,
    },
    {
        **DEFAULT_STYLE,
        "name": "YouTube",
        "description": "The platform's own look: white on a translucent black box, bottom centre.",
        "fontFamily": "Roboto",
        "fontSize": 50,
        "borderStyle": "box",
        "boxOpacity": 0.75,
        "outlineWidth": 0.0,
        "shadowDepth": 0.0,
        "marginVertical": 60,
        "maxCharsPerLine": 40,
    },
    {
        **DEFAULT_STYLE,
        "name": "TikTok",
        "description": "Vertical-first: heavy, centred high, short lines that survive a thumb over the bottom third.",
        "fontFamily": "Montserrat",
        "fontSize": 76,
        "bold": True,
        "uppercase": True,
        "outlineWidth": 5.0,
        "shadowDepth": 0.0,
        "alignment": 5,
        "marginVertical": 0,
        "maxCharsPerLine": 22,
        "maxLines": 2,
        "letterSpacing": 0.5,
    },
    {
        **DEFAULT_STYLE,
        "name": "Documentary",
        "description": "Lower-third interview captions: warm serif, generous margins, one long line.",
        "fontFamily": "Georgia",
        "fontSize": 48,
        "primaryColor": "#F7F3E8",
        "outlineWidth": 1.2,
        "shadowDepth": 2.0,
        "shadowOpacity": 0.8,
        "alignment": 1,
        "marginLeft": 140,
        "marginVertical": 96,
        "maxCharsPerLine": 48,
        "maxLines": 2,
    },
    {
        **DEFAULT_STYLE,
        "name": "Minimalist",
        "description": "No outline, no box: thin type that trusts the grade underneath it.",
        "fontFamily": "Inter",
        "fontSize": 44,
        "outlineWidth": 0.0,
        "shadowDepth": 0.8,
        "shadowOpacity": 0.45,
        "marginVertical": 56,
        "maxCharsPerLine": 44,
        "maxLines": 1,
    },
]

PRESETS_BY_NAME = {preset["name"]: preset for preset in STYLE_PRESETS}


def normalise_style(style: dict | None) -> dict[str, Any]:
    """Fill gaps with defaults and coerce user input into legal ranges."""
    merged = {**DEFAULT_STYLE, **(style or {})}
    alignment = merged.get("alignment", 2)
    if isinstance(alignment, str):
        merged["alignment"] = ALIGNMENTS.get(alignment, 2)
    merged["alignment"] = int(max(1, min(9, int(merged["alignment"]))))
    merged["fontSize"] = float(max(8, min(400, float(merged["fontSize"]))))
    merged["outlineWidth"] = float(max(0, min(20, float(merged["outlineWidth"]))))
    merged["shadowDepth"] = float(max(0, min(20, float(merged["shadowDepth"]))))
    merged["maxLines"] = int(max(1, min(5, int(merged["maxLines"]))))
    merged["maxCharsPerLine"] = int(max(10, min(120, int(merged["maxCharsPerLine"]))))
    for key in ("textOpacity", "outlineOpacity", "shadowOpacity", "boxOpacity"):
        merged[key] = float(max(0.0, min(1.0, float(merged[key]))))
    for key in ("scaleX", "scaleY"):
        merged[key] = int(max(10, min(400, int(merged[key]))))
    if merged.get("borderStyle") not in ("outline", "box"):
        merged["borderStyle"] = "outline"
    return merged


# --------------------------------------------------------------------------
# Colours
# --------------------------------------------------------------------------

_HEX = re.compile(r"^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8}|[0-9a-fA-F]{3})$")


def parse_hex(color: str) -> tuple[int, int, int, float]:
    """Accept #RGB, #RRGGBB and #RRGGBBAA, returning r, g, b and alpha 0-1."""
    match = _HEX.match(color.strip())
    if not match:
        return (255, 255, 255, 1.0)
    digits = match.group(1)
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    red, green, blue = int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16)
    alpha = int(digits[6:8], 16) / 255 if len(digits) == 8 else 1.0
    return red, green, blue, alpha


def to_ass_color(color: str, opacity: float = 1.0) -> str:
    """ASS colours are ``&HAABBGGRR`` — reversed channels, inverted alpha."""
    red, green, blue, hex_alpha = parse_hex(color)
    alpha = max(0.0, min(1.0, opacity * hex_alpha))
    ass_alpha = int(round((1.0 - alpha) * 255))
    return f"&H{ass_alpha:02X}{blue:02X}{green:02X}{red:02X}"


def to_css_color(color: str, opacity: float = 1.0) -> str:
    red, green, blue, hex_alpha = parse_hex(color)
    alpha = max(0.0, min(1.0, opacity * hex_alpha))
    return f"rgba({red}, {green}, {blue}, {round(alpha, 3)})"


# --------------------------------------------------------------------------
# ASS emission
# --------------------------------------------------------------------------


def scale_factor(play_res: tuple[int, int]) -> float:
    return (play_res[1] or REFERENCE_HEIGHT) / REFERENCE_HEIGHT


def ass_header_defaults(*, title: str, width: int, height: int, style: dict) -> str:
    return "\n".join(
        [
            "[Script Info]",
            f"Title: {title}",
            "ScriptType: v4.00+",
            # WrapStyle 0 keeps libass's own balanced wrapping; we pre-wrap text
            # anyway, so this only matters for cues edited outside the app.
            "WrapStyle: 0",
            "YCbCr Matrix: TV.709",
            "ScaledBorderAndShadow: yes",
            f"PlayResX: {width}",
            f"PlayResY: {height}",
            "",
        ]
    )


def ass_style_line(name: str, style: dict, play_res: tuple[int, int] = (REFERENCE_WIDTH, REFERENCE_HEIGHT)) -> str:
    spec = normalise_style(style)
    factor = scale_factor(play_res)
    border_style = 3 if spec["borderStyle"] == "box" else 1
    # In box mode libass paints BackColour as the box, so the box opacity has to
    # land on BackColour; in outline mode the same field is the shadow colour.
    if border_style == 3:
        back = to_ass_color(spec["backColor"], spec["boxOpacity"] or 0.75)
        outline_width = max(spec["outlineWidth"], 0.0)
    else:
        back = to_ass_color(spec["shadowColor"], spec["shadowOpacity"])
        outline_width = spec["outlineWidth"]
    fields = [
        name,
        spec["fontFamily"],
        f"{spec['fontSize'] * factor:.0f}",
        to_ass_color(spec["primaryColor"], spec["textOpacity"]),
        to_ass_color(spec["secondaryColor"], spec["textOpacity"]),
        to_ass_color(spec["outlineColor"], spec["outlineOpacity"]),
        back,
        "-1" if spec["bold"] else "0",
        "-1" if spec["italic"] else "0",
        "-1" if spec["underline"] else "0",
        "-1" if spec["strikeout"] else "0",
        str(spec["scaleX"]),
        str(spec["scaleY"]),
        f"{spec['letterSpacing'] * factor:.2f}",
        f"{spec['angle']:.1f}",
        str(border_style),
        f"{outline_width * factor:.2f}",
        f"{spec['shadowDepth'] * factor:.2f}",
        str(spec["alignment"]),
        f"{spec['marginLeft'] * factor:.0f}",
        f"{spec['marginRight'] * factor:.0f}",
        f"{spec['marginVertical'] * factor:.0f}",
        "1",
    ]
    return "Style: " + ",".join(fields)


def to_css(style: dict, container_height: int = REFERENCE_HEIGHT) -> dict:
    """The same style as CSS, for the renderer's live preview overlay."""
    spec = normalise_style(style)
    factor = container_height / REFERENCE_HEIGHT
    layers = []
    if spec["outlineWidth"] > 0:
        width = spec["outlineWidth"] * factor
        color = to_css_color(spec["outlineColor"], spec["outlineOpacity"])
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, -1), (-1, 1), (1, 1)):
            layers.append(f"{dx * width:.2f}px {dy * width:.2f}px 0 {color}")
    if spec["shadowDepth"] > 0 and spec["borderStyle"] == "outline":
        depth = spec["shadowDepth"] * factor
        layers.append(f"{depth:.2f}px {depth:.2f}px {depth * 1.5:.2f}px {to_css_color(spec['shadowColor'], spec['shadowOpacity'])}")
    vertical = spec["alignment"] in (1, 2, 3) and "flex-end" or (spec["alignment"] in (4, 5, 6) and "center" or "flex-start")
    horizontal = {1: "flex-start", 4: "flex-start", 7: "flex-start",
                  2: "center", 5: "center", 8: "center",
                  3: "flex-end", 6: "flex-end", 9: "flex-end"}[spec["alignment"]]
    return {
        "fontFamily": f'"{spec["fontFamily"]}", "Helvetica Neue", Arial, sans-serif',
        "fontSize": f"{spec['fontSize'] * factor:.2f}px",
        "fontWeight": "700" if spec["bold"] else "400",
        "fontStyle": "italic" if spec["italic"] else "normal",
        "textDecoration": "underline" if spec["underline"] else "none",
        "color": to_css_color(spec["primaryColor"], spec["textOpacity"]),
        "textShadow": ", ".join(layers) if layers else "none",
        "backgroundColor": to_css_color(spec["backColor"], spec["boxOpacity"]) if spec["borderStyle"] == "box" else "transparent",
        "letterSpacing": f"{spec['letterSpacing'] * factor:.2f}px",
        "textTransform": "uppercase" if spec["uppercase"] else "none",
        "padding": f"{0.18 * spec['fontSize'] * factor:.2f}px {0.45 * spec['fontSize'] * factor:.2f}px" if spec["borderStyle"] == "box" else "0",
        "justifyContent": vertical,
        "alignItems": horizontal,
        "marginLeft": f"{spec['marginLeft'] * factor:.2f}px",
        "marginRight": f"{spec['marginRight'] * factor:.2f}px",
        "marginBottom": f"{spec['marginVertical'] * factor:.2f}px" if spec["alignment"] in (1, 2, 3) else "0",
        "marginTop": f"{spec['marginVertical'] * factor:.2f}px" if spec["alignment"] in (7, 8, 9) else "0",
        "transform": f"rotate({-spec['angle']:.1f}deg)" if spec["angle"] else "none",
    }


# --------------------------------------------------------------------------
# Fonts
# --------------------------------------------------------------------------

_font_cache: list[str] | None = None

BUNDLED_FONTS = ["Inter", "Roboto", "Montserrat", "Open Sans", "Noto Sans"]


def list_fonts(refresh: bool = False) -> list[str]:
    """Fonts libass can actually find.

    A style naming a font the render machine lacks silently falls back, and the
    user discovers it only in the output file. Listing real families lets the UI
    mark a missing one before a two-hour render.
    """
    global _font_cache
    if _font_cache is not None and not refresh:
        return _font_cache
    families: set[str] = set()
    if sys.platform.startswith("win"):
        for directory in (Path("C:/Windows/Fonts"), Path.home() / "AppData/Local/Microsoft/Windows/Fonts"):
            if directory.exists():
                for font in directory.glob("*.tt*"):
                    families.add(font.stem.replace("_", " "))
    else:
        try:
            out = subprocess.run(
                ["fc-list", "--format", "%{family[0]}\\n"], capture_output=True, text=True, timeout=15
            ).stdout
            families.update(line.strip() for line in out.splitlines() if line.strip())
        except Exception:
            pass
        for directory in (Path("/System/Library/Fonts"), Path.home() / "Library/Fonts", Path("/usr/share/fonts")):
            if directory.exists():
                for font in directory.rglob("*.tt*"):
                    families.add(font.stem.replace("_", " "))
    families.update(BUNDLED_FONTS)
    _font_cache = sorted(families)
    return _font_cache
