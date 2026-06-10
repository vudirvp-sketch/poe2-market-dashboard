/**
 * Client-side api_id → display name mapping for PoE2 currencies and items.
 *
 * PURPOSE:
 *   When the backend is online, flip responses include `currencyFromRu` /
 *   `currencyToRu` fields from `backend/data/currency_names_ru.py`.
 *   This file provides a FALLBACK for:
 *     1. Offline mode (backend down, only cache/prepopulated data available)
 *     2. Items not yet in the backend mapping
 *     3. Currencies table, exchange table, and other non-flip views
 *
 * USAGE:
 *   import { getCurrencyRuName, getCurrencyEnName } from "@/lib/currency-names";
 *   const ruName = getCurrencyRuName("exalted"); // "Благородная сфера"
 *
 * MAINTAINER NOTES:
 *   - Keep in sync with backend/data/currency_names_ru.py
 *   - Entries marked "(approximate)" are not verified against the official RU client
 *   - This file covers the most common/traded currencies; the full 600+ item
 *     list comes from the API at runtime
 */

// ---------------------------------------------------------------------------
// api_id → Russian name (offline fallback)
// ---------------------------------------------------------------------------

const CURRENCY_NAMES_RU: Record<string, string> = {
  // Core currencies
  "exalted": "Благородная сфера",
  "chaos": "Сфера хаоса",
  "divine": "Божественная сфера",
  "vaal": "Сфера Ваала",
  "mirror": "Зеркало Каландры",
  "alch": "Сфера алхимика",
  "transmute": "Сфера превращения",
  "aug": "Сфера дополнения",
  "chance": "Сфера удачи",
  "annul": "Сфера аннулирования",
  "regal": "Коронованная сфера",
  "whetstone": "Точильный камень кузнеца",
  "scrap": "Кусок брони",
  "bauble": "Стеклодувная бусина",
  "gcp": "Призма резчика камней",
  "etcher": "Травитель мистика",
  "artificers": "Сфера механика",
  "wisdom": "Свиток мудрости",
  "fracturing-orb": "Сфера раскалывания",
  "chance-shard": "Осколок удачи",
  "regal-shard": "Осколок коронованной сферы",
  "artificers-shard": "Осколок сферы механика",
  "transmutation-shard": "Осколок сферы превращения",
  "greater-chaos-orb": "Великая сфера хаоса",
  "greater-exalted-orb": "Великая благородная сфера",
  "greater-orb-of-transmutation": "Великая сфера превращения",
  "greater-orb-of-augmentation": "Великая сфера дополнения",
  "greater-regal-orb": "Великая коронованная сфера",
  "greater-jewellers-orb": "Великая сфера ювелира",
  "lesser-jewellers-orb": "Малая сфера ювелира",
  "perfect-chaos-orb": "Идеальная сфера хаоса",
  "perfect-exalted-orb": "Идеальная благородная сфера",
  "perfect-jewellers-orb": "Идеальная сфера ювелира",
  "perfect-orb-of-transmutation": "Идеальная сфера превращения",
  "perfect-orb-of-augmentation": "Идеальная сфера дополнения",
  "perfect-regal-orb": "Идеальная коронованная сфера",
  "cryptic-key": "Таинственный ключ",
  "hinekoras-lock": "Замок Хинекоры",
  "portal": "Свиток портала",
  "scouring": "Сфера очищения",
  "regret": "Сфера сожаления",
  "fusings": "Сфера слияния",
  "chromatic": "Хроматическая сфера",
  "jeweller": "Сфера ювелира",
  "blessed": "Благословенная сфера",
  "alteration": "Сфера перемен",
  "gold": "Золото",

  // Fragments
  "raven-touched-shard": "Осколок, тронутый вороном",
  "head-of-the-king": "Голова короля",

  // Delirium liquids (confirmed from config.yaml)
  "diluted-liquid-ire": "Разбавленный жидкий гнев",
  "diluted-liquid-guilt": "Разбавленная жидкая вина",
  "diluted-liquid-greed": "Разбавленная жидкая жадность",
  "liquid-paranoia": "Жидкая паранойя",
  "liquid-envy": "Жидкая зависть",
  "liquid-disgust": "Жидкое отвращение",
  "liquid-despair": "Жидкое отчаяние",
  "concentrated-liquid-fear": "Концентрированный жидкий страх",
  "concentrated-liquid-suffering": "Концентрированное жидкое страдание",
  "concentrated-liquid-isolation": "Концентрированное жидкое отчуждение",

  // Ritual omens (confirmed from config.yaml)
  "omen-of-whittling": "Омен вырезывания",
  "omen-of-chance": "Омен шанса",
  "omen-of-light": "Омен света",
  "omen-of-abyssal-echoes": "Омен бездных отголосков",
  "omen-of-amelioration": "Омен улучшения",
  "omen-of-sinistral-erasure": "Омен левого стирания",
  "omen-of-sinistral-annulment": "Омен левого аннулирования",
  "omen-of-dextral-annulment": "Омен правого аннулирования",
  "omen-of-dextral-erasure": "Омен правого стирания",
  "omen-of-sinistral-crystallisation": "Омен левой кристаллизации",
  "omen-of-dextral-crystallisation": "Омен правой кристаллизации",
  "omen-of-sinistral-exaltation": "Омен левого возвышения",
  "omen-of-greater-exaltation": "Омен великого возвышения",
  "omen-of-sanctification": "Омен освящения",
  "omen-of-the-blessed": "Омен благословенных",
  "omen-of-catalysing-exaltation": "Омен катализирующего возвышения",
  "omen-of-the-hunt": "Омен охоты",
  "omen-of-secret-compartments": "Омен тайных отделений",
  "omen-of-reinforcements": "Омен подкрепления",
  "omen-of-answered-prayers": "Омен отвеченных молитв",
  "omen-of-the-ancients": "Омен древних",
  "omen-of-chaotic-quantity": "Омен хаотичного количества",
  "omen-of-chaotic-monsters": "Омен хаотичных монстров",
  "omen-of-chaotic-rarity": "Омен хаотичной редкости",
  "omen-of-chaotic-effectiveness": "Омен хаотичной эффективности",
  "omen-of-sinistral-necromancy": "Омен левой некромантии",
  "omen-of-the-blackblooded": "Омен чернокровных",
  "omen-of-putrefaction": "Омен гниения",
  "omen-of-bartering": "Омен обмена",

  // Reliquary keys
  "twilight-reliquary-key": "Сумеречный ключ реликвария",
  "the-arbiters-reliquary-key": "Ключ реликвария Арбитра",
  "xeshts-reliquary-key": "Ключ реликвария Кшета",
  "ritualistic-reliquary-key": "Ритуалистический ключ реликвария",
  "olroths-reliquary-key": "Ключ реликвария Олрота",

  // Verisium
  "verisium-ore": "Веризиевая руда",
  "verisium-ingot": "Веризиевый слиток",
  "verisium-shard": "Веризиевый осколок",
};

// ---------------------------------------------------------------------------
// api_id → English name (offline fallback)
// ---------------------------------------------------------------------------

const CURRENCY_NAMES_EN: Record<string, string> = {
  "exalted": "Exalted Orb",
  "chaos": "Chaos Orb",
  "divine": "Divine Orb",
  "vaal": "Vaal Orb",
  "mirror": "Mirror of Kalandra",
  "alch": "Orb of Alchemy",
  "transmute": "Orb of Transmutation",
  "aug": "Orb of Augmentation",
  "chance": "Orb of Chance",
  "annul": "Orb of Annulment",
  "regal": "Regal Orb",
  "whetstone": "Blacksmith's Whetstone",
  "scrap": "Armourer's Scrap",
  "bauble": "Glassblower's Bauble",
  "gcp": "Gemcutter's Prism",
  "etcher": "Arcanist's Etcher",
  "artificers": "Artificer's Orb",
  "wisdom": "Scroll of Wisdom",
  "fracturing-orb": "Fracturing Orb",
  "chance-shard": "Chance Shard",
  "regal-shard": "Regal Shard",
  "artificers-shard": "Artificer's Shard",
  "transmutation-shard": "Transmutation Shard",
  "greater-chaos-orb": "Greater Chaos Orb",
  "greater-exalted-orb": "Greater Exalted Orb",
  "greater-orb-of-transmutation": "Greater Orb of Transmutation",
  "greater-orb-of-augmentation": "Greater Orb of Augmentation",
  "greater-regal-orb": "Greater Regal Orb",
  "greater-jewellers-orb": "Greater Jeweller's Orb",
  "lesser-jewellers-orb": "Lesser Jeweller's Orb",
  "perfect-chaos-orb": "Perfect Chaos Orb",
  "perfect-exalted-orb": "Perfect Exalted Orb",
  "perfect-jewellers-orb": "Perfect Jeweller's Orb",
  "perfect-orb-of-transmutation": "Perfect Orb of Transmutation",
  "perfect-orb-of-augmentation": "Perfect Orb of Augmentation",
  "perfect-regal-orb": "Perfect Regal Orb",
  "cryptic-key": "Cryptic Key",
  "hinekoras-lock": "Hinekora's Lock",
  "portal": "Portal Scroll",
  "scouring": "Orb of Scouring",
  "regret": "Orb of Regret",
  "fusings": "Orb of Fusing",
  "chromatic": "Chromatic Orb",
  "jeweller": "Jeweller's Orb",
  "blessed": "Blessed Orb",
  "alteration": "Orb of Alteration",
  "gold": "Gold",
};

// ---------------------------------------------------------------------------
// Lookup functions
// ---------------------------------------------------------------------------

/**
 * Get the Russian display name for a currency by api_id.
 * Falls back to the api_id itself if no mapping exists.
 */
export function getCurrencyRuName(apiId: string): string | null {
  return CURRENCY_NAMES_RU[apiId] ?? CURRENCY_NAMES_RU[apiId.toLowerCase()] ?? null;
}

/**
 * Get the English display name for a currency by api_id.
 * Falls back to the api_id itself if no mapping exists.
 */
export function getCurrencyEnName(apiId: string): string | null {
  return CURRENCY_NAMES_EN[apiId] ?? CURRENCY_NAMES_EN[apiId.toLowerCase()] ?? null;
}

/**
 * Get a display name for a currency pair like "exalted/chaos".
 * Uses Russian names if available, falls back to api_ids.
 */
export function getCurrencyPairDisplayName(
  pairStr: string,
  locale: "ru" | "en" = "ru",
): string {
  const parts = pairStr.split("/");
  if (parts.length !== 2) return pairStr;

  const lookup = locale === "ru" ? getCurrencyRuName : getCurrencyEnName;
  const from = lookup(parts[0]) ?? parts[0];
  const to = lookup(parts[1]) ?? parts[1];
  return `${from}/${to}`;
}
