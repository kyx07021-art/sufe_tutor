"""tools/gen-images.py - M1 landing placeholder image generator (M1-02)

Generates black-background white-digit placeholder images:
- gallery-1..8.png (800x600) for the landing image corridor
- mirror-a.png / mirror-b.png (960x720) for the two mirror sections (M1-10)

Design notes:
- Rounded corners are applied by CSS (--radius-img in base.css); the image files
  themselves are hard-edged rectangles (no baked radius/alpha).
- Uniform 4:3 landscape. 2x supersampled render then LANCZOS downscale for clean
  retina/anti-aliased edges.
- Digit uses the system TrueType bold font (Windows first); ink bounding box is
  centered and binary-fit to avoid overflow.
- Idempotent overwrite; dev-time tool only - the page never references it.

Run: python tools/gen-images.py   (outputs to ../src/assets/img/)
"""
from PIL import Image, ImageDraw, ImageFont
import os

BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "src", "assets", "img"))

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\arialbd.ttf",                        # Windows Arial Bold (primary, bold + legible)
    r"C:\Windows\Fonts\arial.ttf",
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\msyh.ttc",                           # Microsoft YaHei (CJK fallback, digits clear)
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",    # macOS
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # Linux
]

FRAC_W, FRAC_H = 0.70, 0.60   # digit ink bbox max fraction of canvas w/h (bold, never overflowing)

# (filename, digit text, generated width, generated height) - 2x source, CSS display = w/2
SPECS = (
    [(f"gallery-{i}.png", str(i), 800, 600) for i in range(1, 9)]
    + [("mirror-a.png", "9", 960, 720), ("mirror-b.png", "10", 960, 720)]
)


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
    return ImageFont.load_default(size=size)  # Pillow>=10.1 scalable embedded font (anti-aliased)


def fit_font(draw, text, max_w, max_h):
    """Binary search the largest font size whose ink bbox fits max_w x max_h."""
    lo, hi, best = 8, int(max(max_w, max_h) * 3), 8
    while lo <= hi:
        mid = (lo + hi) // 2
        f = load_font(mid)
        bb = draw.textbbox((0, 0), text, font=f)
        if (bb[2] - bb[0]) <= max_w and (bb[3] - bb[1]) <= max_h:
            best, lo = mid, mid + 1
        else:
            hi = mid - 1
    return load_font(best)


def render(fname, w, h, text, ss=2):
    """Render w x h placeholder; ss=2 supersample then downscale for clean edges."""
    W, H = w * ss, h * ss
    img = Image.new("RGB", (W, H), BLACK)
    d = ImageDraw.Draw(img)
    font = fit_font(d, text, W * FRAC_W, H * FRAC_H)
    bb = d.textbbox((0, 0), text, font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    # center the ink box (not the em box) on the canvas
    d.text(((W - tw) / 2 - bb[0], (H - th) / 2 - bb[1]), text, font=font, fill=WHITE)
    img.resize((w, h), Image.LANCZOS).save(os.path.join(OUT, fname), optimize=True)
    print("gen", fname, f"{w}x{h}")


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, text, w, h in SPECS:
        render(name, w, h, text)


if __name__ == "__main__":
    main()
