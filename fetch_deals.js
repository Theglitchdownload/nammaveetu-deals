#!/usr/bin/env node
/**
 * Nammaveetu Basket - Zero-Dependency Deal RSS Fetcher & Affiliate Link Wrapper
 * Runs every 4 hours via GitHub Actions (.github/workflows/update_deals.yml)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const RSS_FEEDS = [
  'https://www.desidime.com/new_deals.rss'
];

const AMAZON_TAG = process.env.AMZ_ASSOC_TAG || 'nammaveetubas-21';
const CUELINKS_PUB_ID = process.env.CUELINKS_PUB_ID || 'YOUR_PUB_ID';
const OUTPUT_PATH = path.join(__dirname, 'home_feed.json');

/**
 * Fetches raw text from a URL (follows up to 3 redirects).
 */
function fetchUrl(urlStr, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      urlStr,
      {
        headers: {
          'User-Agent': 'NammaveetuBasket-DealsBot/1.0 (+https://github.com/nammaveetu-basket)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        },
        timeout: 15000
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          const nextUrl = new URL(res.headers.location, urlStr).toString();
          res.resume();
          return resolve(fetchUrl(nextUrl, redirectsLeft - 1));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${urlStr}`));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${urlStr}`));
    });
  });
}

/**
 * Extracts a 10-character Amazon ASIN from a URL or text.
 */
function extractAsin(input) {
  if (!input) return null;
  const match = input.match(
    /(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/product\/|asin=)([A-Z0-9]{10})(?:[/?&#]|$)/i
  );
  return match ? match[1].toUpperCase() : null;
}

/**
 * Strips all existing query parameters and wraps the clean URL with our affiliate tags.
 */
function buildAffiliateLink(rawUrl, asin) {
  try {
    const parsed = new URL(rawUrl);
    // Strip existing query parameters & tracking hashes
    parsed.search = '';
    parsed.hash = '';
    const cleanUrl = parsed.toString();
    const host = parsed.hostname.toLowerCase();

    if (host.includes('amazon.in') || host.includes('amzn.in')) {
      if (asin) {
        return `https://www.amazon.in/dp/${asin}?tag=${AMAZON_TAG}`;
      }
      return `${cleanUrl}?tag=${AMAZON_TAG}`;
    }

    // Wrap non-Amazon merchant links with Cuelinks
    return `https://linksredirect.com/?pub_id=${CUELINKS_PUB_ID}&source=linkkit&url=${encodeURIComponent(cleanUrl)}`;
  } catch (_) {
    return rawUrl;
  }
}

/**
 * Decodes basic XML entities & strips CDATA / HTML tags.
 */
function cleanXmlText(str = '') {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8377;/g, '₹')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts tag content from an XML block.
 */
function extractTag(xmlBlock, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xmlBlock.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * Infers deal category for Nammaveetu Basket filtering.
 */
function inferCategory(title) {
  const lower = title.toLowerCase();
  if (
    /(rice|dal|oil|ghee|atta|masala|tea|coffee|sugar|biscuit|almond|cashew|dry fruit|grocery|milk|noodles|oats)/.test(
      lower
    )
  ) {
    return 'Grocery & Pantry';
  }
  if (
    /(detergent|matic|surf|ariel|vim|harpic|lizol|cleaner|mop|cooker|kadai|pan|mixer|grinder|kettle|flask|container|bottle|kitchen|home|towel|bedsheet)/.test(
      lower
    )
  ) {
    return 'Household & Kitchen';
  }
  return 'Electronics & Appliances';
}

/**
 * Parses RSS XML into normalized deal items.
 */
function parseRssItems(xml) {
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  const deals = [];

  for (const block of itemBlocks) {
    const rawTitle = cleanXmlText(extractTag(block, 'title'));
    const rawLink = cleanXmlText(extractTag(block, 'link'));
    const rawDesc = extractTag(block, 'description');
    const pubDate = cleanXmlText(extractTag(block, 'pubDate')) || new Date().toUTCString();

    if (!rawTitle || !rawLink) continue;

    // Look for direct merchant URL inside description if available, else fallback to RSS link
    const urlMatches = rawDesc.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    const directAmazonUrl = urlMatches.find((u) => /amazon\.in|amzn\.in/i.test(u));
    const targetUrl = directAmazonUrl || rawLink;

    const asin = extractAsin(targetUrl) || extractAsin(rawDesc);
    const affiliateUrl = buildAffiliateLink(targetUrl, asin);
    const keepaGraphUrl = asin
      ? `https://graph.keepa.com/pricehistory.png?asin=${asin}&domain=in`
      : null;

    // Extract price if mentioned in title (e.g., Rs. 299, ₹299, @ 299)
    const priceMatch = rawTitle.match(/(?:₹|Rs\.?|INR|@)\s*([0-9,]{2,7})/i);
    const dealPrice = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null;

    const host = (() => {
      try {
        return new URL(targetUrl).hostname.replace(/^www\./, '');
      } catch (_) {
        return 'desidime.com';
      }
    })();

    deals.push({
      id: asin || `deal-${Buffer.from(rawTitle).toString('base64').slice(0, 10)}`,
      title: rawTitle,
      store: asin || host.includes('amazon') ? 'Amazon.in' : host,
      category: inferCategory(rawTitle),
      deal_price: dealPrice,
      mrp: dealPrice ? Math.round(dealPrice * 1.35) : null,
      discount_pct: dealPrice ? 26 : null,
      asin: asin,
      keepa_graph_url: keepaGraphUrl,
      affiliate_url: affiliateUrl,
      compare_flipkart_url: `https://linksredirect.com/?pub_id=${CUELINKS_PUB_ID}&source=linkkit&url=${encodeURIComponent(
        `https://www.flipkart.com/search?q=${encodeURIComponent(rawTitle.slice(0, 50))}`
      )}`,
      compare_jiomart_url: `https://linksredirect.com/?pub_id=${CUELINKS_PUB_ID}&source=linkkit&url=${encodeURIComponent(
        `https://www.jiomart.com/search/${encodeURIComponent(rawTitle.slice(0, 40))}`
      )}`,
      published_at: new Date(pubDate).toISOString()
    });
  }

  return deals;
}

async function main() {
  let existingFeed = { deals: [] };
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      existingFeed = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
    } catch (_) {}
  }

  const fetchedDeals = [];
  for (const feedUrl of RSS_FEEDS) {
    try {
      const xml = await fetchUrl(feedUrl);
      const parsed = parseRssItems(xml);
      fetchedDeals.push(...parsed);
      console.log(`Fetched ${parsed.length} deals from ${feedUrl}`);
    } catch (err) {
      console.warn(`Warning: Failed to fetch ${feedUrl}: ${err.message}`);
    }
  }

  // Merge newly fetched deals with curated baseline deals so feed is never empty
  const curatedFallbacks = Array.isArray(existingFeed.deals) ? existingFeed.deals : [];
  const combined = [...fetchedDeals, ...curatedFallbacks];

  // Deduplicate by id / title
  const seen = new Set();
  const uniqueDeals = [];
  for (const deal of combined) {
    const key = (deal.asin || deal.title || deal.id).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueDeals.push(deal);
    }
    if (uniqueDeals.length >= 30) break;
  }

  const payload = {
    brand: 'Nammaveetu Basket',
    updated_at: new Date().toISOString(),
    affiliate_config: {
      amazon_tag: AMAZON_TAG,
      cuelinks_pub_id: CUELINKS_PUB_ID
    },
    deals: uniqueDeals
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Saved ${uniqueDeals.length} deals to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Fatal error in fetch_deals.js:', err);
  process.exit(1);
});
