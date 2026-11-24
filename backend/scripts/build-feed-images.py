#!/usr/bin/env python3
"""Rebuild 1600px feed derivatives from existing photos, without generative edits.

Run with the retained photo archive path; originals remain untouched. Assets are
pinned to exact catalog URLs. Output is bounded to three feed JPEGs and two viewer JPEGs in frontend/public.
No new views, labels, parts or other product details are synthesized.
"""
import argparse
import io
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCES = {
    'product-1787350684119-9h9uobzbd': ('rfx-lenovo-16gb-ddr4-3200-ecc-rdim', 'rfx-lenovo-16gb-ddr4-3200-ecc-rdimm-server-memory-2r__original-01.png'),
    'product-1787350172844-r4hhb2chy': ('rfx-sk-hynix-16gb-ddr4-3200-ecc-rd', 'rfx-sk-hynix-16gb-ddr4-3200-ecc-rdimm-server-memory-__original-01.png'),
    'product-1787350961905-tqcstyq0i': ('rfx-samsung-16gb-ddr4-3200-ecc-rdi', 'rfx-samsung-16gb-ddr4-3200-ecc-rdimm-server-memory-p__original-01.png'),
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--photo-archive', type=Path, required=True)
    args = parser.parse_args()
    # Reuse the archive's XMP insertion so existing AI provenance stays intact.
    import importlib.util
    sys.dont_write_bytecode = True  # keep the retained archive read-only
    spec = importlib.util.spec_from_file_location('archive_images', args.photo_archive / 'tools/make_feed_images.py')
    archive = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(archive)
    output = ROOT / 'frontend/public/feed-images'
    output.mkdir(exist_ok=True)
    for asset, (sku, original) in SOURCES.items():
        with Image.open(args.photo_archive / 'originals-ai-generated-1254' / original) as im:
            picture = archive.trimmed(im.convert('RGB'))
            ratio = min(1480 / picture.width, 1480 / picture.height)
            picture = picture.resize((round(picture.width * ratio), round(picture.height * ratio)), Image.Resampling.LANCZOS)
            if not sku.startswith('rfx-samsung-16gb'):
                detail = io.BytesIO()
                picture.save(detail, 'JPEG', quality=95, subsampling=0, optimize=True)
                (output / f'{sku}-detail-v1.jpg').write_bytes(archive.with_xmp(detail.getvalue()))
            canvas = Image.new('RGB', (1600, 1600), 'white')
            canvas.paste(picture, ((1600 - picture.width) // 2, (1600 - picture.height) // 2))
            data = io.BytesIO()
            canvas.save(data, 'JPEG', quality=95, subsampling=0, optimize=True)
            target = output / f'{sku}-1600-v1.jpg'
            target.write_bytes(archive.with_xmp(data.getvalue()))
            print(asset, target.name, target.stat().st_size)

if __name__ == '__main__':
    main()
