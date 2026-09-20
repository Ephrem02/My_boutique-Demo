// Keyword -> emoji fallback used when a product has no photo (image_url) yet.
// Matched against the product name, case-insensitively, in order.
const ICON_RULES = [
  [/milk|yog(h)?urt|cheese|butter/i, '🥛'],
  [/beer|lager/i, '🍺'],
  [/wine/i, '🍷'],
  [/water/i, '💧'],
  [/soda|juice|fanta|coca|pepsi|sprite|drink/i, '🥤'],
  [/tea\b/i, '🍵'],
  [/coffee/i, '☕'],
  [/rice/i, '🍚'],
  [/bread|bun\b/i, '🍞'],
  [/cake|pastry/i, '🍰'],
  [/biscuit|cookie/i, '🍪'],
  [/chocolate|candy|sweet/i, '🍫'],
  [/chips|crisps|popcorn|snack/i, '🍿'],
  [/egg/i, '🥚'],
  [/chicken|poultry/i, '🍗'],
  [/beef|meat|pork|sausage/i, '🥩'],
  [/fish/i, '🐟'],
  [/banana/i, '🍌'],
  [/apple/i, '🍎'],
  [/orange|citrus/i, '🍊'],
  [/tomato/i, '🍅'],
  [/onion|potato|vegetable|cassava|carrot/i, '🥔'],
  [/flour|maize|posho|ugali|wheat/i, '🌽'],
  [/sugar|salt/i, '🧂'],
  [/oil\b|cooking oil/i, '🫙'],
  [/bean|lentil/i, '🫘'],
  [/soap|detergent|wash/i, '🧼'],
  [/toothpaste|toothbrush/i, '🪥'],
  [/tissue|toilet paper|napkin/i, '🧻'],
  [/shampoo|lotion|cosmetic/i, '🧴'],
  [/pasta|spaghetti|noodle/i, '🍝'],
  [/cigarette|tobacco/i, '🚬'],
];

export function getProductIcon(name = '') {
  for (const [pattern, icon] of ICON_RULES) {
    if (pattern.test(name)) return icon;
  }
  return '🛒';
}
