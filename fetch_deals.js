#!/usr/bin/env node
/**
 * Nammaveetu Basket - Amazon Household, Kitchen & Malligai Hot Deals Fetcher
 *
 * 1. Focuses 100% on Amazon.in Household, Kitchen & Malligai deals using ONLY our
 *    Amazon Affiliate ID (`nammaveetubas-21`).
 * 2. Scrapes REAL LIVE Amazon.in prices via `fetchLiveAmazonPrice(asin)` using
 *    Android 14 Chrome Mobile headers (`Accept-Language: en-IN,en;q=0.9`).
 * 3. NEVER invents or guesses fake prices or fake MRPs:
 *    - If live price is verified: sets `"price_verified": true`, `"current_price": <live INR>`,
 *      `"deal_price": <live INR>`, and real `"mrp"` (if > current_price).
 *    - If blocked or unverified: sets `"price_verified": false`, `"current_price": 0`, `"deal_price": 0`.
 * 4. Supports `--cloud-rss-only` (or `GITHUB_ACTIONS=true`) so cloud runs every 4 hours
 *    ONLY append new RSS deals and preserve verified Indian prices already in `home_feed.json`.
 */

const fs = require('fs');
const path = require('path');

const AMAZON_TAG = process.env.AMZ_ASSOC_TAG || 'nammaveetubas-21';
const OUTPUT_PATH = path.join(__dirname, 'home_feed.json');
const MAX_DEALS_TO_RETAIN = 220;
const IS_CLOUD_RSS_ONLY =
  process.argv.includes('--cloud-rss-only') || process.env.CLOUD_RSS_ONLY === 'true';

const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36';
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/**
 * Curated Amazon.in search feeds for the 5 Nammaveetu Basket household categories.
 */
const AMAZON_CATEGORY_QUERIES = [
  // Round 1 (all 5 categories)
  { category: 'Malligai & Groceries', query: 'Tata Sampann Toor Dal Moong Dal Chana Dal Ponni Rice 1kg 5kg' },
  { category: 'Dry Fruits & Oil', query: 'Fortune Sunlite Gold Winner Idhayam Saffola Refined Cooking Oil 1L 5L' },
  { category: 'Cleaning & Home Care', query: 'Surf Excel Ariel Matic Liquid Detergent 2L 3L' },
  { category: 'Kitchen & Cookware', query: 'Prestige Hawkins Pigeon Stainless Steel Pressure Cooker 3L 5L' },
  { category: 'Appliances', query: 'Philips Preethi Prestige Butterfly Mixer Grinder 750W' },
  // Round 2 (all 5 categories)
  { category: 'Malligai & Groceries', query: 'India Gate Daawat Basmati Rice Sona Masoori Ponni Boiled Rice 5kg' },
  { category: 'Dry Fruits & Oil', query: 'Aashirvaad Gowardhan GRB Udaiyam Pure Cow Ghee 500ml 1L' },
  { category: 'Cleaning & Home Care', query: 'Mysore Sandal Cinthol Dettol Pears Dove Santoor Bathing Soap Bodywash' },
  { category: 'Kitchen & Cookware', query: 'Milton Cello Thermosteel Water Bottle Flask Lunch Box' },
  { category: 'Appliances', query: 'Pigeon Prestige Havells Electric Kettle Induction Cooktop' },
  // Round 3 (all 5 categories)
  { category: 'Malligai & Groceries', query: 'Horlicks Boost Bournvita Tata Tea Gold Red Label Bru Filter Coffee' },
  { category: 'Dry Fruits & Oil', query: 'Happilo Farmley California Almonds Badam Cashews Kaju 500g' },
  { category: 'Cleaning & Home Care', query: 'Vim Dishwash Liquid Gel Lizol Floor Cleaner Harpic Bathroom Cleaner' },
  { category: 'Kitchen & Cookware', query: 'Prestige Meyer Hawkins Triply Stainless Steel Kadai Fry Pan Tawa' },
  { category: 'Appliances', query: 'Philips Agaro Inalsa Air Fryer Steam Iron Hand Blender' },
  // Round 4 (all 5 categories)
  { category: 'Malligai & Groceries', query: 'Aashirvaad Atta Sakthi Aachi Everest Masala Maggi Britannia Biscuits' },
  { category: 'Dry Fruits & Oil', query: 'Tata Sampann Vedaka Dry Fruits Pistachios Walnuts Raisins Dates' },
  { category: 'Cleaning & Home Care', query: 'Parachute Indulekha Dabur Hair Oil Dove Tresemme Clinic Plus Shampoo' },
  { category: 'Kitchen & Cookware', query: 'Pigeon Solimo Stainless Steel Kitchen Storage Containers Jar Set' },
  { category: 'Appliances', query: 'Aquaguard Kent Pureit Water Purifier Eureka Forbes Vacuum' }
];

const DESIDIME_AMAZON_SOURCES = [
  'https://www.desidime.com/frontpage_deals.rss',
  'https://www.desidime.com/new_deals.rss',
  'https://www.desidime.com/stores/amazon-india',
  'https://www.desidime.com/stores/amazon-india?page=2',
  'https://www.desidime.com/stores/amazon-india?page=3',
  'https://www.desidime.com/stores/amazon-india?page=4'
];

const TELEGRAM_DEAL_SOURCES = [
  'https://t.me/s/indianlootdeals',
  'https://t.me/s/trickxpert',
  'https://t.me/s/lootdeals'
];

function decodeEntities(str = '') {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#8377;/g, '₹')
    .replace(/&#x20B9;/gi, '₹');
}

function cleanTitle(raw = '') {
  return decodeEntities(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/^Sponsored\s+Ad\s*[-–:]\s*/i, '')
    .replace(/^(?:GRAB|LOOT|Lowest|Hot|Deal)\s*:\s*/i, '')
    .replace(/\s*[-|:]\s*Amazon\.in.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAmazonAsin(urlOrPath = '') {
  const match = urlOrPath.match(
    /(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/product\/)([A-Z0-9]{10})(?:[/?&#]|$)/i
  );
  return match ? match[1].toUpperCase() : null;
}

function buildAmazonAffiliateUrl(asin) {
  const cleanAsin = String(asin || '').trim().toUpperCase();
  return `https://www.amazon.in/dp/${cleanAsin}?tag=${AMAZON_TAG}`;
}

/**
 * Classifies a household product title into one of the 5 Nammaveetu Basket categories,
 * or returns null if it is unrelated (e.g. clothing, shoes, video games, phone cases).
 */
function classifyHouseholdCategory(title, defaultCategory = null) {
  const lower = title.toLowerCase();

  // Reject non-household / fashion / gaming / phone accessories
  if (
    /\b(t-shirt|tshirt|shirt|jeans|kurta|kurti|saree|lehenga|sneaker|running shoe|slipper|lipstick|mascara|eyeliner|earring|necklace|pendant|gold bar|silver coin|ps5|xbox|gaming keyboard|gaming mouse|phone case|back cover|tempered glass)\b/.test(
      lower
    )
  ) {
    return null;
  }

  // 1. Dry Fruits & Oil
  if (
    /\b(sunflower oil|groundnut oil|mustard oil|sesame oil|gingelly oil|rice bran oil|olive oil|cooking oil|refined oil|cold pressed oil|gold winner|idhayam|saffola|fortune oil|fortune sunlite|vanaspati|ghee|cow ghee|grb ghee|gowardhan|almond|badam|cashew|kaju|pistachio|pista|walnut|akhrot|raisin|kishmish|dates|khajoor|anjeer|fig|dry fruit|trail mix|chia seed|flax seed|pumpkin seed|peanut)\b/.test(
      lower
    )
  ) {
    return 'Dry Fruits & Oil';
  }

  // 2. Cleaning & Home Care (includes Soaps, Bodywash, Shampoo, Hair Oil, Detergents & Dishwash)
  if (
    /\b(detergent|surf excel|ariel|tide|rin|ezee|genteel|fabric conditioner|comfort|dishwash|vim|pril|floor cleaner|lizol|harpic|domex|toilet cleaner|glass cleaner|colin|phenyl|disinfectant|dettol|savlon|handwash|hand wash|bathing soap|soap bar|mysore sandal|cinthol|pears|dove|lux|santoor|medimix|hamam|bodywash|body wash|shampoo|conditioner|clinic plus|head & shoulders|tresemme|sunsilk|pantene|hair oil|parachute|indulekha|dabur amla|bajaj almond|garbage bag|trash bag|spin mop|broom|wiper|scrubber|scotch brite|odonil|air freshener|mosquito|good knight|all out|hit spray|tissue|toilet roll|paper towel|napkin|toothpaste|colgate|sensodyne|dabur red|mouthwash)\b/.test(
      lower
    )
  ) {
    return 'Cleaning & Home Care';
  }

  // 3. Appliances
  if (
    /\b(mixer grinder|wet grinder|juicer|food processor|hand blender|electric kettle|induction cooktop|air fryer|otg oven|microwave|toaster|sandwich maker|rice cooker|electric cooker|steam iron|dry iron|garment steamer|water purifier|aquaguard|kent|pureit|vacuum cleaner|washing machine|refrigerator|split ac|ceiling fan|pedestal fan|exhaust fan|water heater|geyser|inverter)\b/.test(
      lower
    )
  ) {
    return 'Appliances';
  }

  // 4. Kitchen & Cookware
  if (
    /\b(pressure cooker|kadai|karahi|tawa|fry pan|frying pan|saucepan|cookware|casserole|idli maker|puttu maker|tiffin|lunch box|water bottle|thermosteel|flask|carafe|storage container|masala box|spice rack|jar set|chopper|knife|peeler|grater|strainer|colander|gas stove|cooktop|bartan|stainless steel|milton|cello|prestige|hawkins|pigeon|borosil|signoraware|tupperware)\b/.test(
      lower
    )
  ) {
    return 'Kitchen & Cookware';
  }

  // 5. Malligai & Groceries (includes Rice, Atta, Dal, Tea, Coffee, Health Drinks, Spices, Biscuits & Snacks)
  if (
    /\b(dal|toor|arhar|moong|urad|chana|masoor|rajma|kabuli|besan|sooji|rava|poha|maida|atta|wheat flour|multigrain|rice|basmati|sona masoori|ponni|idli rice|sugar|jaggery|gud|salt|tata salt|rock salt|sendha namak|tea|chai|red label|taj mahal|chakra gold|3 roses|kannan devan|coffee|bru|nescafe|filter coffee|continental coffee|horlicks|boost|bournvita|complan|protinex|pediasure|ensure|health drink|masala|spice|turmeric|haldi|chilli|mirchi|coriander|dhania|cumin|jeera|mustard|rai|methi|hing|asafoetida|garam masala|sambar|rasam|pepper|cardamom|elaichi|clove|cinnamon|oats|quaker|saffola oats|corn flakes|kellogg|muesli|honey|peanut butter|jam|ketchup|sauce|pasta|vermicelli|seviyan|noodles|maggi|yippee|top ramen|biscuit|cookie|good day|marie gold|bourbon|oreo|dark fantasy|parle|britannia|sunfeast|unibic|rusk|bhujia|namkeen|haldiram|bikano|chips|kurkure|lays|papad|pickle|achar|ready to eat|tata sampann|aashirvaad|fortune|daawat|india gate|everest|catch|mtr|eastern|sakthi|aachi|vedaka)\b/.test(
      lower
    )
  ) {
    return 'Malligai & Groceries';
  }

  return defaultCategory;
}

async function fetchText(url, useMobileHeaders = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 11000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': useMobileHeaders ? MOBILE_USER_AGENT : DESKTOP_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9'
      }
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Fetches `https://www.amazon.in/dp/${asin}` using realistic Android 14 Chrome Mobile headers
 * and extracts the REAL live price (`a-price-whole` / `priceAmount`), real MRP (`basisPrice` / `a-text-price`),
 * and real product title & image.
 *
 * Never invents or guesses fake prices! If blocked or unavailable, returns `price_verified: false, current_price: 0`.
 */
async function fetchLiveAmazonPrice(asin) {
  const cleanAsin = String(asin || '').trim().toUpperCase();
  const url = `https://www.amazon.in/dp/${cleanAsin}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': MOBILE_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9'
      }
    });
    clearTimeout(timer);

    if (res.status === 404 || res.status === 410) {
      return { dead: true, price_verified: false, current_price: 0, mrp: 0, discount_pct: 0 };
    }
    if (!res.ok) {
      return { dead: false, price_verified: false, current_price: 0, mrp: 0, discount_pct: 0 };
    }

    const html = await res.text();

    // Check for CAPTCHA / robot check or Page Not Found
    if (
      /Enter the characters you see below|api-services-support@amazon\.com/i.test(html)
    ) {
      return { dead: false, price_verified: false, current_price: 0, mrp: 0, discount_pct: 0 };
    }
    if (/<title>\s*Page Not Found\s*<\/title>/i.test(html)) {
      return { dead: true, price_verified: false, current_price: 0, mrp: 0, discount_pct: 0 };
    }

    // Extract real product title
    const rawTitleMatch =
      html.match(/id=["'](?:productTitle|title)["'][^>]*>([\s\S]*?)<\/(?:span|h1)>/i) ||
      html.match(/<meta\s+name=["']title["']\s+content=["']([^"']+)["']/i) ||
      html.match(/<title>([\s\S]*?)<\/title>/i);
    const liveTitle = rawTitleMatch ? cleanTitle(rawTitleMatch[1]) : null;

    // Extract real product image
    const ogImgMatch =
      html.match(/property=["']og:image["']\s+content=["'](https:\/\/[^"']+)["']/i) ||
      html.match(/id=["']landingImage["'][^>]+src=["'](https:\/\/[^"']+)["']/i);
    let liveImage = ogImgMatch ? ogImgMatch[1] : null;
    if (!liveImage) {
      const amzImgs = (
        html.match(/https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9.+_-]+\.jpg/g) || []
      ).filter((u) => !u.includes('play-button') && !u.includes('sprite') && !u.includes('transparent'));
      if (amzImgs.length > 0) liveImage = amzImgs[0];
    }

    // Check if main product is out of stock
    const isUnavailable = /id=["']availability["'][\s\S]{0,300}?Currently unavailable/i.test(html);
    if (isUnavailable) {
      return {
        dead: false,
        price_verified: false,
        current_price: 0,
        mrp: 0,
        discount_pct: 0,
        title: liveTitle,
        image_url: liveImage
      };
    }

    // Extract exact live INR price from main buybox / priceToPay / priceAmount / a-price-whole
    const mainPriceMatch =
      html.match(/apex-pricetopay-value[\s\S]{0,350}?class=["']a-price-whole["'][^>]*>([0-9,]+)/i) ||
      html.match(/priceToPay[\s\S]{0,350}?class=["']a-price-whole["'][^>]*>([0-9,]+)/i) ||
      html.match(/corePriceDisplay[\s\S]{0,600}?class=["']a-price-whole["'][^>]*>([0-9,]+)/i) ||
      html.match(/["']priceAmount["']\s*:\s*([0-9.]+)/i) ||
      html.match(/class=["']a-price-whole["'][^>]*>([0-9,]+)/i);

    const currentPrice = mainPriceMatch
      ? Math.round(Number(String(mainPriceMatch[1]).replace(/,/g, '')))
      : 0;

    if (!Number.isFinite(currentPrice) || currentPrice < 10 || currentPrice > 250000) {
      return {
        dead: false,
        price_verified: false,
        current_price: 0,
        mrp: 0,
        discount_pct: 0,
        title: liveTitle,
        image_url: liveImage
      };
    }

    // Extract real MRP ONLY if present on the page (never guess or multiply!)
    const mrpMatch =
      html.match(/apex-basisprice-offscreen-label[^>]*>M\.?R\.?P\.?:\s*₹\s*([0-9,]+)/i) ||
      html.match(/basisprice-value[^>]*>\s*<span[^>]*>₹\s*([0-9,]+)/i) ||
      html.match(/List Price:\s*<span[^>]*>\s*₹\s*([0-9,]+)/i) ||
      html.match(/M\.?R\.?P\.?:\s*<span[^>]*>\s*<span[^>]*>₹\s*([0-9,]+)/i) ||
      html.match(/class=["'][^"']*a-text-price[^"']*["'][^>]*>\s*<span[^>]*>₹\s*([0-9,]+)/i);

    let mrp = mrpMatch ? Math.round(Number(String(mrpMatch[1]).replace(/,/g, ''))) : 0;
    if (!Number.isFinite(mrp) || mrp <= currentPrice || mrp > currentPrice * 5) {
      mrp = 0;
    }

    const discountPct =
      mrp > currentPrice ? Math.round(((mrp - currentPrice) / mrp) * 100) : 0;

    return {
      dead: false,
      price_verified: true,
      current_price: currentPrice,
      mrp,
      discount_pct: discountPct,
      title: liveTitle,
      image_url: liveImage
    };
  } catch (_) {
    clearTimeout(timer);
    return { dead: false, price_verified: false, current_price: 0, mrp: 0, discount_pct: 0 };
  }
}

/**
 * Parses Amazon.in search result cards into candidate household deal objects.
 */
function parseAmazonSearchCards(html, defaultCategory) {
  const deals = [];
  const cardRegex =
    /<div[^>]+data-asin=["'](B[A-Z0-9]{9})["'][^>]+data-component-type=["']s-search-result["']([\s\S]*?)(?=<div[^>]+data-component-type=["']s-search-result["']|$)/gi;

  let match;
  while ((match = cardRegex.exec(html)) !== null) {
    const asin = match[1].toUpperCase();
    const block = match[2];

    const imgMatch = block.match(/src=["'](https:\/\/m\.media-amazon\.com\/images\/I\/[^"']+)["']/i);
    const altMatch = block.match(/alt=["']([^"']{12,240})["']/i);
    const priceMatch = block.match(/class=["']a-price-whole["']>([0-9,]+)</i);
    if (!altMatch) continue;

    const title = cleanTitle(altMatch[1]);
    if (!title || title.length < 10) continue;

    const category = classifyHouseholdCategory(title, defaultCategory);
    if (!category) continue;

    const rawPrice = priceMatch ? Math.round(Number(priceMatch[1].replace(/,/g, ''))) : 0;
    const validPrice = Number.isFinite(rawPrice) && rawPrice >= 10 && rawPrice <= 250000 ? rawPrice : 0;

    // Extract explicit M.R.P. if present on the search card (never invent a fake MRP!)
    const mrpExplicitMatch =
      block.match(/M\.?R\.?P:?\s*<span[^>]*>\s*<span[^>]*>₹([0-9,]+)</i) ||
      block.match(/a-text-price["'][^>]*>\s*<span[^>]*>₹([0-9,]+)</i);
    let mrp = mrpExplicitMatch ? Math.round(Number(mrpExplicitMatch[1].replace(/,/g, ''))) : 0;
    if (!Number.isFinite(mrp) || mrp <= validPrice || mrp > validPrice * 5) {
      mrp = 0;
    }

    const discountPct =
      validPrice > 0 && mrp > validPrice
        ? Math.round(((mrp - validPrice) / mrp) * 100)
        : 0;

    deals.push({
      id: `amz-${asin}`,
      asin,
      title,
      store: 'Amazon.in',
      category,
      price_verified: validPrice > 0,
      current_price: validPrice,
      deal_price: validPrice,
      mrp,
      discount_pct: discountPct,
      savings_amount: mrp > validPrice ? mrp - validPrice : 0,
      image_url: imgMatch ? imgMatch[1] : null,
      affiliate_url: buildAmazonAffiliateUrl(asin),
      published_at: new Date().toISOString()
    });
  }

  return deals;
}

/**
 * Resolves a DesiDime visit link or short redirect (amzn.to / amzn.in / bit.ly) to an Amazon.in ASIN.
 */
async function resolveRedirectToAmazonAsin(rawUrl) {
  try {
    const directAsin = extractAmazonAsin(rawUrl);
    if (directAsin && /amazon\.in/i.test(rawUrl)) return directAsin;

    let currentUrl = rawUrl;
    for (let hop = 0; hop < 4; hop++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': DESKTOP_USER_AGENT,
          'Referer': 'https://www.desidime.com/'
        }
      });
      clearTimeout(timer);
      const loc = res.headers.get('location');
      if (!loc) break;
      const parsed = new URL(loc, currentUrl);
      const targetUrl = parsed.searchParams.get('url') || parsed.href;
      const asin = extractAmazonAsin(targetUrl);
      if (asin && /amazon\.in/i.test(targetUrl)) return asin;
      currentUrl = targetUrl;
    }
    return null;
  } catch (_) {
    return null;
  }
}

function parseDesiDimeAmazonCandidates(body) {
  const candidates = [];

  // 1. Parse RSS <item> blocks (frontpage_deals.rss, new_deals.rss)
  const itemBlocks = body.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const item of itemBlocks) {
    const titleRaw = (item.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const descRaw = (item.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '';
    const linkRaw = (item.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
    const title = cleanTitle(titleRaw);
    if (!title) continue;

    const category = classifyHouseholdCategory(title, null);
    if (!category) continue;

    const decodedDesc = decodeEntities(descRaw);
    const visitMatch =
      decodedDesc.match(
        /href=["'](https?:\/\/(?:visit\.desidime\.com\/visit\/|amzn\.to\/|amzn\.in\/|www\.amazon\.in\/)[^"']+)["']/i
      ) || linkRaw.match(/(https?:\/\/[^\s<]+)/i);
    if (!visitMatch) continue;

    const imgMatch = decodedDesc.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    const rawImg = imgMatch ? imgMatch[1] : null;
    const imageUrl = rawImg && !rawImg.includes('/merchants/') ? rawImg : null;

    // Extract explicit price ONLY if present in the RSS title (no fallback guessing!)
    const priceMatch = title.match(/(?:₹|\bRs\.?|@)\s*([0-9,]{2,6})\b/i);
    const rssPrice = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : 0;

    candidates.push({
      title,
      category,
      rssPrice: rssPrice >= 15 ? rssPrice : 0,
      imageUrl,
      visitUrl: visitMatch[1].trim()
    });
  }

  // 2. Parse HTML <article> blocks (stores/amazon-india pages)
  const articleBlocks = body.match(/<article[\s\S]*?<\/article>/gi) || [];
  for (const article of articleBlocks) {
    const idMatch = article.match(/data-gtm-deal-id=["']([^"']+)["']/i);
    const titleMatch =
      article.match(/custom-card-title[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i) ||
      article.match(/<img[^>]+alt=["']([^"']+)["']/i);
    if (!titleMatch) continue;

    const title = cleanTitle(titleMatch[1]);
    const category = classifyHouseholdCategory(title, null);
    if (!category) continue;

    const visitMatch = article.match(/href=["'](https:\/\/visit\.desidime\.com\/visit\/[^"']+)["']/i);
    const dealId = idMatch ? idMatch[1] : null;
    const visitUrl = visitMatch
      ? visitMatch[1]
      : dealId
        ? `https://visit.desidime.com/visit/home-new-get-deals-1/${dealId}`
        : null;
    if (!visitUrl) continue;

    const imgMatch =
      article.match(/<img[^>]+id=["']image-[^"']*["'][^>]+src=["']([^"']+)["']/i) ||
      article.match(
        /<img[^>]+src=["'](https:\/\/cdn[0-9]\.desidime\.com\/(?:topics|attachments)\/photos\/[^"']+)["']/i
      );
    const rawImg = imgMatch ? imgMatch[1] : null;
    const imageUrl = rawImg && !rawImg.includes('/merchants/') ? rawImg : null;

    const priceBlockMatch = article.match(/text-primary\s+mr-2[^>]*>([\s\S]*?)<\/div>/i);
    const priceText = priceBlockMatch ? cleanTitle(priceBlockMatch[1]) : '';
    const priceMatch = `${priceText} ${title}`.match(/(?:₹|\bRs\.?)\s*([0-9,]{2,6})\b/i);
    const rssPrice = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : 0;

    candidates.push({
      title,
      category,
      rssPrice: rssPrice >= 15 ? rssPrice : 0,
      imageUrl,
      visitUrl
    });
  }

  return candidates;
}

/**
 * Parses public Telegram deal channel web previews for fresh Amazon.in household deals.
 */
function parseTelegramAmazonCandidates(body) {
  const candidates = [];
  const msgBlocks =
    body.match(/<div class="tgme_widget_message_wrap[\s\S]*?(?=<div class="tgme_widget_message_wrap|$)/gi) || [];

  for (const block of msgBlocks) {
    const textMatch = block.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i);
    if (!textMatch) continue;

    const linkMatch = textMatch[1].match(
      /href=["'](https?:\/\/(?:amzn\.to|amzn\.in|www\.amazon\.in|amazon\.in)\/[^"']+)["']/i
    );
    if (!linkMatch) continue;

    const cleanMsg = cleanTitle(textMatch[1]);
    if (!cleanMsg || cleanMsg.length < 10) continue;

    const category = classifyHouseholdCategory(cleanMsg, null);
    if (!category) continue;

    const priceMatch = cleanMsg.match(/(?:₹|\bRs\.?|@)\s*([0-9,]{2,6})\b/i);
    const rssPrice = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : 0;

    const imgMatch = block.match(/background-image:url\(['"](https?:\/\/[^'"]+)['"]\)/i);
    const titleSnippet = cleanMsg
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

    if (titleSnippet.length < 10) continue;

    candidates.push({
      title: titleSnippet,
      category,
      rssPrice: rssPrice >= 15 && rssPrice <= 150000 ? rssPrice : 0,
      imageUrl: imgMatch ? imgMatch[1] : null,
      visitUrl: decodeEntities(linkMatch[1])
    });
  }

  return candidates;
}

async function runPool(items, concurrency, workerFn) {
  const results = [];
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const currentIdx = idx++;
      try {
        const res = await workerFn(items[currentIdx], currentIdx);
        if (res) results.push(res);
      } catch (_) {}
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

function loadExistingFeedMap() {
  const existingByAsin = new Map();
  const existingList = [];
  if (!fs.existsSync(OUTPUT_PATH)) return { existingByAsin, existingList };

  try {
    const prevJson = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
    const prevList = Array.isArray(prevJson)
      ? prevJson
      : prevJson && Array.isArray(prevJson.deals)
        ? prevJson.deals
        : [];
    for (const d of prevList) {
      if (!d || !d.affiliate_url) continue;
      const asin = (d.asin || extractAmazonAsin(d.affiliate_url) || '').toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
      const cat = classifyHouseholdCategory(d.title || '', d.category || null);
      if (!cat) continue;

      const currentPrice =
        d.price_verified === true
          ? Number(d.current_price || d.deal_price || 0)
          : 0;
      const mrp =
        d.price_verified === true && Number(d.mrp) > currentPrice
          ? Number(d.mrp)
          : 0;
      const discountPct =
        mrp > currentPrice ? Math.round(((mrp - currentPrice) / mrp) * 100) : 0;

      const normalized = {
        id: `amz-${asin}`,
        asin,
        title: cleanTitle(d.title),
        store: 'Amazon.in',
        category: cat,
        price_verified: d.price_verified === true && currentPrice > 0,
        current_price: currentPrice > 0 ? currentPrice : 0,
        deal_price: currentPrice > 0 ? currentPrice : 0,
        mrp,
        discount_pct: discountPct,
        savings_amount: mrp > currentPrice ? mrp - currentPrice : 0,
        image_url: d.image_url || null,
        affiliate_url: buildAmazonAffiliateUrl(asin),
        published_at: d.published_at || new Date().toISOString()
      };
      existingByAsin.set(asin, normalized);
      existingList.push(normalized);
    }
  } catch (_) {}
  return { existingByAsin, existingList };
}

async function main() {
  const { existingByAsin, existingList } = loadExistingFeedMap();

  // 1. Fetch fresh DesiDime RSS + Telegram deal candidates
  console.log(
    `Fetching fresh DesiDime RSS & Telegram Amazon India household deals (mode: ${
      IS_CLOUD_RSS_ONLY ? 'CLOUD_RSS_ONLY' : 'LOCAL_INDIAN_LIVE_PRICES'
    })...`
  );
  const liveFeedCandidates = [];
  await runPool(DESIDIME_AMAZON_SOURCES, 4, async (sourceUrl) => {
    try {
      const html = await fetchText(sourceUrl, false);
      liveFeedCandidates.push(...parseDesiDimeAmazonCandidates(html));
    } catch (_) {}
  });

  await runPool(TELEGRAM_DEAL_SOURCES, 3, async (sourceUrl) => {
    try {
      const html = await fetchText(sourceUrl, false);
      liveFeedCandidates.push(...parseTelegramAmazonCandidates(html));
    } catch (_) {}
  });

  const resolvedLiveFeedDeals = await runPool(liveFeedCandidates, 8, async (cand) => {
    const asin = await resolveRedirectToAmazonAsin(cand.visitUrl);
    if (!asin) return null;

    // If this ASIN already has a verified Indian price in home_feed.json and we are in cloud mode, preserve it!
    if (IS_CLOUD_RSS_ONLY && existingByAsin.has(asin)) {
      const existing = existingByAsin.get(asin);
      if (existing.price_verified && existing.current_price > 0) {
        return existing;
      }
    }

    // In cloud mode, if RSS feed title explicitly had a price, use it; otherwise unverified (0)
    if (IS_CLOUD_RSS_ONLY) {
      const hasRssPrice = cand.rssPrice > 0;
      return {
        id: `amz-${asin}`,
        asin,
        title: cand.title,
        store: 'Amazon.in',
        category: cand.category,
        price_verified: hasRssPrice,
        current_price: hasRssPrice ? cand.rssPrice : 0,
        deal_price: hasRssPrice ? cand.rssPrice : 0,
        mrp: 0,
        discount_pct: 0,
        savings_amount: 0,
        image_url: cand.imageUrl,
        affiliate_url: buildAmazonAffiliateUrl(asin),
        published_at: new Date().toISOString()
      };
    }

    // In local Indian IP mode, we will verify live price via fetchLiveAmazonPrice(asin) below
    return {
      id: `amz-${asin}`,
      asin,
      title: cand.title,
      store: 'Amazon.in',
      category: cand.category,
      price_verified: false,
      current_price: 0,
      deal_price: 0,
      mrp: 0,
      discount_pct: 0,
      savings_amount: 0,
      image_url: cand.imageUrl,
      affiliate_url: buildAmazonAffiliateUrl(asin),
      published_at: new Date().toISOString()
    };
  });

  console.log(`Resolved ${resolvedLiveFeedDeals.length} DesiDime RSS / Telegram Amazon household deals.`);

  const collectedCandidates = [...resolvedLiveFeedDeals];

  // 2. If running locally on Indian IP, scrape live Amazon.in category searches
  if (!IS_CLOUD_RSS_ONLY) {
    console.log(
      `Fetching live Amazon.in Household & Malligai search cards across ${AMAZON_CATEGORY_QUERIES.length} queries...`
    );
    await runPool(AMAZON_CATEGORY_QUERIES, 2, async (item, idx) => {
      try {
        await new Promise((r) => setTimeout(r, (idx % 3) * 200 + 150));
        const url = `https://www.amazon.in/s?k=${encodeURIComponent(item.query)}`;
        const html = await fetchText(url, false);
        const parsed = parseAmazonSearchCards(html, item.category);
        if (parsed.length > 0) {
          collectedCandidates.push(...parsed);
        }
      } catch (_) {}
    });
  }

  // 3. Append existing home_feed.json items
  collectedCandidates.push(...existingList);

  // 4. Deduplicate by ASIN and interleave across categories
  const seenAsins = new Set();
  const byCategory = {
    'Malligai & Groceries': [],
    'Dry Fruits & Oil': [],
    'Cleaning & Home Care': [],
    'Kitchen & Cookware': [],
    'Appliances': []
  };

  for (const deal of collectedCandidates) {
    if (!deal || !deal.asin || !/^[A-Z0-9]{10}$/.test(deal.asin)) continue;
    if (seenAsins.has(deal.asin)) continue;
    seenAsins.add(deal.asin);

    deal.affiliate_url = buildAmazonAffiliateUrl(deal.asin);
    deal.store = 'Amazon.in';
    const cat = byCategory[deal.category] ? deal.category : 'Malligai & Groceries';
    deal.category = cat;
    byCategory[cat].push(deal);
  }

  const candidateDeals = [];
  const catNames = Object.keys(byCategory);
  let round = 0;
  while (candidateDeals.length < MAX_DEALS_TO_RETAIN + 25) {
    let addedInRound = false;
    for (const cat of catNames) {
      if (round < byCategory[cat].length && candidateDeals.length < MAX_DEALS_TO_RETAIN + 25) {
        candidateDeals.push(byCategory[cat][round]);
        addedInRound = true;
      }
    }
    if (!addedInRound) break;
    round++;
  }

  // 5. In local Indian IP mode, verify every item via `fetchLiveAmazonPrice(asin)` in small batches
  let verifiedFinalDeals = [];
  if (!IS_CLOUD_RSS_ONLY) {
    console.log(
      `Verifying exact live Amazon.in /dp/ prices for ${candidateDeals.length} items in small batches...`
    );
    const batchSize = 6;
    let verifiedCount = 0;
    let unverifiedCount = 0;
    let droppedDeadCount = 0;

    for (let i = 0; i < candidateDeals.length; i += batchSize) {
      if (verifiedFinalDeals.length >= MAX_DEALS_TO_RETAIN) break;
      const batch = candidateDeals.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (deal) => {
          const live = await fetchLiveAmazonPrice(deal.asin);
          if (live.dead) {
            droppedDeadCount++;
            return null;
          }

          const finalTitle =
            live.title && live.title.length >= 10 ? live.title : deal.title;
          const finalImage = live.image_url || deal.image_url || null;
          const finalCategory =
            classifyHouseholdCategory(finalTitle, deal.category) || deal.category;

          if (live.price_verified && live.current_price > 0) {
            verifiedCount++;
            return {
              id: `amz-${deal.asin}`,
              asin: deal.asin,
              title: finalTitle,
              store: 'Amazon.in',
              category: finalCategory,
              price_verified: true,
              current_price: live.current_price,
              deal_price: live.current_price,
              mrp: live.mrp,
              discount_pct: live.discount_pct,
              savings_amount: live.mrp > live.current_price ? live.mrp - live.current_price : 0,
              image_url: finalImage,
              affiliate_url: buildAmazonAffiliateUrl(deal.asin),
              published_at: new Date().toISOString()
            };
          }

          // If search card already had a live price from this run, use it; otherwise mark unverified (0)
          if (deal.price_verified && deal.current_price > 0) {
            verifiedCount++;
            return {
              ...deal,
              title: finalTitle,
              image_url: finalImage,
              category: finalCategory
            };
          }

          unverifiedCount++;
          return {
            id: `amz-${deal.asin}`,
            asin: deal.asin,
            title: finalTitle,
            store: 'Amazon.in',
            category: finalCategory,
            price_verified: false,
            current_price: 0,
            deal_price: 0,
            mrp: 0,
            discount_pct: 0,
            savings_amount: 0,
            image_url: finalImage,
            affiliate_url: buildAmazonAffiliateUrl(deal.asin),
            published_at: new Date().toISOString()
          };
        })
      );

      for (const res of batchResults) {
        if (res && verifiedFinalDeals.length < MAX_DEALS_TO_RETAIN) {
          verifiedFinalDeals.push(res);
        }
      }
      await new Promise((r) => setTimeout(r, 220));
    }

    console.log(
      `Live Amazon.in verification complete: ${verifiedCount} verified live prices, ${unverifiedCount} unverified (0), ${droppedDeadCount} dead 404s removed.`
    );
  } else {
    verifiedFinalDeals = candidateDeals.slice(0, MAX_DEALS_TO_RETAIN);
  }

  const payload = {
    brand: 'Nammaveetu Basket',
    title: 'Kitchen & Malligai Hot Deals',
    updated_at: new Date().toISOString(),
    total_deals: verifiedFinalDeals.length,
    amazon_tag: AMAZON_TAG,
    deals: verifiedFinalDeals
  };

  const jsonStr = JSON.stringify(payload, null, 2);
  fs.writeFileSync(OUTPUT_PATH, jsonStr, 'utf8');
  console.log(
    `Successfully saved ${verifiedFinalDeals.length} Amazon Kitchen & Malligai deals to ${OUTPUT_PATH}`
  );

  const extraTargets = [
    path.join(__dirname, '..', 'assets', 'data', 'home_feed.json'),
    path.join(__dirname, '..', 'chrome-extension', 'home_feed.json')
  ];
  for (const target of extraTargets) {
    try {
      if (fs.existsSync(path.dirname(target))) {
        fs.writeFileSync(target, jsonStr, 'utf8');
        console.log(`Synced ${verifiedFinalDeals.length} Amazon Kitchen & Malligai deals to ${target}`);
      }
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error('Fatal error in fetch_deals.js:', err);
  process.exit(1);
});
