const en = {
  // App
  appTitle: "PoE2 Market",
  appDescription: "Monitor Path of Exile 2 market prices, unique items, and currency exchange rates.",

  // Tabs
  tabOverview: "Overview",
  tabCurrencies: "Currencies",
  tabUniques: "Uniques",
  tabExchange: "Exchange",
  tabArbitrage: "Arbitrage",
  tabWatchlist: "Watchlist",

  // Header
  searchPlaceholder: "Search items...",
  autoRefresh: "Auto",
  refresh: "Refresh",
  baseCurrency: "Base Currency",
  defaultCurrency: "Default",
  realm: "Realm",
  league: "League",
  loading: "Loading...",
  inactive: "inactive",

  // Overview
  totalVolume24h: "Total Volume (24h)",
  trackedItems: "Tracked Items",
  exchangePairs: "Exchange Pairs",
  marketVolumeTrend: "Market Volume Trend (7 days)",
  topMovers: "Top Movers",
  topGainers: "Top Gainers",
  topLosers: "Top Losers",
  noData: "No data",

  // Currencies
  lowConfidence: "Low Confidence",
  vol: "Vol",
  noCurrencies: "No currencies found",

  // Uniques
  item: "Item",
  price: "Price",
  change: "Change",
  sevenDay: "7d",
  volume: "Volume",
  trend: "Trend",
  noUniques: "No unique items found",

  // Exchange
  noExchangePairs: "No exchange pairs found",

  // Pagination
  perPage: "Per page:",
  items: "items",
  pageOf: "Page {0} of {1}",

  // Detail Dialog
  priceLabel: "Price",
  change24h: "24h Change",
  change7d: "7d Change",
  hourly: "Hourly",
  dailyCandlestick: "Daily (Candlestick)",
  priceHistory: "Price History",
  tradingVolume: "Trading Volume",
  dailyCandlestickTitle: "Daily Candlestick",
  dailyVolume: "Daily Volume",
  noHistory: "No history data available",
  noDailyStats: "No daily stats available",

  // Pair Detail Dialog
  current: "Current",
  min: "Min",
  max: "Max",
  average: "Average",
  spread: "Spread",
  relativePriceOverTime: "Relative Price Over Time",
  noPairHistory: "No pair history available",

  // Comparison Dialog
  itemComparison: "Item Comparison",
  selectAtLeast2Items: "Select at least 2 items to compare",
  clearAll: "Clear all",
  loadingComparison: "Loading comparison data...",
  priceChangeComparison: "Price Change Comparison (% from start)",
  currentItem: "Item",
  currentPrice: "Current Price",
  startPrice: "Start Price",
  addItemsToCompare: "Add items to comparison from the Currencies or Uniques tabs",
  needAtLeast2Items: "You need at least 2 items with history data",

  // Pair Comparison Dialog
  exchangePairComparison: "Exchange Pair Comparison",
  selectAtLeast2Pairs: "Select at least 2 pairs to compare",
  pair: "Pair",
  addPairsToCompare: "Add exchange pairs to comparison from the Exchange Pairs tab",
  needAtLeast2Pairs: "You need at least 2 pairs with history data",

  // Price Alert Dialog
  priceAlerts: "Price Alerts",
  priceAlertsDescription: "Set price thresholds on favorited items and get browser notifications when they are crossed.",
  notificationsBlocked: "Browser notifications are blocked",
  notificationsBlockedDesc: "You need to grant notification permission to receive price alerts.",
  enableNotifications: "Enable Notifications",
  notificationsNotSupported: "Browser notifications not supported",
  notificationsNotSupportedDesc: "Your browser does not support the Notification API.",
  activeAlerts: "Active Alerts",
  noAlerts: "No price alerts set",
  noAlertsDesc: "Add an alert below to get notified when prices cross your thresholds",
  above: "Above",
  below: "Below",
  now: "now",
  addAlert: "Add Alert",
  needFavoritesFirst: "You need to favorite items first before setting alerts.",
  selectFavoritedItem: "Select a favorited item...",
  thresholdPrice: "Threshold price",
  testNotification: "Test Notification",
  disableAlert: "Disable alert",
  enableAlert: "Enable alert",
  removeAlert: "Remove alert",

  // Arbitrage
  arbitrageTheoretical: "Arbitrage opportunities are theoretical",
  arbitrageTheoreticalDesc: "Market prices change rapidly. Slippage is estimated using a square-root impact model. Actual results may vary. Always verify current rates before trading.",
  scannedPairs: "Scanned Pairs",
  ofTotal: "of {0} total (volume \u2265 {1})",
  currencies: "Currencies",
  uniqueTokensInGraph: "unique tokens in graph",
  opportunitiesFound: "Opportunities Found",
  cyclesWithPositiveNetProfit: "cycles with positive net profit",
  arbitrageOpportunities: "Arbitrage Opportunities",
  settings: "Settings",
  noArbitrage: "No arbitrage opportunities detected",
  noArbitrageDesc: "This is normal \u2014 efficient markets rarely have exploitable cycles. Try refreshing later or check a different league. You can also adjust slippage/fee settings.",
  route: "Route",
  len: "Len",
  netProfit: "Net Profit",
  gross: "Gross",
  slippage: "Slippage",
  maxVol: "Max Vol",
  net: "net",
  showingTopOpportunities: "Showing top {0} opportunities sorted by net profit. Cycle length limited to {1} edges. Pairs with volume < {2} are excluded. Slippage: square-root model ({3} bps base). Fee: {4} bps.",
  adjustSettings: "Adjust these parameters to model realistic trading conditions. Slippage uses a square-root impact model based on trade size vs. pair volume.",
  tradingFeeBps: "Trading Fee (bps)",
  poeNoFees: "PoE has no explicit fees (0). Set 0 by default.",
  baseSlippageBps: "Base Slippage (bps)",
  baseSlippageDesc: "Base slippage per trade. 10 = 0.1%.",
  tradeSizeForProfit: "Trade Size (for profit estimate)",
  tradeSizeDesc: "Currency amount to estimate net profit for.",

  // Watchlist
  noFavorites: "No favorites yet",
  noFavoritesDesc: "Click the star icon on any item to add it to your watchlist",
  favoritedNotFound: "Favorited items not found in current league",
  favoritedNotFoundDesc: "Try switching leagues or add new favorites",

  // Error Boundary
  encounteredError: "{0} encountered an error",
  errorBoundaryDesc: "Something went wrong while rendering this section. The rest of the dashboard is still functional. You can try reloading this section.",
  errorDetails: "Error details",
  retry: "Retry",

  // API Error Fallback
  networkError: "Network error \u2014 check your connection",
  rateLimited: "Rate limited \u2014 please wait a moment",
  failedToLoadData: "Failed to load data",
  connectionLost: "Connection lost",
  tooManyRequests: "Too many requests",
  connectionLostDesc: "Unable to reach the server. Please check your internet connection and try again.",
  tooManyRequestsDesc: "The API is receiving too many requests. Please wait a moment before trying again.",
  failedToLoadDataDesc: "There was an error loading data from the server. This might be a temporary issue.",
  tryAgain: "Try again",
  retrying: "Retrying...",
  technicalDetails: "Technical details",

  // Offline Banner
  offlineMessage: "You are offline. Showing cached data.",
  dismissOffline: "Dismiss offline banner",

  // Select realm/league prompt
  selectRealmLeague: "Select a realm and league to begin",

  // Alerts button
  alerts: "Alerts",
  alertsCount: "Alerts ({0})",

  // Compare button
  compare: "Compare ({0})",
  pairCompare: "Pair Compare ({0})",

  // Compare tooltip
  removeFromComparison: "Remove from comparison",
  addToComparison: "Add to comparison",
  removeFromFavorites: "Remove from favorites",
  addToFavorites: "Add to favorites",

  // Category filter
  all: "All",

  // Export
  exportCsv: "CSV",
  exportJson: "JSON",

  // Time ago
  secondsAgo: "{0}s ago",
  minutesAgo: "{0}m ago",

  // Language
  language: "Language",
  english: "English",
  russian: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439",

  // Timeframes
  timeframe24h: "24h",
  timeframe7d: "7d",
} as const;

export default en;
export type TranslationKeys = keyof typeof en;
