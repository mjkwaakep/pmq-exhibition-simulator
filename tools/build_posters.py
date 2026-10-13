#!/usr/bin/env python3
"""PMQ 포스터 월 시뮬레이터 — 포스터 데이터 빌드 스크립트

'PMQ Exhibition Work List EP_Selected.numbers' 의 URL 열(everyday-practice.com 작업 페이지)을
사이트의 WordPress REST API 결과와 매칭해서 대표 이미지를 내려받고,
posters/*.jpg (가로 640px) + posters.json 을 만든다.

사용법:  python build_posters.py <worklist.numbers> <out_dir>
필요:    pip install numbers-parser Pillow
"""
import sys, json, io, os, re, time, hashlib, urllib.request
from urllib.parse import unquote, quote, urlsplit, urlunsplit
from concurrent.futures import ThreadPoolExecutor
from numbers_parser import Document
from PIL import Image, ImageSequence

SRC, OUT = sys.argv[1], sys.argv[2]
API = "https://everyday-practice.com/wp-json/wp/v2/posts?per_page=100&page={}&_embed=wp:featuredmedia&_fields=id,link,slug,title,featured_media,_links,_embedded"
UA = {"User-Agent": "Mozilla/5.0 (poster-wall-simulator build script)"}
RATIO_MIN, RATIO_MAX = 0.62, 0.80          # A계열(0.707)에 가까운 세로형 이미지만 포스터로 사용
OUT_W = 640

def get(url, timeout=120):
    p = urlsplit(url)
    url = urlunsplit((p.scheme, p.netloc, quote(unquote(p.path)), p.query, ""))
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read(), r.headers

def all_posts():
    posts, page = {}, 1
    while True:
        try:
            body, hdr = get(API.format(page))
        except Exception:
            break
        arr = json.loads(body)
        if not arr: break
        for p in arr:
            fm = ((p.get("_embedded") or {}).get("wp:featuredmedia") or [None])[0] or {}
            md = fm.get("media_details") or {}
            posts[unquote(p["slug"]).lower()] = dict(src=fm.get("source_url"), w=md.get("width"), h=md.get("height"))
        if page >= int(hdr.get("X-WP-TotalPages", page)): break
        page += 1
    return posts

def slug(u): return unquote(u.strip().rstrip("/").split("/")[-1]).lower()

def fetch(item):
    fn = os.path.join(OUT, "posters", item["file"])
    if os.path.exists(fn): return item, None
    try:
        raw, _ = get(item["src"])
        im = Image.open(io.BytesIO(raw))
        n = getattr(im, "n_frames", 1)
        if n > 1:                                   # 움직이는 GIF → 1/3 지점 프레임
            for i, fr in enumerate(ImageSequence.Iterator(im)):
                if i >= n // 3: im = fr.copy(); break
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255)); bg.paste(im, mask=im.split()[3])
        h = round(bg.height * OUT_W / bg.width)
        bg.resize((OUT_W, h), Image.LANCZOS).save(fn, "JPEG", quality=84, optimize=True)
        return item, None
    except Exception as e:
        return item, str(e)

def main():
    os.makedirs(os.path.join(OUT, "posters"), exist_ok=True)
    posts = all_posts()
    rows = Document(SRC).sheets[0].tables[0].rows(values_only=True)[2:]
    items, skipped = [], []
    for r in rows:
        if not r[3] or r[1] is None: continue
        title = dict(year=int(r[1]), kr=str(r[3]).strip(), en=(str(r[4]).strip() if r[4] and str(r[4]).strip() != "x" else ""), cat=r[5] or "", url=r[6] or "")
        p = posts.get(slug(r[6])) if r[6] else None
        if not p or not p["src"] or not p["h"]:
            skipped.append(dict(title, why="no-image")); continue
        ratio = p["w"] / p["h"]
        if not (RATIO_MIN <= ratio <= RATIO_MAX):
            skipped.append(dict(title, why="ratio %.2f" % ratio)); continue
        fid = hashlib.md5(p["src"].encode()).hexdigest()[:10]
        items.append(dict(title, id=fid, file=fid + ".jpg", src=p["src"], ratio=round(ratio, 4)))
    ok, seen = [], set()
    with ThreadPoolExecutor(6) as ex:
        for it, err in ex.map(fetch, items):
            if err: skipped.append(dict(it, why="download: " + err)); continue
            if it["id"] in seen: continue
            seen.add(it["id"]); it.pop("src"); ok.append(it)
    json.dump(ok, open(os.path.join(OUT, "posters.json"), "w"), ensure_ascii=False, indent=0)
    json.dump(skipped, open(os.path.join(OUT, "posters_skipped.json"), "w"), ensure_ascii=False, indent=1)
    print("posters:", len(ok), "skipped:", len(skipped))

main()
