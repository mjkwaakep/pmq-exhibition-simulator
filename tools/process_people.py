#!/usr/bin/env python3
"""사람 컷아웃 사진을 반투명 실루엣으로 가공한다.

입력: skalgubbar.se 등에서 받은 배경투명 PNG 컷아웃 인물 사진(people_src/*.png)
출력: people/person1.png, person2.png, ... (단색 실루엣 + 반투명 + 가장자리 블러)

사용법:
    python3 tools/process_people.py <입력 폴더> <출력 폴더>

이미지 출처: https://skalgubbar.se — 건축 시각화(미건설 프로젝트)에 사람을 채우는
용도로 무료 사용 가능(학생/상업 모두). 다른 용도로는 쓰지 말 것(사이트의 라이선스 참고).
"""
import glob
import os
import sys

from PIL import Image, ImageFilter

TONES = [(38, 46, 58), (48, 44, 40), (40, 48, 44), (46, 40, 48), (36, 42, 50), (44, 46, 42)]
ALPHA_SCALE = 0.62  # 반투명 정도 (0=완전투명, 1=원본 그대로)
EDGE_BLUR = 1.2      # 실루엣 가장자리를 부드럽게(px)


def main():
    src_dir = sys.argv[1] if len(sys.argv) > 1 else "people_src"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "people"
    os.makedirs(out_dir, exist_ok=True)

    files = sorted(glob.glob(os.path.join(src_dir, "*.png")))
    for i, f in enumerate(files):
        im = Image.open(f).convert("RGBA")
        _, _, _, a = im.split()
        a = a.filter(ImageFilter.GaussianBlur(EDGE_BLUR))
        tone = TONES[i % len(TONES)]
        solid = Image.new("RGBA", im.size, tone + (0,))
        solid.putalpha(a.point(lambda v: int(v * ALPHA_SCALE)))
        out = os.path.join(out_dir, f"person{i + 1}.png")
        solid.save(out)
        print(out, solid.size, "<-", os.path.basename(f))


if __name__ == "__main__":
    main()
