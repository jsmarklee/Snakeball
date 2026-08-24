#!/usr/bin/env python3
"""스토어 스크린샷 합성기 — 기기 캡처 5장 × 4개 언어 × 2개 스토어 규격.

    python3 tools/store_screenshots.py <프레임폴더> <출력폴더>

프레임폴더에는 시뮬레이터에서 찍은 1320×2868 PNG 5장이 FRAME-{1..5}-*.png 이름으로 있어야
한다. 게임 UI 자체는 영어 전용(i18n 은 런치 이후 과제)이라, 현지화는 **캡션 오버레이**로 한다.
스토어 스크린샷에서 표준 관행이고, 앱 화면을 조작하지 않으므로 App Store 2.3.3 을 위반하지 않는다.

규격
  App Store 6.9"  1320×2868  (iPhone 17 Pro Max = 440×956pt @3x)
  Google Play     1080×1920  (9:16 — Play 가 요구하는 비율 범위 안)

폰트 — macOS 기본 탑재만 쓴다. 번들 폰트를 레포에 넣지 않기 위해서다.
  ko  Apple SD Gothic Neo ExtraBold
  ja  BIZ UDGothic Bold           (한자 자형이 일본식이어야 한다. PingFang 으로 대체 금지)
  zh-Hant  PingFang TC Semibold   (대만·홍콩 공용. 본토 SC 자형과 다르므로 인덱스 주의)
  en  Helvetica Neue Bold
"""

import glob
import os
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

# ── 폰트 ────────────────────────────────────────────────────────────────────
PINGFANG = glob.glob('/System/Library/AssetsV2/**/PingFang.ttc', recursive=True)
BIZUD = glob.glob('/System/Library/AssetsV2/**/BIZ_UDGothic.ttc', recursive=True)

FONTS = {
    'ko': ('/System/Library/Fonts/AppleSDGothicNeo.ttc', 14),   # ExtraBold
    'ja': (BIZUD[0] if BIZUD else None, 1),                     # Bold
    'zh-Hant': (PINGFANG[0] if PINGFANG else None, 10),         # TC Semibold
    'en': ('/System/Library/Fonts/HelveticaNeue.ttc', 1),       # Bold
}

# ── 카피 ────────────────────────────────────────────────────────────────────
# 스토어 노출 순서. **파일명 정렬순이 아니라 이 목록이 순서다** — 캡처는 편한 순서로 찍고
# 서사 순서는 여기서 정한다. 둘을 파일명으로 묶었더니 캡션이 엉뚱한 화면에 붙은 적이 있다.
ORDER = ['hero', 'mega', 'shop', 'rank', 'menu']

# 아래 CAPTIONS 의 5개 항목은 ORDER 와 1:1 로 대응한다.
# 앱 이름은 아직 미정이라 카피에 이름을 넣지 않았다. 이름이 정해져도 이 파일은 그대로 쓴다.
CAPTIONS = {
    'ko': [
        '공을 굴려\n숫자를 부순다',
        '모을수록\n강해진다',
        '네온 스킨으로\n갈아입기',
        '전 세계 랭킹에\n도전',
        '3초면 시작\n한 손이면 충분',
    ],
    'en': [
        'Roll.\nSmash. Repeat.',
        'The bigger the ball,\nthe bigger the break',
        'Dress your ball\nin neon',
        'Climb the\nworldwide ranks',
        'One hand.\nOne tap. Go.',
    ],
    'ja': [
        '転がして、\n数字を砕く',
        '集めるほど、\n強くなる',
        'ネオンスキンで\n着せ替え',
        '世界ランキングに\n挑戦',
        '片手で、\n3秒で始まる',
    ],
    'zh-Hant': [
        '滾動吧，\n砸碎所有數字',
        '球越大，\n破壞力越強',
        '換上霓虹造型',
        '挑戰全球排行榜',
        '單手操作，\n三秒開始',
    ],
}

# 게임 팔레트에서 그대로 가져온 색 — 스크린샷과 배경이 따로 놀지 않게.
BG_TOP = (10, 10, 26)
BG_BOTTOM = (22, 20, 58)
MINT = (99, 248, 207)
GOLD = (255, 210, 63)
ACCENTS = [MINT, GOLD, (197, 108, 240), (255, 159, 67), MINT]

SPECS = [
    # (이름, 캔버스W, 캔버스H, 스샷폭, 캡션시작Y, 폰트크기, 줄간격)
    ('appstore-6.9', 1320, 2868, 1000, 150, 78, 1.30),
    ('play-phone', 1080, 1920, 750, 52, 56, 1.28),
]


def load_font(lang, size):
    path, idx = FONTS[lang]
    if not path or not os.path.exists(path):
        raise SystemExit(f'{lang} 폰트를 찾지 못했다: {path}')
    return ImageFont.truetype(path, size, index=idx)


def gradient_bg(w, h, accent):
    """세로 그라디언트 + 상단 악센트 글로우 + 하단 보조 글로우를 더해 한 장으로 돌려준다."""
    # 그라디언트는 1px 폭으로 그린 뒤 늘린다 — h 번 line() 을 도는 것보다 훨씬 빠르다.
    strip = Image.new('RGB', (1, h))
    sp = strip.load()
    for y in range(h):
        t = y / max(1, h - 1)
        sp[0, y] = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
    bg = strip.resize((w, h), Image.BILINEAR)

    glow = Image.new('RGB', (w, h), (0, 0, 0))
    g = ImageDraw.Draw(glow)
    r = int(w * 0.62)
    g.ellipse([-r // 3, -r, w + r // 3, r // 2],
              fill=tuple(int(c * 0.16) for c in accent))
    g.ellipse([w - r, h - r // 2, w + r // 2, h + r // 2],
              fill=tuple(int(c * 0.10) for c in ACCENTS[2]))
    glow = glow.filter(ImageFilter.GaussianBlur(w // 7))
    return ImageChops.add(bg, glow)


def rounded(img, radius):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1],
                                           radius=radius, fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def compose(frame_path, caption, lang, spec, accent):
    name, W, H, shot_w, cap_y, fsize, lh = spec
    canvas = gradient_bg(W, H, accent)

    # 캡션
    d = ImageDraw.Draw(canvas)
    font = load_font(lang, fsize)
    lines = caption.split('\n')
    line_h = int(fsize * lh)
    y = cap_y
    for i, line in enumerate(lines):
        bbox = d.textbbox((0, 0), line, font=font)
        tw = bbox[2] - bbox[0]
        x = (W - tw) // 2 - bbox[0]
        # 글로우 → 본문 (네온 톤을 캡션에도)
        d.text((x, y + 3), line, font=font, fill=tuple(int(c * 0.35) for c in accent))
        d.text((x, y), line, font=font, fill=(255, 255, 255))
        y += line_h

    # 악센트 바
    bar_y = cap_y + line_h * len(lines) + int(fsize * 0.30)
    bar_w = int(W * 0.10)
    d.rounded_rectangle([(W - bar_w) // 2, bar_y, (W + bar_w) // 2, bar_y + max(4, W // 200)],
                        radius=W // 200, fill=accent)

    # 기기 캡처
    shot = Image.open(frame_path).convert('RGB')
    sh = round(shot.height * shot_w / shot.width)
    shot = shot.resize((shot_w, sh), Image.LANCZOS)
    radius = int(shot_w * 0.055)
    shot = rounded(shot, radius)

    top = bar_y + int(fsize * 0.85)
    if top + sh > H - int(H * 0.02):          # 캔버스를 넘으면 아래를 맞추고 위로 민다
        top = H - int(H * 0.02) - sh
    left = (W - shot_w) // 2

    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [left, top + 10, left + shot_w, top + sh + 10], radius=radius, fill=(0, 0, 0, 170))
    shadow = shadow.filter(ImageFilter.GaussianBlur(W // 45))
    canvas = Image.alpha_composite(canvas.convert('RGBA'), shadow)
    canvas.alpha_composite(shot, (left, top))

    # 얇은 민트 테두리 — 어두운 스샷이 어두운 배경에 묻히는 걸 막는다
    d2 = ImageDraw.Draw(canvas)
    d2.rounded_rectangle([left, top, left + shot_w - 1, top + sh - 1],
                         radius=radius, outline=accent + (90,), width=max(2, W // 500))
    return canvas.convert('RGB')


def main():
    frames_dir, out_dir = sys.argv[1], sys.argv[2]
    frames = []
    for key in ORDER:
        hit = glob.glob(os.path.join(frames_dir, f'FRAME-*-{key}.png'))
        if len(hit) != 1:
            raise SystemExit(f'FRAME-*-{key}.png 가 정확히 1장이어야 한다 (찾은 것 {len(hit)}장)')
        frames.append(hit[0])
    for lang, caps in CAPTIONS.items():
        if len(caps) != len(ORDER):
            raise SystemExit(f'{lang} 카피가 {len(caps)}개 — ORDER({len(ORDER)}개)와 어긋난다')
    made = 0
    for lang, caps in CAPTIONS.items():
        for spec in SPECS:
            d = os.path.join(out_dir, spec[0], lang)
            os.makedirs(d, exist_ok=True)
            for i, (frame, cap) in enumerate(zip(frames, caps), 1):
                img = compose(frame, cap, lang, spec, ACCENTS[i - 1])
                img.save(os.path.join(d, f'{i:02d}.png'), optimize=True)
                made += 1
    print(f'✅ {made}장 생성 — {out_dir}')
    print(f'   언어 {len(CAPTIONS)} × 규격 {len(SPECS)} × 프레임 5')


if __name__ == '__main__':
    main()
