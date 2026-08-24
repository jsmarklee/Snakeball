#!/usr/bin/env python3
"""Google Play 그래픽 이미지(feature graphic) 1024×500 — 언어별 1장.

    python3 tools/store_feature_graphic.py <프레임폴더> <출력폴더>

Play 는 이게 **필수**다(없으면 스토어 등록 자체가 안 된다). App Store 에는 대응 필드가 없다.

레이아웃: 왼쪽 카피 / 오른쪽 기기 캡처를 기울여 배치. 1024×500 은 매우 납작해서
세로 스크린샷을 그대로 넣으면 아무것도 안 보인다 — 그래서 상단을 잘라 **볼 행렬과 큐브가
있는 구간만** 남기고 기울인다.

주의: Play 는 이 이미지 위에 재생 버튼·앱 아이콘을 얹을 수 있다. 가장자리 12% 안쪽에는
중요한 것을 두지 않는다.
"""

import math
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from store_screenshots import (  # noqa: E402
    ACCENTS, BG_BOTTOM, BG_TOP, MINT, load_font, rounded,
)

W, H = 1024, 500

# 그래픽 이미지용 한 줄 카피 — 스크린샷 1번 캡션보다 짧아야 한다(가로 폭이 좁다).
TAGLINE = {
    'ko': ('굴려서 부순다', '숫자 큐브 엔드리스 러너'),
    'en': ('Roll. Smash. Repeat.', 'A neon endless runner'),
    'ja': ('転がして、砕く', 'ネオンのエンドレスランナー'),
    'zh-Hant': ('滾動、砸碎', '霓虹無盡跑酷'),
}


def build(frame_path, lang, accent):
    # 배경
    strip = Image.new('RGB', (1, H))
    sp = strip.load()
    for y in range(H):
        t = y / (H - 1)
        sp[0, y] = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
    canvas = strip.resize((W, H), Image.BILINEAR)

    glow = Image.new('RGB', (W, H), (0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse([W * 0.45, -H * 0.6, W * 1.35, H * 1.4],
              fill=tuple(int(c * 0.20) for c in accent))
    g.ellipse([-W * 0.25, H * 0.4, W * 0.35, H * 1.6],
              fill=tuple(int(c * 0.10) for c in ACCENTS[2]))
    canvas = ImageChops.add(canvas, glow.filter(ImageFilter.GaussianBlur(110)))

    # 기기 캡처 — 액션 구간만 잘라 기울인다.
    # 카드 폭은 **회전 후 높이가 캔버스에 들어가도록 역산**한다. 폭을 고정하면 기울인 순간
    # 위아래가 잘려 나가 사고처럼 보인다(처음에 그렇게 나왔다).
    shot = Image.open(frame_path).convert('RGB')
    crop = shot.crop((0, int(shot.height * 0.20), shot.width, int(shot.height * 0.82)))
    ratio = crop.height / crop.width
    angle = 11
    rad = math.radians(angle)
    target_h = H - 40                       # 위아래 20px 씩 여백
    card_w = int(target_h / (math.sin(rad) + ratio * math.cos(rad)))
    card = crop.resize((card_w, round(card_w * ratio)), Image.LANCZOS)
    card = rounded(card, 26)
    card = card.rotate(-angle, resample=Image.BICUBIC, expand=True)

    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px, py = W - card.width + 40, (H - card.height) // 2
    shadow.paste(Image.new('RGBA', card.size, (0, 0, 0, 150)), (px, py + 8), card)
    canvas = Image.alpha_composite(
        canvas.convert('RGBA'), shadow.filter(ImageFilter.GaussianBlur(22)))
    canvas.alpha_composite(card, (px, py))

    # 카피 — 좌측. Play 오버레이를 피해 가장자리에서 충분히 띄운다.
    d = ImageDraw.Draw(canvas)
    head, sub = TAGLINE[lang]
    f1 = load_font(lang, 62)
    f2 = load_font(lang, 27)
    x = 78
    d.text((x, 176), head, font=f1, fill=(255, 255, 255))
    d.text((x, 268), sub, font=f2, fill=tuple(int(c * 0.85) for c in accent))
    d.rounded_rectangle([x, 330, x + 110, 336], radius=3, fill=accent)
    return canvas.convert('RGB')


def main():
    frames_dir, out_dir = sys.argv[1], sys.argv[2]
    import glob
    hit = glob.glob(os.path.join(frames_dir, 'FRAME-*-hero.png'))
    if len(hit) != 1:
        raise SystemExit(f'FRAME-*-hero.png 가 정확히 1장이어야 한다 (찾은 것 {len(hit)}장)')
    for lang in TAGLINE:
        d = os.path.join(out_dir, 'play-feature-graphic')
        os.makedirs(d, exist_ok=True)
        img = build(hit[0], lang, MINT)
        assert img.size == (W, H), img.size
        img.save(os.path.join(d, f'{lang}.png'), optimize=True)
    print(f'✅ 그래픽 이미지 {len(TAGLINE)}장 (1024×500) — {out_dir}/play-feature-graphic/')


if __name__ == '__main__':
    main()
