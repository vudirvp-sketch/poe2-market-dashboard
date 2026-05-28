import type { TranslationKeys } from "./en";

const ko: Record<TranslationKeys, string> = {
  // App
  appTitle: "PoE2 \uC2DC\uC7A5",
  appDescription: "Path of Exile 2 \uC2DC\uC7A5 \uAC00\uACA9, \uC720\uB2C8\uD06C \uC544\uC774\uD15C \uBC0F \uD1B5\uD654 \uD658\uC728\uC744 \uBAA8\uB2C8\uD130\uB9C1\uD569\uB2C8\uB2E4.",

  // Tabs
  tabOverview: "\uAC1C\uC694",
  tabCurrencies: "\uD1B5\uD654",
  tabUniques: "\uC720\uB2C8\uD06C",
  tabExchange: "\uAD50\uD658",
  tabArbitrage: "\uCC44\uAD8C\uD2B8\uB77C\uC9C0",
  tabForecast: "Forecasts",
  tabWatchlist: "\uAD00\uC2EC\uBAA9\uB85D",

  // Header
  searchPlaceholder: "\uC544\uC774\uD15C \uAC80\uC0C9...",
  autoRefresh: "\uC790\uB3D9",
  refresh: "\uC0C8\uB85C\uACE0\uCE68",
  baseCurrency: "\uAE30\uC900 \uD1B5\uD654",
  defaultCurrency: "\uAE30\uBCF8\uAC12",
  realm: "\uC11C\uBC84",
  league: "\uB9AC\uADF8",
  loading: "\uB85C\uB529...",
  inactive: "\uBE44\uD65C\uC131",

  // Overview
  totalVolume24h: "\uCD1D \uAC70\uB798\uB7C9 (24\uC2DC)",
  trackedItems: "\uCD94\uC801 \uC544\uC774\uD15C",
  exchangePairs: "\uAD50\uD658 \uD398\uC5B4",
  marketVolumeTrend: "\uC2DC\uC7A5 \uAC70\uB798\uB7C9 \uB3D9\uD5A5 (7\uC77C)",
  topMovers: "\uB3C4\uC6B8 \uC885\uBAA9",
  topGainers: "\uC0C1\uC2B9 \uC885\uBAA9",
  topLosers: "\uD558\uB77D \uC885\uBAA9",
  noData: "\uB370\uC774\uD130 \uC5C6\uC74C",

  // Currencies
  lowConfidence: "\uC2E0\uB8B0\uB3C4 \uB0AE\uC74C",
  vol: "\uB7C9",
  noCurrencies: "\uD1B5\uD654\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC74C",

  // Uniques
  item: "\uC544\uC774\uD15C",
  price: "\uAC00\uACA9",
  change: "\uBCC0\uB3D9",
  sevenDay: "7\uC77C",
  volume: "\uAC70\uB798\uB7C9",
  trend: "\uB3D9\uD5A5",
  noUniques: "\uC720\uB2C8\uD06C \uC544\uC774\uD15C\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC74C",

  // Exchange
  noExchangePairs: "\uAD50\uD658 \uD398\uC5B4\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC74C",

  // Pagination
  perPage: "\uD398\uC774\uC9C0\uB2F9:",
  items: "\uAC1C",
  pageOf: "\uD398\uC774\uC9C0 {0} / {1}",

  // Detail Dialog
  priceLabel: "\uAC00\uACA9",
  change24h: "24\uC2DC \uBCC0\uB3D9",
  change7d: "7\uC77C \uBCC0\uB3D9",
  hourly: "\uC2DC\uAC04\uBCC4",
  dailyCandlestick: "\uC77C\uBCC4 \uCE94\uB4DC\uB77C\uC2A4\uD2F1",
  priceHistory: "\uAC00\uACA9 \uD788\uC2A4\uD1A0\uB9AC",
  tradingVolume: "\uAC70\uB798\uB7C9",
  dailyCandlestickTitle: "\uC77C\uBCC4 \uCE94\uB4DC\uB77C\uC2A4\uD2F1",
  dailyVolume: "\uC77C\uBCC4 \uAC70\uB798\uB7C9",
  noHistory: "\uD788\uC2A4\uD1A0\uB9AC \uB370\uC774\uD130 \uC5C6\uC74C",
  noDailyStats: "\uC77C\uBCC4 \uD1B5\uACC4 \uB370\uC774\uD130 \uC5C6\uC74C",

  // Pair Detail Dialog
  current: "\uD604\uC7AC",
  min: "\uCD5C\uC800",
  max: "\uCD5C\uACE0",
  average: "\uD3C9\uADE0",
  spread: "\uC2A4\uD504\uB808\uB4DC",
  relativePriceOverTime: "\uC2DC\uAC04\uBCC4 \uC0C1\uB300 \uAC00\uACA9",
  noPairHistory: "\uD398\uC5B4 \uD788\uC2A4\uD1A0\uB9AC \uC5C6\uC74C",

  // Comparison Dialog
  itemComparison: "\uC544\uC774\uD15C \uBE44\uAD50",
  selectAtLeast2Items: "\uBE44\uAD50\uD560 2\uAC1C \uC774\uC0C1\uC758 \uC544\uC774\uD15C\uC744 \uC120\uD0DD\uD558\uC138\uC694",
  clearAll: "\uBAA8\uB450 \uC9C0\uC6B0\uAE30",
  loadingComparison: "\uBE44\uAD50 \uB370\uC774\uD130 \uB85C\uB529\uC911...",
  priceChangeComparison: "\uAC00\uACA9 \uBCC0\uB3D9 \uBE44\uAD50 (% \uC2DC\uC791\uAC00\uACA9\uAE30\uC900)",
  currentItem: "\uC544\uC774\uD15C",
  currentPrice: "\uD604\uC7AC \uAC00\uACA9",
  startPrice: "\uC2DC\uC791 \uAC00\uACA9",
  addItemsToCompare: "\uD1B5\uD654 \uB610\uB294 \uC720\uB2C8\uD06C \uD0ED\uC5D0\uC11C \uBE44\uAD50\uD560 \uC544\uC774\uD15C \uCD94\uAC00",
  needAtLeast2Items: "\uD788\uC2A4\uD1A0\uB9AC \uB370\uC774\uD130\uAC00 \uC788\uB294 2\uAC1C \uC774\uC0C1\uC758 \uC544\uC774\uD15C\uC774 \uD544\uC694\uD569\uB2C8\uB2E4",

  // Pair Comparison Dialog
  exchangePairComparison: "\uAD50\uD658 \uD398\uC5B4 \uBE44\uAD50",
  selectAtLeast2Pairs: "\uBE44\uAD50\uD560 2\uAC1C \uC774\uC0C1\uC758 \uD398\uC5B4\uB97C \uC120\uD0DD\uD558\uC138\uC694",
  pair: "\uD398\uC5B4",
  addPairsToCompare: "\uAD50\uD658 \uD0ED\uC5D0\uC11C \uBE44\uAD50\uD560 \uD398\uC5B4 \uCD94\uAC00",
  needAtLeast2Pairs: "\uD788\uC2A4\uD1A0\uB9AC \uB370\uC774\uD130\uAC00 \uC788\uB294 2\uAC1C \uC774\uC0C1\uC758 \uD398\uC5B4\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4",

  // Price Alert Dialog
  priceAlerts: "\uAC00\uACA9 \uC54C\uB9BC",
  priceAlertsDescription: "\uAD00\uC2EC \uC544\uC774\uD15C\uC5D0 \uAC00\uACA9 \uC784\uACC4\uAC12\uC744 \uC124\uC815\uD558\uACE0 \uCD08\uACFC \uC2DC \uBE0C\uB77C\uC6B0\uC800 \uC54C\uB9BC\uC744 \uBC1B\uC73C\uC138\uC694.",
  notificationsBlocked: "\uBE0C\uB77C\uC6B0\uC800 \uC54C\uB9BC\uC774 \uCC28\uB2E8\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
  notificationsBlockedDesc: "\uAC00\uACA9 \uC54C\uB9BC\uC744 \uBC1B\uB824\uBA74 \uC54C\uB9BC \uAD8C\uD55C\uC744 \uD5C8\uAC00\uD574\uC57C \uD569\uB2C8\uB2E4.",
  enableNotifications: "\uC54C\uB9BC \uD65C\uC131\uD654",
  notificationsNotSupported: "\uBE0C\uB77C\uC6B0\uC800\uAC00 \uC54C\uB9BC\uC744 \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4",
  notificationsNotSupportedDesc: "\uBE0C\uB77C\uC6B0\uC800\uAC00 Notification API\uB97C \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
  activeAlerts: "\uD65C\uC131 \uC54C\uB9BC",
  noAlerts: "\uAC00\uACA9 \uC54C\uB9BC\uC774 \uC5C6\uC2B5\uB2C8\uB2E4",
  noAlertsDesc: "\uC544\uB798\uC5D0\uC11C \uC54C\uB9BC\uC744 \uCD94\uAC00\uD558\uBA74 \uAC00\uACA9\uC774 \uC784\uACC4\uAC12\uC744 \uCD08\uACFC\uD560 \uB54C \uC54C\uB9BC\uC744 \uBC1B\uC2B5\uB2C8\uB2E4",
  above: "\uC774\uC0C1",
  below: "\uC774\uD558",
  now: "\uD604\uC7AC",
  addAlert: "\uC54C\uB9BC \uCD94\uAC00",
  needFavoritesFirst: "\uC54C\uB9BC\uC744 \uC124\uC815\uD558\uB824\uBA74 \uBA3C\uC800 \uC544\uC774\uD15C\uC744 \uAD00\uC2EC\uBAA9\uB85D\uC5D0 \uCD94\uAC00\uD558\uC138\uC694.",
  selectFavoritedItem: "\uAD00\uC2EC \uC544\uC774\uD15C \uC120\uD0DD...",
  thresholdPrice: "\uC784\uACC4 \uAC00\uACA9",
  testNotification: "\uD14C\uC2A4\uD2B8 \uC54C\uB9BC",
  disableAlert: "\uC54C\uB9BC \uBE44\uD65C\uC131\uD654",
  enableAlert: "\uC54C\uB9BC \uD65C\uC131\uD654",
  removeAlert: "\uC54C\uB9BC \uC0AD\uC81C",

  // Arbitrage
  arbitrageTheoretical: "\uCC44\uAD8C\uD2B8\uB77C\uC9C0 \uAE30\uD68C\uB294 \uC774\uB860\uC801\uC785\uB2C8\uB2E4",
  arbitrageTheoreticalDesc: "\uC2DC\uC7A5 \uAC00\uACA9\uC740 \uBE68\uB9AC \uBCC0\uB3D9\uB429\uB2C8\uB2E4. \uBBF8\uB7EC\uC2DC\uB294 \uC81C\uACF1\uADF8 \uC601\uD5A5 \uBAA8\uB378\uB85C \uCD94\uC815\uB429\uB2C8\uB2E4. \uC2E4\uC81C \uACB0\uACFC\uB294 \uB2E4\uB97C \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uAC70\uB798 \uC804 \uD56D\uC0C1 \uD604\uC7AC \uD658\uC728\uC744 \uD655\uC778\uD558\uC138\uC694.",
  scannedPairs: "\uAC80\uC0C9\uB41C \uD398\uC5B4",
  ofTotal: "\uCD1D {0} \uAC1C (\uAC70\uB798\uB7C9 \u2265 {1})",
  currencies: "\uD1B5\uD654",
  uniqueTokensInGraph: "\uADF8\uB798\uD504 \uB0B4 \uACE0\uC720 \uD1B5\uD654",
  opportunitiesFound: "\uBC1C\uACAC\uB41C \uAE30\uD68C",
  cyclesWithPositiveNetProfit: "\uC591\uC758 \uC21C\uC774\uC775 \uC0AC\uC774\uD074",
  arbitrageOpportunities: "\uCC44\uAD8C\uD2B8\uB77C\uC9C0 \uAE30\uD68C",
  settings: "\uC124\uC815",
  noArbitrage: "\uCC44\uAD8C\uD2B8\uB77C\uC9C0 \uAE30\uD68C\uAC00 \uAC10\uC9C0\uB418\uC9C0 \uC54A\uC74C",
  noArbitrageDesc: "\uC815\uC0C1\uC785\uB2C8\uB2E4 \u2014 \uD6A8\uC728\uC801\uC778 \uC2DC\uC7A5\uC740 \uC774\uC6A9 \uAC00\uB2A5\uD55C \uC0AC\uC774\uD074\uC774 \uB4DC\uBBD5\uB2C8\uB2E4. \uB098\uC911\uC5D0 \uC0C8\uB85C\uACE0\uCE68\uD558\uAC70\uB098 \uB2E4\uB978 \uB9AC\uADF8\uC744 \uD655\uC778\uD558\uC138\uC694. \uBBF8\uB7EC\uC2DC/\uC218\uC218\uB8CC \uC124\uC815\uC744 \uC870\uC815\uD560 \uC218\uB3C4 \uC788\uC2B5\uB2C8\uB2E4.",
  route: "\uACBD\uB85C",
  len: "\uAE38\uC774",
  netProfit: "\uC21C\uC774\uC775",
  gross: "\uCD1D\uC774\uC775",
  slippage: "\uBBF8\uB7EC\uC2DC",
  maxVol: "\uCD5C\uB300 \uB7C9",
  net: "\uC21C",
  showingTopOpportunities: "\uC21C\uC774\uC775\uC21C \uC0C1\uC704 {0}\uAC1C \uAE30\uD68C. \uC0AC\uC774\uD074 \uAE38\uC774 \uC81C\uD55C {1}. \uAC70\uB798\uB7C9 < {2} \uD398\uC5B4 \uC81C\uC678. \uBBF8\uB7EC\uC2DC: \uC81C\uACF1\uADF8 \uBAA8\uB378 ({3} bps). \uC218\uC218\uB8CC: {4} bps.",
  adjustSettings: "\uC2E4\uC81C \uAC70\uB798 \uC870\uAC74\uC744 \uBAA8\uB378\uB9C1\uD558\uB3C4\uB85D \uB9E4\uAC1C\uBCC0\uC218\uB97C \uC870\uC815\uD558\uC138\uC694. \uBBF8\uB7EC\uC2DC\uB294 \uAC70\uB798 \uD06C\uAE30\uC640 \uD398\uC5B4 \uAC70\uB798\uB7C9\uC758 \uBE44\uC728\uC5D0 \uAE30\uBC18\uD55C \uC81C\uACF1\uADF8 \uC601\uD5A5 \uBAA8\uB378\uC744 \uC0AC\uC6A9\uD569\uB2C8\uB2E4.",
  tradingFeeBps: "\uAC70\uB798 \uC218\uC218\uB8CC (bps)",
  poeNoFees: "PoE\uC5D0\uB294 \uBA85\uC2DC\uC801\uC778 \uC218\uC218\uB8CC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4 (0). \uAE30\uBCF8\uAC12 0\uC73C\uB85C \uC124\uC815.",
  baseSlippageBps: "\uAE30\uBCF8 \uBBF8\uB7EC\uC2DC (bps)",
  baseSlippageDesc: "\uAC70\uB798\uB2F9 \uAE30\uBCF8 \uBBF8\uB7EC\uC2DC. 10 = 0.1%.",
  tradeSizeForProfit: "\uAC70\uB798 \uD06C\uAE30 (\uC774\uC775 \uCD94\uC815\uC6A9)",
  tradeSizeDesc: "\uC21C\uC774\uC775\uC744 \uCD94\uC815\uD560 \uD1B5\uD654 \uC218\uB7C9.",

  // Arbitrage — Confidence indicator (Task 6.9)
  confidence: "\uC2E0\uB8B0\uB3C4",
  confidenceHigh: "\uB192\uC74C",
  confidenceMedium: "\uC911\uAC04",
  confidenceLow: "\uB0AE\uC74C",
  confidenceDesc: "\uAC70\uB798\uB7C9 \uAE30\uBC18 \uC2E0\uB8B0\uB3C4: \uD398\uC5B4\uC758 \uAC70\uB798\uB7C9\uC774 \uAC70\uB798 \uD06C\uAE30\uB97C \uC5BC\uB9C8\uB098 \uC9C0\uC6D0\uD558\uB294\uC9C0. \uB192\uC74C = \uAC70\uB798\uB7C9\uC774 \uAC70\uB798 \uD06C\uAE30\uB97C \uD06C\uAC8C \uCD08\uACFC; \uB0AE\uC74C = \uBBF8\uB7EC\uC2DC\uAC00 \uB9E4\uC6B0 \uBD88\uD655\uC2E4\uD568.",
  timeDecayLabel: "\uC2DC\uAC04 \uAC10\uC1C4",
  timeDecayDesc: "\uB370\uC774\uD130 \uC2E0\uC120\uB3C4\uC5D0 \uAE30\uBC18\uD558\uC5EC \uD658\uC728\uC5D0 \uC9C0\uC218 \uAC10\uC1C4 \uAC00\uC911\uCE58\uB97C \uC801\uC6A9\uD569\uB2C8\uB2E4. Lambda\uB294 \uAC10\uC1C4 \uC18D\uB3C4\uB97C \uC81C\uC5B4\uD569\uB2C8\uB2E4 (\uB192\uC74C = \uBE68\uB77C\uC9D0). 0 = \uAC10\uC1C4 \uC5C6\uC74C.",
  decayLambda: "\uAC10\uC1C4 Lambda (\u03BB)",

  // Watchlist
  noFavorites: "\uAD00\uC2EC\uBAA9\uB85D\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4",
  noFavoritesDesc: "\uC544\uC774\uD15C\uC758 \uBCC4 \uC544\uC774\uCF58\uC744 \uD074\uB9AD\uD558\uC5EC \uAD00\uC2EC\uBAA9\uB85D\uC5D0 \uCD94\uAC00\uD558\uC138\uC694",
  favoritedNotFound: "\uAD00\uC2EC \uC544\uC774\uD15C\uC744 \uD604\uC7AC \uB9AC\uADF8\uC5D0\uC11C \uCC3E\uC744 \uC218 \uC5C6\uC74C",
  favoritedNotFoundDesc: "\uB9AC\uADF8\uC744 \uBCC0\uACBD\uD558\uAC70\uB098 \uC0C8 \uAD00\uC2EC\uBAA9\uB85D\uC744 \uCD94\uAC00\uD558\uC138\uC694",

  // Error Boundary
  encounteredError: "{0}\uC5D0 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4",
  errorBoundaryDesc: "\uC774 \uC139\uC158\uC744 \uB80C\uB354\uB9C1\uD558\uB294 \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uB300\uC2DC\uBCF4\uB4DC \uB098\uBA38\uC9C0\uB294 \uACC4\uC18D \uC815\uC0C1\uC801\uC73C\uB85C \uC791\uB3D9\uD569\uB2C8\uB2E4. \uC774 \uC139\uC158\uC744 \uB2E4\uC2DC \uB85C\uB529\uD574 \uBCF4\uC138\uC694.",
  errorDetails: "\uC624\uB958 \uC138\uBD80\uC0AC\uD56D",
  retry: "\uC7AC\uC2DC\uB3C4",

  // API Error Fallback
  networkError: "\uB124\uD2B8\uC6CC\uD06C \uC624\uB958 \u2014 \uC5F0\uACB0\uC744 \uD655\uC778\uD558\uC138\uC694",
  rateLimited: "\uC694\uCCAD \uC81C\uD55C \u2014 \uC7A0\uC2DC \uAE30\uB2E4\uB824\uC8FC\uC138\uC694",
  failedToLoadData: "\uB370\uC774\uD130 \uB85C\uB529 \uC2E4\uD328",
  connectionLost: "\uC5F0\uACB0 \uC0C1\uC2E4",
  tooManyRequests: "\uC694\uCCAD \uCD08\uACFC",
  connectionLostDesc: "\uC11C\uBC84\uC5D0 \uC5F0\uACB0\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC778\uD130\uB137 \uC5F0\uACB0\uC744 \uD655\uC778\uD558\uACE0 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694.",
  tooManyRequestsDesc: "API\uC5D0 \uB108\uBB34 \uB9CE\uC740 \uC694\uCCAD\uC774 \uB4E4\uC5B4\uC624\uACE0 \uC788\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694.",
  failedToLoadDataDesc: "\uC11C\uBC84\uC5D0\uC11C \uB370\uC774\uD130\uB97C \uB85C\uB529\uD558\uB294 \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uC77C\uC2DC\uC801\uC778 \uBB38\uC81C\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
  tryAgain: "\uB2E4\uC2DC \uC2DC\uB3C4",
  retrying: "\uC7AC\uC2DC\uB3C4 \uC911...",
  technicalDetails: "\uAE30\uC220 \uC138\uBD80\uC0AC\uD56D",

  // Offline Banner
  offlineMessage: "\uC624\uD504\uB77C\uC778 \uC0C1\uD0DC\uC785\uB2C8\uB2E4. \uCE90\uC2DC\uB41C \uB370\uC774\uD130\uB97C \uD45C\uC2DC\uD569\uB2C8\uB2E4.",
  dismissOffline: "\uC624\uD504\uB77C\uC778 \uBC30\uB108 \uB2EB\uAE30",

  // Select realm/league prompt
  selectRealmLeague: "\uC2DC\uC791\uD558\uB824\uBA74 \uC11C\uBC84\uC640 \uB9AC\uADF8\uB97C \uC120\uD0DD\uD558\uC138\uC694",

  // Alerts button
  alerts: "\uC54C\uB9BC",
  alertsCount: "\uC54C\uB9BC ({0})",

  // Compare button
  compare: "\uBE44\uAD50 ({0})",
  pairCompare: "\uD398\uC5B4 \uBE44\uAD50 ({0})",

  // Compare tooltip
  removeFromComparison: "\uBE44\uAD50\uC5D0\uC11C \uC81C\uAC70",
  addToComparison: "\uBE44\uAD50\uC5D0 \uCD94\uAC00",
  removeFromFavorites: "\uAD00\uC2EC\uBAA9\uB85D\uC5D0\uC11C \uC81C\uAC70",
  addToFavorites: "\uAD00\uC2EC\uBAA9\uB85D\uC5D0 \uCD94\uAC00",

  // Category filter
  all: "\uBAA8\uB450",

  // Export
  exportCsv: "CSV",
  exportJson: "JSON",

  // Time ago
  secondsAgo: "{0}\uCD08 \uC804",
  minutesAgo: "{0}\uBD84 \uC804",

  // Language
  language: "\uC5B8\uC5B4",
  english: "English",
  russian: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439",
  chinese: "\u4E2D\u6587",
  korean: "\uD55C\uAD6D\uC5B4",

  // Accessibility (WCAG 2.1 AA)
  switchLanguage: "\uC5B8\uC5B4 \uBCC0\uACBD",
  switchToLightMode: "\uC77C\uBCF8 \uBAA8\uB4DC\uB85C \uC804\uD658",
  switchToDarkMode: "\uC5B4\uB450\uC6B4 \uBAA8\uB4DC\uB85C \uC804\uD658",
  refreshData: "\uB370\uC774\uD130 \uC0C8\uB85C\uACE0\uCE68",
  disableAutoRefresh: "\uC790\uB3D9 \uC0C8\uB85C\uACE0\uCE68 \uBE44\uD65C\uC131\uD654",
  enableAutoRefresh: "\uC790\uB3D9 \uC0C8\uB85C\uACE0\uCE68 \uD65C\uC131\uD654",

  // Timeframes
  timeframe24h: "24\uC2DC",
  timeframe7d: "7\uC77C",

  // Arbitrage \u2014 Flipper Mode
  arbitrageModeClient: "Simple Arbitrage",
  arbitrageModeFlipper: "Flipper (Backend)",
  flipperBackendOnline: "Backend online",
  flipperBackendOffline: "Backend offline",
  flipperBackendOfflineTitle: "Flipper backend is not running",
  flipperBackendOfflineDesc: "Start the FastAPI backend to enable advanced flip scoring, triangular arbitrage, and more.",
  flipperEventActive: "Active event affecting market",
  flipperAffectedCurrencies: "Affected currencies",
  flipperScoredFlips: "Scored Flips",
  flipperScoredFlipsDesc: "opportunities scored by the backend",
  flipperTriangularCycles: "Triangular Cycles",
  flipperTriangularCyclesDesc: "detected triangular arbitrage cycles",
  flipperPhase: "League",
  flipperPhaseDesc: "configured league for flipper",
  flipperMinScore: "Min Score",
  flipperMinVolume: "Min Volume",
  flipperFlipOpportunities: "Scored Flip Opportunities",
  flipperCurrency: "Currency",
  flipperScore: "Score",
  flipperSpread: "Spread",
  flipperGoldFee: "Gold Fee",
  flipperMomentum: "Momentum",
  flipperVolatility: "Volatility",
  flipperCluster: "Cluster",
  flipperVolume: "Volume",
  flipperTriangularTitle: "Triangular Arbitrage",
  flipperCycle: "Cycle",
  flipperNetProfitPct: "Net Profit %",
  flipperGoldFees: "Gold Fees",
  flipperTotalVolume: "Total Volume",
  flipperNoTriangular: "No triangular arbitrage cycles detected",

  // Forecast Tab
  forecastCurrency: "Currency",
  forecastTitle: "Price Forecast for {0}",
  forecastPhase: "Phase",
  forecastDaysSince: "Days since ref",
  forecastStrategy: "Strategy",
  forecastDisagreement: "Model Disagreement",
  forecastLowConfidence: "Low Confidence",
  forecastEventActive: "Event Active",
  forecastDataPoints: "data points",
  forecastNoData: "No forecast data available for this currency",
  forecastMape: "MAPE",
  forecastPoints: "Forecast points",
  forecastModelLowConfidence: "Low confidence",
  forecastModelDisagreement: "Disagreement",
  forecastStorageValue: "Storage Value: {0}",
  forecastDecision: "Decision",
  forecastCurrentPrice: "Current Price",
  forecastProjectedPrice: "Projected Price",
  forecastNetAfterFees: "Net After Fees",
  forecastRatio: "Ratio",
  forecastMomentumInput: "Momentum",
  forecastVolatilityInput: "Volatility",
  forecastGoldFee: "Gold Fee",
  forecastHorizon: "Horizon",
  forecastAnomalyTitle: "Anomaly Alerts",
  forecastAnomalyDesc: "{0} anomalies detected across {1} currencies",
  forecastNoAnomalies: "No anomalies detected \u2014 market looks stable",
  forecastAlertScore: "Score",
  forecastIndicators: "Indicators",
  forecastConfirmed: "Confirmed",

  // Flips Tab
  tabFlips: "\uD50C\uB9BD",
  flipsTotalOpportunities: "\uC804\uCCB4 \uAE30\uD68C",
  flipsAvgScore: "\uD3C9\uADE0 \uC810\uC218",
  flipsBestPair: "\uCD5C\uACE0 \uD398\uC5B4",
  flipsBestScore: "\uCD5C\uACE0 \uC810\uC218",
  flipsClusterFilter: "\uD074\uB7EC\uC2A4\uD130",
  flipsClusterStable: "\uC548\uC815",
  flipsClusterModerate: "\uC911\uAC04",
  flipsClusterVolatile: "\uBCC0\uB3D9",
  flipsSearchCurrency: "\uD1B5\uD654 \uAC80\uC0C9...",
  flipsDetailedOpportunities: "\uC0C1\uC138 \uD50C\uB9BD \uAE30\uD68C",
  flipsNoOpportunities: "\uD544\uD130 \uC870\uAC74\uC5D0 \uB9DE\uB294 \uD50C\uB9BD \uAE30\uD68C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4",
  flipsNoOpportunitiesDesc: "\uD544\uD130\uB97C \uC870\uC815\uD558\uAC70\uB098 \uC2DC\uC7A5 \uC870\uAC74\uC774 \uBCC0\uACBD\uB418\uBA74 \uB098\uC911\uC5D0 \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694.",
  flipsGoldFeePct: "\uC218\uC218\uB8CC %",
  flipsFeeFraction: "\uC218\uC218\uB8CC \uBE44\uC728",
  flipsBid: "\uB9E4\uC218",
  flipsAsk: "\uB3C4",
  flipsMid: "\uC911\uAC04",
  flipsDetailTitle: "\uD50C\uB9BD \uC0C1\uC138: {0}",

  // ---- Plural keys (Korean: all forms identical) ----
  _pl_alertsCount: "\uC54C\uB9BC ({0})|\uC54C\uB9BC ({0})|\uC54C\uB9BC ({0})",
  _pl_items: "\uAC1C|\uAC1C|\uAC1C",
  _pl_scannedPairs: "\uAC80\uC0C9\uB41C \uD398\uC5B4|\uAC80\uC0C9\uB41C \uD398\uC5B4|\uAC80\uC0C9\uB41C \uD398\uC5B4",
  _pl_opportunitiesFound: "\uBC1C\uACAC\uB41C \uAE30\uD68C|\uBC1C\uACAC\uB41C \uAE30\uD68C|\uBC1C\uAC9C\uB41C \uAE30\uD68C",
  _pl_compare: "\uBE44\uAD50 ({0})|\uBE44\uAD50 ({0})|\uBE44\uAD50 ({0})",
  _pl_pairCompare: "\uD398\uC5B4 \uBE44\uAD50 ({0})|\uD398\uC5B4 \uBE44\uAD50 ({0})|\uD398\uC5B4 \uBE44\uAD50 ({0})",
};

export default ko;
