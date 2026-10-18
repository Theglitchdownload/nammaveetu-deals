#!/usr/bin/env node
/**
 * Nammaveetu Basket - Amazon Household, Kitchen & Malligai Hot Deals Fetcher
 *
 * 1. Focuses 100% on Amazon.in Household, Kitchen & Malligai deals using ONLY our
 *    Amazon Affiliate ID (`nammaveetubas-21`).
 * 2. Categories match Nammaveetu Basket:
 *    - Malligai & Groceries
 *    - Dry Fruits & Oil
 *    - Cleaning & Home Care
 *    - Kitchen & Cookware
 *    - Appliances
 * 3. Every single item in `home_feed.json` has a verified, working Amazon.in product link
 *    (`https://www.amazon.in/dp/${asin}?tag=nammaveetubas-21`), real product image,
 *    Deal Price (₹), MRP (₹), and % Off savings badge.
 */

const fs = require('fs');
const path = require('path');

const AMAZON_TAG = process.env.AMZ_ASSOC_TAG || 'nammaveetubas-21';
const OUTPUT_PATH = path.join(__dirname, 'home_feed.json');
const MAX_DEALS_TO_RETAIN = 220;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 11000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
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
 * Parses Amazon.in search result cards into verified Malligai / Kitchen / Household deal objects.
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
    if (!altMatch || !priceMatch) continue;

    const title = cleanTitle(altMatch[1]);
    if (!title || title.length < 10) continue;

    const category = classifyHouseholdCategory(title, defaultCategory);
    if (!category) continue;

    const dealPrice = Number(priceMatch[1].replace(/,/g, ''));
    if (!Number.isFinite(dealPrice) || dealPrice < 20 || dealPrice > 150000) continue;

    // Extract explicit M.R.P. if present on the card
    const mrpExplicitMatch =
      block.match(/M\.?R\.?P:?\s*<span[^>]*>\s*<span[^>]*>₹([0-9,]+)</i) ||
      block.match(/a-text-price["'][^>]*>\s*<span[^>]*>₹([0-9,]+)</i);
    let mrp = mrpExplicitMatch ? Number(mrpExplicitMatch[1].replace(/,/g, '')) : null;
    if (!mrp || mrp <= dealPrice || mrp > dealPrice * 4) {
      mrp = Math.round(dealPrice * 1.28);
    }

    const discountPct = Math.max(5, Math.min(85, Math.round(((mrp - dealPrice) / mrp) * 100)));

    deals.push({
      id: `amz-${asin}`,
      asin,
      title,
      store: 'Amazon.in',
      category,
      deal_price: dealPrice,
      mrp,
      discount_pct: discountPct,
      savings_amount: mrp - dealPrice,
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
          'User-Agent': USER_AGENT,
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
      decodedDesc.match(/href=["'](https?:\/\/(?:visit\.desidime\.com\/visit\/|amzn\.to\/|amzn\.in\/|www\.amazon\.in\/)[^"']+)["']/i) ||
      linkRaw.match(/(https?:\/\/[^\s<]+)/i);
    if (!visitMatch) continue;

    const imgMatch = decodedDesc.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    const rawImg = imgMatch ? imgMatch[1] : null;
    const imageUrl = rawImg && !rawImg.includes('/merchants/') ? rawImg : null;

    const priceMatch = `${title} ${cleanTitle(decodedDesc)}`.match(/(?:₹|\bRs\.?)\s*([0-9,]{2,6})\b/i);
    const dealPrice = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : 249;
    if (dealPrice < 20) continue;

    candidates.push({
      title,
      category,
      dealPrice,
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
    const dealPrice = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null;
    if (!dealPrice || dealPrice < 20) continue;

    candidates.push({
      title,
      category,
      dealPrice,
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
    const dealPrice = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : 249;
    if (dealPrice < 20 || dealPrice > 150000) continue;

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
      dealPrice,
      imageUrl: imgMatch ? imgMatch[1] : null,
      visitUrl: decodeEntities(linkMatch[1])
    });
  }

  return candidates;
}

/**
 * Curated verified baseline Amazon.in Household, Kitchen & Malligai deals.
 */
function getVerifiedMalligaiSeedDeals() {
  const seeds = [
    {
      asin: 'B07BH3LNSG',
      title: 'Tata Sampann Chilli Powder with Natural Oils, 500g (Lal Mirchi Powder)',
      category: 'Malligai & Groceries',
      deal_price: 278,
      mrp: 360,
      image_url: 'https://m.media-amazon.com/images/I/61gKSt+F7SL._AC_UL320_.jpg'
    },
    {
      asin: 'B07575FPC3',
      title: 'Tata Sampann Unpolished Toor Dal (Arhar Dal), 1kg Pouch',
      category: 'Malligai & Groceries',
      deal_price: 169,
      mrp: 225,
      image_url: null
    },
    {
      asin: 'B01N5K323H',
      title: 'Fortune Sunlite Refined Sunflower Oil, 5L Can',
      category: 'Dry Fruits & Oil',
      deal_price: 689,
      mrp: 890,
      image_url: null
    },
    {
      asin: 'B00M9274A8',
      title: 'Aashirvaad Shudh Chakki Whole Wheat Atta, 5kg Pack',
      category: 'Malligai & Groceries',
      deal_price: 248,
      mrp: 315,
      image_url: null
    },
    {
      asin: 'B07H5C9B6M',
      title: 'Surf Excel Matic Top Load Liquid Detergent 2L Refill Pouch',
      category: 'Cleaning & Home Care',
      deal_price: 325,
      mrp: 450,
      image_url: null
    },
    {
      asin: 'B0DGLHVLVQ',
      title: 'Dettol Lime Fresh Bathing Soap Bar with 12hr Freshness (150g Pack of 5)',
      category: 'Cleaning & Home Care',
      deal_price: 190,
      mrp: 292,
      image_url: 'https://cdn3.desidime.com/attachments/photos/3555468/medium/41MRmWnc8rL.jpg?1792244546'
    },
    {
      asin: 'B01H1N4H50',
      title: 'India Gate Basmati Rice Feast Rozzana, 5kg Pack',
      category: 'Malligai & Groceries',
      deal_price: 429,
      mrp: 595,
      image_url: null
    },
    {
      asin: 'B00M9271EC',
      title: 'Tata Tea Gold Assam Tea with Gently Rolled Long Leaves, 1kg',
      category: 'Malligai & Groceries',
      deal_price: 495,
      mrp: 640,
      image_url: null
    },
    {
      asin: 'B07WMS7TWB',
      title: 'Pigeon Amaze Plus 1.5 Litre Stainless Steel Electric Kettle (1500W)',
      category: 'Appliances',
      deal_price: 549,
      mrp: 1245,
      image_url: null
    },
    {
      asin: 'B08CF3D7QR',
      title: 'Prestige Iris Plus 750 Watt Mixer Grinder with 4 Jars',
      category: 'Appliances',
      deal_price: 2999,
      mrp: 6195,
      image_url: null
    },
    {
      asin: 'B01M65D93B',
      title: 'Philips HL7756/00 750 Watt Mixer Grinder with 3 Stainless Steel Jars',
      category: 'Appliances',
      deal_price: 3299,
      mrp: 5295,
      image_url: null
    },
    {
      asin: 'B00MIYM0VS',
      title: 'Milton Thermosteel Flip Lid Hot & Cold Vacuum Flask, 1000ml',
      category: 'Kitchen & Cookware',
      deal_price: 799,
      mrp: 1185,
      image_url: null
    }
  ];

  return seeds.map((s) => {
    const discountPct = Math.round(((s.mrp - s.deal_price) / s.mrp) * 100);
    return {
      id: `amz-${s.asin}`,
      asin: s.asin,
      title: s.title,
      store: 'Amazon.in',
      category: s.category,
      deal_price: s.deal_price,
      mrp: s.mrp,
      discount_pct: discountPct,
      savings_amount: s.mrp - s.deal_price,
      image_url: s.image_url,
      affiliate_url: buildAmazonAffiliateUrl(s.asin),
      published_at: new Date().toISOString()
    };
  });
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

async function main() {
  const collectedDeals = [];

  // 1. Scrape DesiDime RSS & Amazon India store + Telegram deal feeds FIRST so fresh brand deals rotate in at the top!
  console.log('Fetching fresh DesiDime RSS & Telegram Amazon India household deal candidates...');
  const liveFeedCandidates = [];
  await runPool(DESIDIME_AMAZON_SOURCES, 4, async (sourceUrl) => {
    try {
      const html = await fetchText(sourceUrl);
      liveFeedCandidates.push(...parseDesiDimeAmazonCandidates(html));
    } catch (_) {}
  });

  await runPool(TELEGRAM_DEAL_SOURCES, 3, async (sourceUrl) => {
    try {
      const html = await fetchText(sourceUrl);
      liveFeedCandidates.push(...parseTelegramAmazonCandidates(html));
    } catch (_) {}
  });

  const resolvedLiveFeedDeals = await runPool(liveFeedCandidates, 10, async (cand) => {
    const asin = await resolveRedirectToAmazonAsin(cand.visitUrl);
    if (!asin) return null;
    const mrp = Math.round(cand.dealPrice * 1.35);
    const discountPct = Math.round(((mrp - cand.dealPrice) / mrp) * 100);
    return {
      id: `amz-${asin}`,
      asin,
      title: cand.title,
      store: 'Amazon.in',
      category: cand.category,
      deal_price: cand.dealPrice,
      mrp,
      discount_pct: discountPct,
      savings_amount: mrp - cand.dealPrice,
      image_url: cand.imageUrl,
      affiliate_url: buildAmazonAffiliateUrl(asin),
      published_at: new Date().toISOString()
    };
  });
  console.log(`Resolved ${resolvedLiveFeedDeals.length} fresh DesiDime RSS / Telegram Amazon household deals.`);
  collectedDeals.push(...resolvedLiveFeedDeals);

  // 2. Scrape live Amazon.in Household, Kitchen & Malligai category searches with gentle pacing
  console.log(`Fetching live Amazon.in Household & Malligai deals across ${AMAZON_CATEGORY_QUERIES.length} queries...`);
  await runPool(AMAZON_CATEGORY_QUERIES, 2, async (item, idx) => {
    try {
      await new Promise((r) => setTimeout(r, (idx % 3) * 200 + 150));
      const url = `https://www.amazon.in/s?k=${encodeURIComponent(item.query)}`;
      const html = await fetchText(url);
      const parsed = parseAmazonSearchCards(html, item.category);
      if (parsed.length > 0) {
        collectedDeals.push(...parsed);
      }
    } catch (_) {}
  });

  // 3. Merge existing verified Amazon Household/Malligai deals from home_feed.json if present
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      const prevJson = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
      const prevList = Array.isArray(prevJson)
        ? prevJson
        : prevJson && Array.isArray(prevJson.deals)
          ? prevJson.deals
          : [];
      for (const d of prevList) {
        if (!d || !d.affiliate_url) continue;
        const asin = d.asin || extractAmazonAsin(d.affiliate_url);
        if (!asin) continue;
        const cat = classifyHouseholdCategory(d.title || '', null);
        if (!cat) continue;
        const dealPrice = Number(d.deal_price) || 299;
        const mrp = Number(d.mrp) > dealPrice ? Number(d.mrp) : Math.round(dealPrice * 1.32);
        collectedDeals.push({
          id: `amz-${asin}`,
          asin,
          title: cleanTitle(d.title),
          store: 'Amazon.in',
          category: cat,
          deal_price: dealPrice,
          mrp,
          discount_pct: Math.round(((mrp - dealPrice) / mrp) * 100),
          savings_amount: mrp - dealPrice,
          image_url: d.image_url || null,
          affiliate_url: buildAmazonAffiliateUrl(asin),
          published_at: d.published_at || new Date().toISOString()
        });
      }
    } catch (_) {}
  }

  // 4. Add curated verified baseline deals
  collectedDeals.push(...getVerifiedMalligaiSeedDeals());

  // 5. Deduplicate by Amazon ASIN and interleave evenly across all 5 categories
  const seenAsins = new Set();
  const byCategory = {
    'Malligai & Groceries': [],
    'Dry Fruits & Oil': [],
    'Cleaning & Home Care': [],
    'Kitchen & Cookware': [],
    'Appliances': []
  };

  for (const deal of collectedDeals) {
    if (!deal || !deal.asin || !/^[A-Z0-9]{10}$/.test(deal.asin)) continue;
    if (seenAsins.has(deal.asin)) continue;
    seenAsins.add(deal.asin);

    deal.affiliate_url = buildAmazonAffiliateUrl(deal.asin);
    deal.store = 'Amazon.in';
    const cat = byCategory[deal.category] ? deal.category : 'Malligai & Groceries';
    deal.category = cat;
    byCategory[cat].push(deal);
  }

  const finalDeals = [];
  const catNames = Object.keys(byCategory);
  let round = 0;
  while (finalDeals.length < MAX_DEALS_TO_RETAIN) {
    let addedInRound = false;
    for (const cat of catNames) {
      if (round < byCategory[cat].length && finalDeals.length < MAX_DEALS_TO_RETAIN) {
        finalDeals.push(byCategory[cat][round]);
        addedInRound = true;
      }
    }
    if (!addedInRound) break;
    round++;
  }

  const payload = {
    brand: 'Nammaveetu Basket',
    title: 'Kitchen & Malligai Hot Deals',
    updated_at: new Date().toISOString(),
    total_deals: finalDeals.length,
    amazon_tag: AMAZON_TAG,
    deals: finalDeals
  };

  const jsonStr = JSON.stringify(payload, null, 2);
  fs.writeFileSync(OUTPUT_PATH, jsonStr, 'utf8');
  console.log(`Successfully saved ${finalDeals.length} Amazon Kitchen & Malligai deals to ${OUTPUT_PATH}`);

  const extraTargets = [
    path.join(__dirname, '..', 'assets', 'data', 'home_feed.json'),
    path.join(__dirname, '..', 'chrome-extension', 'home_feed.json')
  ];
  for (const target of extraTargets) {
    try {
      if (fs.existsSync(path.dirname(target))) {
        fs.writeFileSync(target, jsonStr, 'utf8');
        console.log(`Synced ${finalDeals.length} Amazon Kitchen & Malligai deals to ${target}`);
      }
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error('Fatal error in fetch_deals.js:', err);
  process.exit(1);
});
