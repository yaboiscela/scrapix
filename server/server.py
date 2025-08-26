from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
from bs4 import BeautifulSoup
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
import re
import time
import json
import os

app = Flask(__name__)
CORS(app)

BRAND_CACHE_FILE = "brand_page_cache.json"

def load_brand_cache():
    if os.path.exists(BRAND_CACHE_FILE):
        with open(BRAND_CACHE_FILE, "r") as f:
            return json.load(f)
    return {}

def save_brand_cache(data):
    with open(BRAND_CACHE_FILE, "w") as f:
        json.dump(data, f, indent=2)

def fetch_with_retry(url, max_retries=3, timeout=10):
    for attempt in range(max_retries):
        try:
            print(f"\U0001F310 Fetching: {url} (Attempt {attempt + 1})")
            response = requests.get(url, timeout=timeout)
            response.raise_for_status()
            return response
        except Exception as e:
            print(f"⚠️ Request failed: {e}")
            time.sleep(1)
    raise Exception(f"Failed to fetch {url} after {max_retries} attempts")

def match_brand_by_strategy(title, brand_keywords, strategy):
    words = title.split()
    first_two_words = " ".join(words[:2])
    for kw in brand_keywords:
        if strategy == 'start' and title.startswith(kw):
            return kw
        elif strategy == 'first_two' and first_two_words.startswith(kw):
            return kw
        elif strategy == 'anywhere' and kw in title:
            return kw
    return None

def scrape_single_product(url):
    try:
        res = fetch_with_retry(url)
        soup = BeautifulSoup(res.text, 'html.parser')

        title = soup.select_one('h1.product_title')
        price_el = soup.select_one('p.price ins .woocommerce-Price-amount') or \
                soup.select_one('p.price .woocommerce-Price-amount')
        price = price_el.get_text(strip=True) if price_el else ""

        desc = soup.select_one('div.woocommerce-product-details__short-description')
        images = [
            img['src']
            for img in soup.select('div.woocommerce-product-gallery__image img')
            if img.get('src') and
            'copy' not in img['src'].lower().split('/')[-1]
        ]

        for img in soup.select('div.woocommerce-product-gallery__image img'):
            src = img.get('src')
            if not src:
                continue
            print(f"🖼 Checking image: {src}")

        category_el = soup.select_one('.product_meta .posted_in a')
        category = category_el.get_text(strip=True).title() if category_el else ""

        brand = title.get_text(strip=True).split()[0] if title else ""

        return {
            "title": title.get_text(strip=True) if title else "",
            "price": price,
            "description": desc.get_text(separator="\n", strip=True) if desc else "",
            "images": images,
            "category": category,
            "brand": brand
        }
    except Exception as e:
        print(f"❌ Failed to scrape product {url}: {e}")
        return None

def scrape_products_stream(base_url, max_pages, brand_keywords, product_keywords):
    base_url = base_url.rstrip('/')
    total_links, matched, scanned = 0, 0, 0
    matched_links = set()
    unused_brands = set(brand_keywords)
    unused_products = set(product_keywords)
    brand_match_patterns = {'start': 0, 'first_two': 0, 'anywhere': 0}
    best_strategy = 'first_two'

    brand_cache = load_brand_cache()
    brand_pages_found = {}

    pages_per_brand = {}
    for brand in brand_keywords:
        if brand in brand_cache:
            pages = brand_cache[brand]
        else:
            pages = list(range(1, max_pages + 1))
        pages_per_brand[brand] = pages

    visited_pages = set()
    page_to_brands = {}

    for brand, pages in pages_per_brand.items():
        for page in pages:
            if page not in page_to_brands:
                page_to_brands[page] = []
            page_to_brands[page].append(brand)

    for page in sorted(page_to_brands.keys()):
        if page in visited_pages:
            continue
        visited_pages.add(page)

        try:
            page_url = f"{base_url}/page/{page}/"
            print(f"\n🔍 Scraping page {page}: {page_url}")
            yield f"data: {json.dumps({'status': 'scraping_page', 'page': page})}\n\n"

            response = fetch_with_retry(page_url)
            soup = BeautifulSoup(response.text, 'html.parser')
            product_cards = soup.select('a.woocommerce-LoopProduct-link')

            if not product_cards:
                print("⚠️ No products found.")
                continue

            for card in product_cards:
                url = card['href']
                title_el = card.select_one('.woocommerce-loop-product__title')
                title_raw = title_el.get_text(strip=True) if title_el else ""
                title = title_raw.lower()
                total_links += 1

                possible_brand = title.split()[0] if title else ""
                if possible_brand:
                    brand_pages_found.setdefault(possible_brand, set()).add(page)

                matched_brand = match_brand_by_strategy(title, brand_keywords, best_strategy)
                matched_product = next((kw for kw in product_keywords if kw in title), None)

                if matched_brand:
                    brand_pages_found.setdefault(matched_brand, set()).add(page)

                    if title.startswith(matched_brand):
                        brand_match_patterns['start'] += 1
                    elif " ".join(title.split()[:2]).startswith(matched_brand):
                        brand_match_patterns['first_two'] += 1
                    elif matched_brand in title:
                        brand_match_patterns['anywhere'] += 1

                if matched_brand or matched_product:
                    if url not in matched_links:
                        matched_links.add(url)
                        if matched_brand:
                            unused_brands.discard(matched_brand)
                        if matched_product:
                            unused_products.discard(matched_product)
                else:
                    print(f"⏩ Skipped: {title}")

            if any(brand_match_patterns.values()):
                best_strategy = max(brand_match_patterns, key=brand_match_patterns.get)
                print(f"📈 Learned brand match strategy ➔ '{best_strategy}'")

        except Exception as e:
            print(f"❌ Page load error: {e}")
            continue

    print(f"\n🔗 Total matched links: {len(matched_links)}")

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(scrape_single_product, url) for url in matched_links]
        for future in as_completed(futures):
            scanned += 1
            result = future.result()
            if result:
                matched += 1
                yield f"data: {json.dumps({'product': result, 'stats': {'scanned': scanned, 'matched': matched, 'total': len(matched_links)}})}\n\n"
            else:
                yield f"data: {json.dumps({'stats': {'scanned': scanned, 'matched': matched, 'total': len(matched_links)}})}\n\n"

    if brand_pages_found:
        for brand, pages in brand_pages_found.items():
            existing = set(brand_cache.get(brand, []))
            brand_cache[brand] = sorted(existing.union(pages))
        save_brand_cache(brand_cache)

    yield f"data: {json.dumps({'summary': {
        'scanned': scanned,
        'matched': matched,
        'total_links': total_links,
        'total_pages': max_pages,
        'unused_brands': list(unused_brands),
        'unused_products': list(unused_products)
    }})}\n\n"

@app.route("/scrape-products")
def scrape_api():
    base_url = request.args.get("base_url")
    page_limit = int(request.args.get("page_limit", 3))
    raw_brands = request.args.get("brands", "")
    raw_products = request.args.get("products", "")

    if not base_url or not base_url.startswith("http"):
        return jsonify({"error": "Invalid or missing base_url"}), 400

    brand_keywords = [k.strip().lower() for k in re.split(r"[,\s]+", raw_brands) if k.strip()]
    product_keywords = [k.strip().lower() for k in raw_products.split('\n') if k.strip()]

    print(f"\n🔧 Filters ➔ Brands: {brand_keywords}, Products: {product_keywords}")

    return Response(
        scrape_products_stream(base_url, page_limit, brand_keywords, product_keywords),
        mimetype='text/event-stream'
    )

@app.route("/proxy-image")
def proxy_image():
    image_url = request.args.get("url")
    if not image_url:
        return "Missing image URL", 400

    try:
        response = fetch_with_retry(image_url)
        content_type = response.headers.get("Content-Type", "image/jpeg")
        return send_file(BytesIO(response.content), mimetype=content_type)
    except Exception as e:
        print(f"❌ Image proxy failed: {e}")
        return f"Image proxy failed: {e}", 500

if __name__ == "__main__":
    app.run(debug=True, port=5000)
