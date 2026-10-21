"""Generate the web favicon and phone icons from one vector design (requires Pillow)."""

from pathlib import Path
import math

from PIL import Image, ImageDraw


OUTPUT = Path(__file__).resolve().parents[1] / "web" / "public"
BOLT = [(73, 33), (47, 71), (62, 71), (57, 95), (83, 55), (68, 55)]
SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="background" x2="1" y2="1">
      <stop stop-color="#1c422e"/>
      <stop offset="1" stop-color="#0b1811"/>
    </linearGradient>
    <linearGradient id="energy" x2="1" y2="0">
      <stop stop-color="#77e4a1"/>
      <stop offset="1" stop-color="#ebce7b"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#background)"/>
  <rect x="1" y="1" width="126" height="126" rx="27" fill="none" stroke="#77e4a1" stroke-opacity=".15" stroke-width="2"/>
  <path d="M33.59 94.41 A43 43 0 1 1 94.41 94.41" fill="none" stroke="url(#energy)" stroke-width="7" stroke-linecap="round"/>
  <path d="M73 33 47 71h15l-5 24 26-40H68z" fill="#a3f3bd"/>
</svg>
'''


def render(size, *, maskable=False):
    # Render above target resolution so even the 16 px favicon has smooth edges.
    resolution = max(512, size * 2)
    scale = resolution / 128
    canvas = Image.new("RGBA", (resolution, resolution))
    pixels = canvas.load()
    for y in range(resolution):
        for x in range(resolution):
            fraction = (x + y) / (2 * (resolution - 1))
            pixels[x, y] = tuple(round(a + (b - a) * fraction) for a, b in
                                 zip((28, 66, 46), (11, 24, 17))) + (255,)
    if not maskable:
        mask = Image.new("L", canvas.size)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, resolution - 1, resolution - 1), radius=28 * scale, fill=255)
        canvas.putalpha(mask)
    draw = ImageDraw.Draw(canvas)
    if not maskable:
        draw.rounded_rectangle((scale, scale, resolution - scale, resolution - scale),
                               radius=27 * scale, outline=(51, 90, 65), width=round(2 * scale))
    # The dial and bolt fit inside the central 80% safe area of maskable icons.
    for index in range(270):
        angle = math.radians(135 + index)
        end = math.radians(137 + index)
        fraction = (math.cos(angle) + 1) / 2
        color = tuple(round(a + (b - a) * fraction) for a, b in
                      zip((119, 228, 161), (235, 206, 123)))
        draw.line([(scale * (64 + 43 * math.cos(angle)), scale * (64 + 43 * math.sin(angle))),
                   (scale * (64 + 43 * math.cos(end)), scale * (64 + 43 * math.sin(end)))],
                  fill=color, width=round(7 * scale))
    for degrees, color in [(135, (136, 225, 155)), (405, (218, 210, 129))]:
        angle = math.radians(degrees)
        x, y = 64 + 43 * math.cos(angle), 64 + 43 * math.sin(angle)
        draw.ellipse(((x - 3.5) * scale, (y - 3.5) * scale, (x + 3.5) * scale, (y + 3.5) * scale), fill=color)
    draw.polygon([(x * scale, y * scale) for x, y in BOLT], fill="#a3f3bd")
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "icon.svg").write_text(SVG)
    render(64).save(OUTPUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    # Phone platforms apply their own corner masks; supply full-bleed backgrounds.
    for name, size in [("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)]:
        render(size, maskable=True).convert("RGB").save(OUTPUT / name, optimize=True)
    print("Generated SVG, ICO and 180/192/512 px phone icons.")
