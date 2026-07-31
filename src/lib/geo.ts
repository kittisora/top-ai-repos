/**
 * Normalise a GitHub profile location into a country (and city where obvious).
 *
 * GitHub's location is free text: "Berlin, Germany 🇩🇪", "SF Bay Area", "京都",
 * "Remote", "127.0.0.1". There is no API for this, so the site's geography view
 * needs a heuristic — and the honest answer for unrecognised input is null
 * rather than a guess, because a wrong country is worse than a missing one.
 *
 * Pure and dependency-free so it can run in the ingestion worker and be tested
 * without a database.
 */

/** Canonical country names, with the aliases and demonyms people actually type. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  'United States': [
    'united states', 'united states of america', 'usa', 'u.s.a.', 'us', 'u.s.', 'america',
    'san francisco', 'sf', 'sf bay area', 'bay area', 'silicon valley', 'new york', 'nyc',
    'new york city', 'brooklyn', 'seattle', 'boston', 'austin', 'chicago', 'los angeles',
    'la', 'palo alto', 'mountain view', 'sunnyvale', 'san jose', 'santa clara', 'redmond',
    'cambridge, ma', 'menlo park', 'denver', 'atlanta', 'portland', 'san diego', 'dallas',
    'houston', 'philadelphia', 'pittsburgh', 'washington dc', 'washington, d.c.', 'd.c.',
    'california', 'ca', 'texas', 'washington state', 'massachusetts', 'colorado', 'florida',
    'illinois', 'georgia, usa', 'oregon', 'utah', 'michigan', 'north carolina', 'virginia',
  ],
  'United Kingdom': [
    'united kingdom', 'uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland',
    'wales', 'northern ireland', 'london', 'manchester', 'cambridge, uk', 'oxford',
    'edinburgh', 'bristol', 'glasgow', 'birmingham', 'leeds', 'brighton',
  ],
  Germany: [
    'germany', 'deutschland', 'de', 'berlin', 'munich', 'münchen', 'hamburg', 'cologne',
    'köln', 'frankfurt', 'stuttgart', 'düsseldorf', 'leipzig', 'dresden', 'karlsruhe',
  ],
  China: [
    'china', 'prc', "people's republic of china", 'cn', '中国', 'beijing', '北京',
    'shanghai', '上海', 'shenzhen', '深圳', 'hangzhou', '杭州', 'guangzhou', '广州',
    'chengdu', '成都', 'nanjing', 'wuhan', 'xian', "xi'an", 'suzhou', 'tianjin',
  ],
  India: [
    'india', 'in', 'bharat', 'bangalore', 'bengaluru', 'mumbai', 'delhi', 'new delhi',
    'hyderabad', 'chennai', 'pune', 'kolkata', 'ahmedabad', 'noida', 'gurgaon', 'gurugram',
    'kerala', 'tamil nadu',
  ],
  Canada: [
    'canada', 'ca, canada', 'toronto', 'vancouver', 'montreal', 'montréal', 'ottawa',
    'calgary', 'edmonton', 'waterloo', 'quebec', 'québec', 'ontario', 'british columbia',
  ],
  France: [
    'france', 'fr', 'paris', 'lyon', 'marseille', 'toulouse', 'bordeaux', 'nantes',
    'lille', 'grenoble', 'nice',
  ],
  Japan: [
    'japan', 'jp', '日本', 'tokyo', '東京', 'osaka', '大阪', 'kyoto', '京都', 'yokohama',
    'fukuoka', 'nagoya', 'sapporo',
  ],
  Brazil: [
    'brazil', 'brasil', 'br', 'são paulo', 'sao paulo', 'rio de janeiro', 'rio',
    'belo horizonte', 'curitiba', 'porto alegre', 'brasilia', 'brasília', 'recife',
  ],
  Russia: [
    'russia', 'russian federation', 'ru', 'россия', 'moscow', 'москва',
    'saint petersburg', 'st. petersburg', 'st petersburg', 'novosibirsk', 'yekaterinburg',
  ],
  Netherlands: [
    'netherlands', 'the netherlands', 'holland', 'nl', 'amsterdam', 'rotterdam',
    'utrecht', 'the hague', 'eindhoven', 'delft',
  ],
  Australia: [
    'australia', 'au', 'sydney', 'melbourne', 'brisbane', 'perth', 'canberra', 'adelaide',
  ],
  'South Korea': [
    'south korea', 'korea', 'republic of korea', 'kr', '한국', '대한민국', 'seoul', '서울',
    'busan', 'daejeon', 'incheon',
  ],
  Poland: [
    'poland', 'polska', 'pl', 'warsaw', 'warszawa', 'krakow', 'kraków', 'wroclaw',
    'wrocław', 'poznan', 'poznań', 'gdansk', 'gdańsk', 'lodz',
  ],
  Spain: [
    'spain', 'españa', 'espana', 'es', 'madrid', 'barcelona', 'valencia', 'seville',
    'sevilla', 'bilbao', 'malaga', 'zaragoza',
  ],
  Italy: [
    'italy', 'italia', 'it', 'rome', 'roma', 'milan', 'milano', 'turin', 'torino',
    'naples', 'napoli', 'bologna', 'florence', 'firenze', 'pisa',
  ],
  Switzerland: [
    'switzerland', 'schweiz', 'suisse', 'ch', 'zurich', 'zürich', 'geneva', 'genève',
    'lausanne', 'basel', 'bern', 'lugano',
  ],
  Sweden: ['sweden', 'sverige', 'se', 'stockholm', 'gothenburg', 'göteborg', 'malmö', 'lund', 'uppsala'],
  Ukraine: ['ukraine', 'ua', 'україна', 'kyiv', 'kiev', 'київ', 'lviv', 'kharkiv', 'odesa', 'odessa', 'dnipro'],
  Israel: ['israel', 'il', 'tel aviv', 'tel-aviv', 'jerusalem', 'haifa', 'herzliya', 'ramat gan'],
  Singapore: ['singapore', 'sg'],
  Turkey: ['turkey', 'türkiye', 'turkiye', 'tr', 'istanbul', 'ankara', 'izmir', 'ıstanbul'],
  Indonesia: ['indonesia', 'id', 'jakarta', 'bandung', 'surabaya', 'yogyakarta'],
  Vietnam: ['vietnam', 'viet nam', 'vn', 'hanoi', 'ha noi', 'ho chi minh city', 'hcmc', 'saigon', 'da nang'],
  Taiwan: ['taiwan', 'tw', '台灣', '台湾', 'taipei', '台北', 'hsinchu', 'kaohsiung', 'taichung'],
  'Hong Kong': ['hong kong', 'hongkong', 'hk', '香港'],
  Austria: ['austria', 'österreich', 'at', 'vienna', 'wien', 'graz', 'linz', 'salzburg', 'innsbruck'],
  Belgium: ['belgium', 'belgië', 'belgique', 'be', 'brussels', 'brussel', 'bruxelles', 'ghent', 'gent', 'leuven', 'antwerp'],
  Denmark: ['denmark', 'danmark', 'dk', 'copenhagen', 'københavn', 'aarhus', 'odense'],
  Norway: ['norway', 'norge', 'no', 'oslo', 'bergen', 'trondheim', 'stavanger'],
  Finland: ['finland', 'suomi', 'fi', 'helsinki', 'espoo', 'tampere', 'oulu'],
  Ireland: ['ireland', 'éire', 'ie', 'dublin', 'cork', 'galway', 'limerick'],
  Portugal: ['portugal', 'pt', 'lisbon', 'lisboa', 'porto', 'braga', 'coimbra'],
  'Czech Republic': ['czech republic', 'czechia', 'česko', 'cz', 'prague', 'praha', 'brno', 'ostrava'],
  Romania: ['romania', 'românia', 'ro', 'bucharest', 'bucurești', 'bucuresti', 'cluj', 'cluj-napoca', 'timisoara', 'iasi'],
  Greece: ['greece', 'ελλάδα', 'gr', 'athens', 'αθήνα', 'thessaloniki', 'patras'],
  Hungary: ['hungary', 'magyarország', 'hu', 'budapest', 'debrecen', 'szeged'],
  Mexico: ['mexico', 'méxico', 'mx', 'mexico city', 'ciudad de méxico', 'cdmx', 'guadalajara', 'monterrey', 'puebla'],
  Argentina: ['argentina', 'ar', 'buenos aires', 'córdoba, argentina', 'rosario', 'mendoza'],
  Chile: ['chile', 'cl', 'santiago', 'santiago de chile', 'valparaíso', 'valparaiso'],
  Colombia: ['colombia', 'co', 'bogota', 'bogotá', 'medellin', 'medellín', 'cali', 'barranquilla'],
  Peru: ['peru', 'perú', 'pe', 'lima'],
  Nigeria: ['nigeria', 'ng', 'lagos', 'abuja', 'ibadan', 'port harcourt'],
  Kenya: ['kenya', 'ke', 'nairobi', 'mombasa'],
  Egypt: ['egypt', 'eg', 'cairo', 'alexandria', 'giza'],
  'South Africa': ['south africa', 'za', 'cape town', 'johannesburg', 'durban', 'pretoria'],
  Pakistan: ['pakistan', 'pk', 'karachi', 'lahore', 'islamabad', 'rawalpindi'],
  Bangladesh: ['bangladesh', 'bd', 'dhaka', 'chittagong', 'sylhet'],
  Iran: ['iran', 'ir', 'tehran', 'isfahan', 'mashhad', 'shiraz', 'tabriz'],
  'Saudi Arabia': ['saudi arabia', 'sa', 'riyadh', 'jeddah', 'dammam'],
  'United Arab Emirates': ['united arab emirates', 'uae', 'ae', 'dubai', 'abu dhabi', 'sharjah'],
  Thailand: ['thailand', 'th', 'bangkok', 'chiang mai', 'phuket'],
  Malaysia: ['malaysia', 'my', 'kuala lumpur', 'penang', 'johor bahru', 'selangor'],
  Philippines: ['philippines', 'ph', 'manila', 'metro manila', 'cebu', 'quezon city', 'davao'],
  'New Zealand': ['new zealand', 'nz', 'auckland', 'wellington', 'christchurch'],
  Bulgaria: ['bulgaria', 'bg', 'sofia', 'plovdiv', 'varna'],
  Serbia: ['serbia', 'rs', 'belgrade', 'beograd', 'novi sad', 'nis'],
  Croatia: ['croatia', 'hrvatska', 'hr', 'zagreb', 'split', 'rijeka'],
  Slovakia: ['slovakia', 'sk', 'bratislava', 'kosice'],
  Slovenia: ['slovenia', 'si', 'ljubljana', 'maribor'],
  Lithuania: ['lithuania', 'lt', 'vilnius', 'kaunas'],
  Latvia: ['latvia', 'lv', 'riga'],
  Estonia: ['estonia', 'ee', 'tallinn', 'tartu'],
  Belarus: ['belarus', 'by', 'minsk'],
  Kazakhstan: ['kazakhstan', 'kz', 'almaty', 'astana', 'nur-sultan'],
  Georgia: ['georgia (country)', 'ge', 'tbilisi'],
  Armenia: ['armenia', 'am', 'yerevan'],
  Azerbaijan: ['azerbaijan', 'az', 'baku'],
  Uzbekistan: ['uzbekistan', 'uz', 'tashkent'],
  Nepal: ['nepal', 'np', 'kathmandu'],
  'Sri Lanka': ['sri lanka', 'lk', 'colombo'],
  Morocco: ['morocco', 'ma', 'casablanca', 'rabat', 'marrakech'],
  Tunisia: ['tunisia', 'tn', 'tunis'],
  Algeria: ['algeria', 'dz', 'algiers'],
  Ghana: ['ghana', 'gh', 'accra'],
  Ethiopia: ['ethiopia', 'et', 'addis ababa'],
  Uruguay: ['uruguay', 'uy', 'montevideo'],
  Ecuador: ['ecuador', 'ec', 'quito', 'guayaquil'],
  Venezuela: ['venezuela', 've', 'caracas'],
  Bolivia: ['bolivia', 'bo', 'la paz'],
  'Costa Rica': ['costa rica', 'cr', 'san josé, costa rica'],
  Cuba: ['cuba', 'cu', 'havana'],
  Iceland: ['iceland', 'is', 'reykjavik', 'reykjavík'],
  Luxembourg: ['luxembourg', 'lu'],
  Cyprus: ['cyprus', 'cy', 'nicosia', 'limassol'],
  Malta: ['malta', 'mt', 'valletta'],
  Moldova: ['moldova', 'md', 'chisinau', 'chișinău'],
  Myanmar: ['myanmar', 'burma', 'mm', 'yangon'],
  Cambodia: ['cambodia', 'kh', 'phnom penh'],
  Mongolia: ['mongolia', 'mn', 'ulaanbaatar'],
  Iraq: ['iraq', 'iq', 'baghdad', 'erbil'],
  Jordan: ['jordan', 'jo', 'amman'],
  Lebanon: ['lebanon', 'lb', 'beirut'],
  Qatar: ['qatar', 'qa', 'doha'],
  Kuwait: ['kuwait', 'kw', 'kuwait city'],
  Bahrain: ['bahrain', 'bh', 'manama'],
  Oman: ['oman', 'om', 'muscat'],
};

/** Regional-indicator flag emoji → ISO code, e.g. 🇩🇪 → "de". */
function flagToIsoCode(text: string): string | null {
  const points = [...text]
    .map((char) => char.codePointAt(0) ?? 0)
    .filter((point) => point >= 0x1f1e6 && point <= 0x1f1ff);
  if (points.length < 2) return null;
  return points
    .slice(0, 2)
    .map((point) => String.fromCharCode(point - 0x1f1e6 + 97))
    .join('');
}

/** Two-letter aliases double as ISO codes, so the flag path reuses the same map. */
const BY_ALIAS = new Map<string, string>();
for (const [country, aliases] of Object.entries(COUNTRY_ALIASES)) {
  BY_ALIAS.set(country.toLowerCase(), country);
  for (const alias of aliases) BY_ALIAS.set(alias, country);
}

/** Deliberately-unhelpful locations people put in the field. */
const NON_PLACES = new Set([
  'remote', 'worldwide', 'world', 'earth', 'internet', 'online', 'everywhere',
  'anywhere', 'the internet', 'localhost', '127.0.0.1', 'n/a', 'na', 'none',
  'nowhere', 'here', 'home', 'unknown', 'somewhere', 'global', 'planet earth',
  'the moon', 'mars', 'space', 'metaverse', 'cyberspace', '/dev/null', 'null',
  'your heart', 'behind you', 'terminal', 'vim', 'emacs',
]);

/**
 * Strip decoration people wrap locations in: flags, brackets, quotes and the
 * arrow/pipe separators used in "Berlin -> SF" style profiles.
 */
function clean(raw: string): string {
  return raw
    // Remove emoji/pictographs (flags are read separately, before this).
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/[()[\]{}"'`*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface NormalizedLocation {
  country: string | null;
  city: string | null;
}

/**
 * Best-effort country (and city) for a free-text location.
 *
 * Strategy, in order: an explicit flag emoji; then the trailing comma-segment
 * (the convention is "City, Country"); then any segment; then the whole string.
 * Anything unrecognised returns nulls — see the module note on guessing.
 */
export function normalizeLocation(raw: string | null | undefined): NormalizedLocation {
  if (!raw) return { country: null, city: null };

  // A flag is the most explicit signal available, so it wins outright.
  const iso = flagToIsoCode(raw);
  const fromFlag = iso ? BY_ALIAS.get(iso) : undefined;

  const text = clean(raw);
  if (!text) return { country: fromFlag ?? null, city: null };

  const lower = text.toLowerCase();
  if (NON_PLACES.has(lower)) return { country: fromFlag ?? null, city: null };

  // "Berlin -> SF" / "Berlin | SF": take the last hop, that is where they are.
  const hops = text.split(/\s*(?:->|→|=>|\||\/)\s*/).filter(Boolean);
  const current = hops.length > 1 ? hops[hops.length - 1]! : text;

  const segments = current
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  // Trailing segment first: "Cambridge, MA" and "Cambridge, UK" differ only there.
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]!.toLowerCase();
    const full = segments.slice(i - 1 >= 0 ? i - 1 : i).join(', ').toLowerCase();

    // Two-segment lookup catches the disambiguating aliases ("cambridge, ma").
    const match = BY_ALIAS.get(full) ?? BY_ALIAS.get(segment);
    if (match) {
      const cityPart = i > 0 ? segments[0]! : segments.length > 1 ? segments[0]! : null;
      const city = cityPart && cityPart.toLowerCase() !== segment ? cityPart : null;
      return { country: match, city: city ?? null };
    }
  }

  const whole = BY_ALIAS.get(lower);
  if (whole) {
    return { country: whole, city: segments.length > 1 ? segments[0]! : null };
  }

  return { country: fromFlag ?? null, city: segments[0] ?? null };
}

/** Convenience for callers that only need the country. */
export function countryFromLocation(raw: string | null | undefined): string | null {
  return normalizeLocation(raw).country;
}
