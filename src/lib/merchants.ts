/**
 * Clean merchant names from SMS / statements: "MAKEMYTRIP INDI" → "MakeMyTrip",
 * "BUNDL TECHNOLOGIES PVT" → "Swiggy", "CHAI POINT PVT LTD" → "Chai Point".
 */

/** Brand keys (lowercase, letters/digits only) → display name. Includes legal names seen on card SMS. */
const BRANDS: [string, string][] = [
  ["makemytrip", "MakeMyTrip"],
  ["goibibo", "Goibibo"],
  ["cleartrip", "Cleartrip"],
  ["amazonpay", "Amazon Pay"],
  ["amazon", "Amazon"],
  ["flipkart", "Flipkart"],
  ["myntra", "Myntra"],
  ["ajio", "AJIO"],
  ["nykaa", "Nykaa"],
  ["meesho", "Meesho"],
  ["swiggy", "Swiggy"],
  ["bundltechnologies", "Swiggy"],
  ["instamart", "Swiggy Instamart"],
  ["zomato", "Zomato"],
  ["blinkit", "Blinkit"],
  ["blinkcommerce", "Blinkit"],
  ["zepto", "Zepto"],
  ["kiranakart", "Zepto"],
  ["bigbasket", "BigBasket"],
  ["innovativeretail", "BigBasket"],
  ["dmart", "DMart"],
  ["avenuesupermarts", "DMart"],
  ["jiomart", "JioMart"],
  ["reliancefresh", "Reliance Fresh"],
  ["uberindia", "Uber"],
  ["anitechnologies", "Ola"],
  ["olacabs", "Ola"],
  ["roppen", "Rapido"],
  ["rapido", "Rapido"],
  ["irctc", "IRCTC"],
  ["redbus", "redBus"],
  ["indigo", "IndiGo"],
  ["interglobe", "IndiGo"],
  ["airindia", "Air India"],
  ["bookmyshow", "BookMyShow"],
  ["bigtreeentertainment", "BookMyShow"],
  ["netflix", "Netflix"],
  ["spotify", "Spotify"],
  ["hotstar", "Disney+ Hotstar"],
  ["youtube", "YouTube"],
  ["googleplay", "Google Play"],
  ["appleservices", "Apple"],
  ["applecombill", "Apple"],
  ["airtel", "Airtel"],
  ["bhartiairtel", "Airtel"],
  ["reliancejio", "Jio"],
  ["vodafone", "Vi"],
  ["tatapower", "Tata Power"],
  ["bescom", "BESCOM"],
  ["phonepe", "PhonePe"],
  ["one97", "Paytm"],
  ["paytm", "Paytm"],
  ["cred", "CRED"],
  ["dreamplug", "CRED"],
  ["zerodha", "Zerodha"],
  ["indmoney", "INDmoney"],
  ["indstocks", "INDmoney"],
  ["groww", "Groww"],
  ["nextbillion", "Groww"],
  ["kuvera", "Kuvera"],
  ["starbucks", "Starbucks"],
  ["tatastarbucks", "Starbucks"],
  ["dominos", "Domino's"],
  ["jubilantfoodworks", "Domino's"],
  ["mcdonald", "McDonald's"],
  ["hardcastle", "McDonald's"],
  ["chaayos", "Chaayos"],
  ["haldiram", "Haldiram's"],
  ["decathlon", "Decathlon"],
  ["ikea", "IKEA"],
  ["croma", "Croma"],
  ["urbancompany", "Urban Company"],
  ["apollopharmacy", "Apollo Pharmacy"],
  ["pharmeasy", "PharmEasy"],
  ["tata1mg", "Tata 1mg"],
  ["practo", "Practo"],
  ["cultfit", "cult.fit"],
  ["curefit", "cult.fit"],
];

/** Short brands need a whole-word match ("ola" must not match "coca cola"). */
const SHORT_BRANDS: [RegExp, string][] = [
  [/\bola\b/, "Ola"],
  [/\buber\b/, "Uber"],
  [/\bkfc\b/, "KFC"],
  [/\bjio\b/, "Jio"],
  [/\bpvr\b/, "PVR"],
  [/\binox\b/, "INOX"],
  [/\bvi\b/, "Vi"],
];

/** Company-form words dropped from the end of unknown names (SMS often cuts them short: "PRIVA", "INDI", "LIMI"). */
const SUFFIXES = ["private", "limited", "pvt", "ltd", "llp", "india", "technologies", "technology", "internet", "services", "solutions", "payments", "retail", "online", "ventures", "enterprises", "co", "inc", "corp"];

function isSuffix(token: string): boolean {
  const t = token.toLowerCase().replace(/\.$/, "");
  return t.length >= 2 && SUFFIXES.some((s) => s === t || (t.length >= 3 && s.startsWith(t)));
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s.&])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

export function cleanMerchantName(raw: string): string {
  const spaced = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const compact = spaced.replace(/ /g, "");
  for (const [key, name] of BRANDS) if (compact.includes(key)) return name;
  for (const [re, name] of SHORT_BRANDS) if (re.test(spaced)) return name;

  const tokens = raw.trim().split(/\s+/);
  while (tokens.length > 1 && isSuffix(tokens[tokens.length - 1])) tokens.pop();
  return titleCase(tokens.join(" "));
}
