#!/bin/bash
# Generate sitemap.xml from live product data
API="https://reflexity-ram.onrender.com/api/products?limit=200"
OUT="frontend/public/sitemap.xml"

PRODUCTS=$(curl -s "$API" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for p in d.get('products', []):
    print(f'{p[\"slug\"]}|{p.get(\"updatedAt\",\"\")}')
" 2>/dev/null)

TODAY=$(date +%Y-%m-%d)

cat > "$OUT" << 'HEADER'
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
HEADER

# Static pages
for entry in \
  "/|daily|1.0" \
  "/shop|daily|0.9" \
  "/guides|weekly|0.8" \
  "/guides/ddr4-vs-ddr5|monthly|0.7" \
  "/guides/ecc-rdimm-udimm-explained|monthly|0.7" \
  "/guides/how-to-identify-ram|monthly|0.7" \
  "/guides/how-much-ram-do-i-need|monthly|0.7" \
  "/wholesale|monthly|0.6" \
  "/support|monthly|0.5" \
  "/business-info|monthly|0.5" \
  "/shipping|monthly|0.5" \
  "/returns|monthly|0.5" \
  "/warranty|monthly|0.5" \
  "/faq|monthly|0.5" \
  "/privacy|yearly|0.3" \
  "/terms|yearly|0.3"
do
  IFS='|' read -r path freq pri <<< "$entry"
  cat >> "$OUT" << EOF
  <url>
    <loc>https://reflexityram.com${path}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>${freq}</changefreq>
    <priority>${pri}</priority>
  </url>
EOF
done

# Product pages
while IFS='|' read -r slug updated; do
  [ -z "$slug" ] && continue
  lastmod="${updated:0:10}"
  [ -z "$lastmod" ] && lastmod="$TODAY"
  cat >> "$OUT" << EOF
  <url>
    <loc>https://reflexityram.com/shop/${slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
EOF
done <<< "$PRODUCTS"

cat >> "$OUT" << 'FOOTER'
</urlset>
FOOTER

echo "Generated $(grep -c '<url>' "$OUT") URLs in $OUT"
