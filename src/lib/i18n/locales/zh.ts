import type { TranslationKeys } from "./en";

const zh: Record<TranslationKeys, string> = {
  // App
  appTitle: "PoE2 \u5E02\u573A",
  appDescription: "\u76D1\u63A7 Path of Exile 2 \u5E02\u573A\u4EF7\u683C\u3001\u4F20\u5947\u7269\u54C1\u548C\u8D27\u5E01\u5151\u6362\u6BD4\u7387\u3002",

  // Tabs
  tabOverview: "\u6982\u89C8",
  tabCurrencies: "\u8D27\u5E01",
  tabUniques: "\u4F20\u5947",
  tabExchange: "\u5151\u6362",
  tabArbitrage: "\u5957\u5229",
  tabForecast: "Forecasts",
  tabWatchlist: "\u5173\u6CE8",

  // Header
  searchPlaceholder: "\u641C\u7D22\u7269\u54C1...",
  autoRefresh: "\u81EA\u52A8",
  refresh: "\u5237\u65B0",
  baseCurrency: "\u57FA\u51C6\u8D27\u5E01",
  defaultCurrency: "\u9ED8\u8BA4",
  realm: "\u670D\u52A1\u5668",
  league: "\u8054\u8D5B",
  loading: "\u52A0\u8F7D\u4E2D...",
  inactive: "\u672A\u6FC0\u6D3B",

  // Overview
  totalVolume24h: "\u603B\u4EA4\u6613\u91CF (24\u5C0F\u65F6)",
  trackedItems: "\u8FFD\u8E2A\u7269\u54C1",
  exchangePairs: "\u5151\u6362\u5BF9",
  marketVolumeTrend: "\u5E02\u573A\u4EA4\u6613\u91CF\u8D8B\u52BF (7\u5929)",
  topMovers: "\u6DA8\u8DCC\u699C",
  topGainers: "\u6DA8\u5E45\u699C",
  topLosers: "\u8DCC\u5E45\u699C",
  noData: "\u6682\u65E0\u6570\u636E",

  // Currencies
  lowConfidence: "\u4F4E\u53EF\u4FE1\u5EA6",
  vol: "\u91CF",
  noCurrencies: "\u672A\u627E\u5230\u8D27\u5E01",

  // Uniques
  item: "\u7269\u54C1",
  price: "\u4EF7\u683C",
  change: "\u53D8\u52A8",
  sevenDay: "7\u5929",
  volume: "\u4EA4\u6613\u91CF",
  trend: "\u8D8B\u52BF",
  noUniques: "\u672A\u627E\u5230\u4F20\u5947\u7269\u54C1",

  // Exchange
  noExchangePairs: "\u672A\u627E\u5230\u5151\u6362\u5BF9",

  // Pagination
  perPage: "\u6BCF\u9875:",
  items: "\u9879",
  pageOf: "\u7B2C {0} \u9875\uFF0C\u5171 {1} \u9875",

  // Detail Dialog
  priceLabel: "\u4EF7\u683C",
  change24h: "24\u5C0F\u65F6\u53D8\u52A8",
  change7d: "7\u5929\u53D8\u52A8",
  hourly: "\u5C0F\u65F6",
  dailyCandlestick: "\u65E5K\u7EBF",
  priceHistory: "\u4EF7\u683C\u5386\u53F2",
  tradingVolume: "\u4EA4\u6613\u91CF",
  dailyCandlestickTitle: "\u65E5K\u7EBF\u56FE",
  dailyVolume: "\u65E5\u4EA4\u6613\u91CF",
  noHistory: "\u65E0\u5386\u53F2\u6570\u636E",
  noDailyStats: "\u65E0\u65E5\u7EDF\u8BA1\u6570\u636E",

  // Pair Detail Dialog
  current: "\u5F53\u524D",
  min: "\u6700\u4F4E",
  max: "\u6700\u9AD8",
  average: "\u5E73\u5747",
  spread: "\u4EF7\u5DEE",
  relativePriceOverTime: "\u76F8\u5BF9\u4EF7\u683C\u8D70\u52BF",
  noPairHistory: "\u65E0\u5BF9\u5386\u53F2\u6570\u636E",

  // Comparison Dialog
  itemComparison: "\u7269\u54C1\u5BF9\u6BD4",
  selectAtLeast2Items: "\u8BF7\u9009\u62E9\u81F3\u5C112\u4E2A\u7269\u54C1\u8FDB\u884C\u5BF9\u6BD4",
  clearAll: "\u6E05\u9664\u5168\u90E8",
  loadingComparison: "\u52A0\u8F7D\u5BF9\u6BD4\u6570\u636E...",
  priceChangeComparison: "\u4EF7\u683C\u53D8\u52A8\u5BF9\u6BD4 (%\u8D77\u59CB)",
  currentItem: "\u7269\u54C1",
  currentPrice: "\u5F53\u524D\u4EF7\u683C",
  startPrice: "\u8D77\u59CB\u4EF7\u683C",
  addItemsToCompare: "\u4ECE\u8D27\u5E01\u6216\u4F20\u5947\u6807\u7B7E\u9875\u6DFB\u52A0\u7269\u54C1\u8FDB\u884C\u5BF9\u6BD4",
  needAtLeast2Items: "\u9700\u8981\u81F3\u5C112\u4E2A\u6709\u5386\u53F2\u6570\u636E\u7684\u7269\u54C1",

  // Pair Comparison Dialog
  exchangePairComparison: "\u5151\u6362\u5BF9\u5BF9\u6BD4",
  selectAtLeast2Pairs: "\u8BF7\u9009\u62E9\u81F3\u5C112\u5BF9\u8FDB\u884C\u5BF9\u6BD4",
  pair: "\u4EA4\u6613\u5BF9",
  addPairsToCompare: "\u4ECE\u5151\u6362\u6807\u7B7E\u9875\u6DFB\u52A0\u4EA4\u6613\u5BF9\u8FDB\u884C\u5BF9\u6BD4",
  needAtLeast2Pairs: "\u9700\u8981\u81F3\u5C112\u5BF9\u6709\u5386\u53F2\u6570\u636E\u7684\u4EA4\u6613\u5BF9",

  // Price Alert Dialog
  priceAlerts: "\u4EF7\u683C\u63D0\u9192",
  priceAlertsDescription: "\u4E3A\u5173\u6CE8\u7269\u54C1\u8BBE\u7F6E\u4EF7\u683C\u9608\u503C\uFF0C\u8D85\u8FC7\u65F6\u83B7\u53D6\u6D4F\u89C8\u5668\u901A\u77E5\u3002",
  notificationsBlocked: "\u6D4F\u89C8\u5668\u901A\u77E5\u5DF2\u88AB\u7981\u6B62",
  notificationsBlockedDesc: "\u60A8\u9700\u8981\u6388\u4E88\u901A\u77E5\u6743\u9650\u624D\u80FD\u63A5\u6536\u4EF7\u683C\u63D0\u9192\u3002",
  enableNotifications: "\u542F\u7528\u901A\u77E5",
  notificationsNotSupported: "\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u901A\u77E5",
  notificationsNotSupportedDesc: "\u60A8\u7684\u6D4F\u89C8\u5668\u4E0D\u652F\u6301 Notification API\u3002",
  activeAlerts: "\u6D3B\u8DC3\u63D0\u9192",
  noAlerts: "\u672A\u8BBE\u7F6E\u4EF7\u683C\u63D0\u9192",
  noAlertsDesc: "\u5728\u4E0B\u65B9\u6DFB\u52A0\u63D0\u9192\uFF0C\u5F53\u4EF7\u683C\u8D85\u8FC7\u9608\u503C\u65F6\u83B7\u53D6\u901A\u77E5",
  above: "\u9AD8\u4E8E",
  below: "\u4F4E\u4E8E",
  now: "\u5F53\u524D",
  addAlert: "\u6DFB\u52A0\u63D0\u9192",
  needFavoritesFirst: "\u8BF7\u5148\u5173\u6CE8\u7269\u54C1\u518D\u8BBE\u7F6E\u63D0\u9192\u3002",
  selectFavoritedItem: "\u9009\u62E9\u5DF2\u5173\u6CE8\u7684\u7269\u54C1...",
  thresholdPrice: "\u9608\u503C\u4EF7\u683C",
  testNotification: "\u6D4B\u8BD5\u901A\u77E5",
  disableAlert: "\u7981\u7528\u63D0\u9192",
  enableAlert: "\u542F\u7528\u63D0\u9192",
  removeAlert: "\u5220\u9664\u63D0\u9192",

  // Arbitrage
  arbitrageTheoretical: "\u5957\u5229\u673A\u4F1A\u4E3A\u7406\u8BBA\u503C",
  arbitrageTheoreticalDesc: "\u5E02\u573A\u4EF7\u683C\u53D8\u52A8\u8FC5\u901F\u3002\u6ED1\u70B9\u4F7F\u7528\u5E73\u65B9\u6839\u5F71\u54CD\u6A21\u578B\u4F30\u7B97\u3002\u5B9E\u9645\u7ED3\u679C\u53EF\u80FD\u6709\u6240\u4E0D\u540C\u3002\u4EA4\u6613\u524D\u8BF7\u59CB\u7EC8\u786E\u8BA4\u5F53\u524D\u6C47\u7387\u3002",
  scannedPairs: "\u5DF2\u626B\u63CF\u4EA4\u6613\u5BF9",
  ofTotal: "\u5171 {0} \u4EA4\u6613\u5BF9 (\u4EA4\u6613\u91CF \u2265 {1})",
  currencies: "\u8D27\u5E01",
  uniqueTokensInGraph: "\u56FE\u4E2D\u72EC\u7279\u4EE3\u5E01",
  opportunitiesFound: "\u53D1\u73B0\u673A\u4F1A",
  cyclesWithPositiveNetProfit: "\u6B63\u51C0\u5229\u6DA6\u5FAA\u73AF",
  arbitrageOpportunities: "\u5957\u5229\u673A\u4F1A",
  settings: "\u8BBE\u7F6E",
  noArbitrage: "\u672A\u68C0\u6D4B\u5230\u5957\u5229\u673A\u4F1A",
  noArbitrageDesc: "\u8FD9\u662F\u6B63\u5E38\u7684 \u2014 \u9AD8\u6548\u5E02\u573A\u5F88\u5C11\u6709\u53EF\u5229\u7528\u7684\u5FAA\u73AF\u3002\u8BF7\u7A0D\u540E\u5237\u65B0\u6216\u68C0\u67E5\u5176\u4ED6\u8054\u8D5B\u3002\u4E5F\u53EF\u4EE5\u8C03\u6574\u6ED1\u70B9/\u8D39\u7528\u8BBE\u7F6E\u3002",
  route: "\u8DEF\u5F84",
  len: "\u6B65\u957F",
  netProfit: "\u51C0\u5229\u6DA6",
  gross: "\u6BDB\u5229",
  slippage: "\u6ED1\u70B9",
  maxVol: "\u6700\u5927\u91CF",
  net: "\u51C0",
  showingTopOpportunities: "\u663E\u793A\u524D {0} \u4E2A\u673A\u4F1A\uFF0C\u6309\u51C0\u5229\u6DA6\u6392\u5E8F\u3002\u5FAA\u73AF\u957F\u5EA6\u9650\u5236\u4E3A {1} \u6B65\u3002\u4EA4\u6613\u91CF < {2} \u7684\u4EA4\u6613\u5BF9\u5DF2\u6392\u9664\u3002\u6ED1\u70B9: \u5E73\u65B9\u6839\u6A21\u578B ({3} bps)\u3002\u8D39\u7528: {4} bps\u3002",
  adjustSettings: "\u8C03\u6574\u8FD9\u4E9B\u53C2\u6570\u4EE5\u6A21\u62DF\u771F\u5B9E\u4EA4\u6613\u6761\u4EF6\u3002\u6ED1\u70B9\u4F7F\u7528\u5E73\u65B9\u6839\u5F71\u54CD\u6A21\u578B\uFF0C\u57FA\u4E8E\u4EA4\u6613\u89C4\u6A21\u4E0E\u4EA4\u6613\u5BF9\u4EA4\u6613\u91CF\u7684\u6BD4\u503C\u3002",
  tradingFeeBps: "\u4EA4\u6613\u8D39\u7528 (bps)",
  poeNoFees: "PoE \u6CA1\u6709\u660E\u786E\u8D39\u7528 (0)\u3002\u9ED8\u8BA4\u8BBE\u7F6E\u4E3A 0\u3002",
  baseSlippageBps: "\u57FA\u7840\u6ED1\u70B9 (bps)",
  baseSlippageDesc: "\u6BCF\u7B14\u4EA4\u6613\u7684\u57FA\u7840\u6ED1\u70B9\u300210 = 0.1%\u3002",
  tradeSizeForProfit: "\u4EA4\u6613\u89C4\u6A21 (\u5229\u6DA6\u4F30\u7B97)",
  tradeSizeDesc: "\u7528\u4E8E\u4F30\u7B97\u51C0\u5229\u6DA6\u7684\u8D27\u5E01\u6570\u91CF\u3002",

  // Arbitrage — Confidence indicator (Task 6.9)
  confidence: "\u7F6E\u4FE1\u5EA6",
  confidenceHigh: "\u9AD8",
  confidenceMedium: "\u4E2D",
  confidenceLow: "\u4F4E",
  confidenceDesc: "\u57FA\u4E8E\u4EA4\u6613\u91CF\u7684\u7F6E\u4FE1\u5EA6\uFF1A\u4EA4\u6613\u5BF9\u7684\u4EA4\u6613\u91CF\u80FD\u5426\u652F\u6301\u4EA4\u6613\u89C4\u6A21\u3002\u9AD8 = \u4EA4\u6613\u91CF\u8FDC\u8D85\u4EA4\u6613\u89C4\u6A21\uFF1B\u4F4E = \u6ED1\u70B9\u975E\u5E38\u4E0D\u786E\u5B9A\u3002",
  timeDecayLabel: "\u65F6\u95F4\u8870\u51CF",
  timeDecayDesc: "\u57FA\u4E8E\u6570\u636E\u65B0\u9C9C\u5EA6\u5BF9\u6C47\u7387\u5E94\u7528\u6307\u6570\u8870\u51CF\u6743\u91CD\u3002Lambda \u63A7\u5236\u8870\u51CF\u901F\u7387\uFF08\u8D8A\u9AD8\u8D8A\u5FEB\uFF09\u30020 = \u65E0\u8870\u51CF\u3002",
  decayLambda: "\u8870\u51CF Lambda (\u03BB)",

  // Watchlist
  noFavorites: "\u6682\u65E0\u5173\u6CE8",
  noFavoritesDesc: "\u70B9\u51FB\u4EFB\u610F\u7269\u54C1\u7684\u661F\u6807\u56FE\u6807\u6DFB\u52A0\u5230\u5173\u6CE8",
  favoritedNotFound: "\u5173\u6CE8\u7269\u54C1\u5728\u5F53\u524D\u8054\u8D5B\u4E2D\u672A\u627E\u5230",
  favoritedNotFoundDesc: "\u8BF7\u5C1D\u8BD5\u5207\u6362\u8054\u8D5B\u6216\u6DFB\u52A0\u65B0\u5173\u6CE8",

  // Error Boundary
  encounteredError: "{0} \u53D1\u751F\u9519\u8BEF",
  errorBoundaryDesc: "\u6E32\u67D3\u6B64\u90E8\u5206\u65F6\u51FA\u9519\u3002\u4EEA\u8868\u677F\u5176\u4ED6\u90E8\u5206\u4ECD\u6B63\u5E38\u5DE5\u4F5C\u3002\u60A8\u53EF\u4EE5\u5C1D\u8BD5\u91CD\u65B0\u52A0\u8F7D\u6B64\u90E8\u5206\u3002",
  errorDetails: "\u9519\u8BEF\u8BE6\u60C5",
  retry: "\u91CD\u8BD5",

  // API Error Fallback
  networkError: "\u7F51\u7EDC\u9519\u8BEF \u2014 \u8BF7\u68C0\u67E5\u7F51\u7EDC\u8FDE\u63A5",
  rateLimited: "\u8BF7\u6C42\u53D7\u9650 \u2014 \u8BF7\u7A0D\u5019",
  failedToLoadData: "\u6570\u636E\u52A0\u8F7D\u5931\u8D25",
  connectionLost: "\u8FDE\u63A5\u4E22\u5931",
  tooManyRequests: "\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41",
  connectionLostDesc: "\u65E0\u6CD5\u8FDE\u63A5\u670D\u52A1\u5668\u3002\u8BF7\u68C0\u67E5\u7F51\u7EDC\u8FDE\u63A5\u5E76\u91CD\u8BD5\u3002",
  tooManyRequestsDesc: "API \u6536\u5230\u8FC7\u591A\u8BF7\u6C42\u3002\u8BF7\u7A0D\u5019\u518D\u8BD5\u3002",
  failedToLoadDataDesc: "\u4ECE\u670D\u52A1\u5668\u52A0\u8F7D\u6570\u636E\u65F6\u51FA\u9519\u3002\u8FD9\u53EF\u80FD\u662F\u4E34\u65F6\u95EE\u9898\u3002",
  tryAgain: "\u518D\u8BD5\u4E00\u6B21",
  retrying: "\u91CD\u8BD5\u4E2D...",
  technicalDetails: "\u6280\u672F\u7EC6\u8282",

  // Offline Banner
  offlineMessage: "\u60A8\u5DF2\u79BB\u7EBF\u3002\u663E\u793A\u7F13\u5B58\u6570\u636E\u3002",
  dismissOffline: "\u5173\u95ED\u79BB\u7EBF\u6A2A\u5E45",

  // Select realm/league prompt
  selectRealmLeague: "\u8BF7\u9009\u62E9\u670D\u52A1\u5668\u548C\u8054\u8D5B\u5F00\u59CB",

  // Alerts button
  alerts: "\u63D0\u9192",
  alertsCount: "\u63D0\u9192 ({0})",

  // Compare button
  compare: "\u5BF9\u6BD4 ({0})",
  pairCompare: "\u4EA4\u6613\u5BF9\u5BF9\u6BD4 ({0})",

  // Compare tooltip
  removeFromComparison: "\u4ECE\u5BF9\u6BD4\u4E2D\u79FB\u9664",
  addToComparison: "\u6DFB\u52A0\u5230\u5BF9\u6BD4",
  removeFromFavorites: "\u53D6\u6D88\u5173\u6CE8",
  addToFavorites: "\u6DFB\u52A0\u5173\u6CE8",

  // Category filter
  all: "\u5168\u90E8",

  // Export
  exportCsv: "CSV",
  exportJson: "JSON",

  // Time ago
  secondsAgo: "{0}\u79D2\u524D",
  minutesAgo: "{0}\u5206\u949F\u524D",

  // Language
  language: "\u8BED\u8A00",
  english: "English",
  russian: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439",
  chinese: "\u4E2D\u6587",
  korean: "\uD55C\uAD6D\uC5B4",

  // Accessibility (WCAG 2.1 AA)
  switchLanguage: "\u5207\u6362\u8BED\u8A00",
  switchToLightMode: "\u5207\u6362\u5230\u6D45\u8272\u6A21\u5F0F",
  switchToDarkMode: "\u5207\u6362\u5230\u6DF1\u8272\u6A21\u5F0F",
  refreshData: "\u5237\u65B0\u6570\u636E",
  disableAutoRefresh: "\u7981\u7528\u81EA\u52A8\u5237\u65B0",
  enableAutoRefresh: "\u542F\u7528\u81EA\u52A8\u5237\u65B0",

  // Timeframes
  timeframe24h: "24\u5C0F\u65F6",
  timeframe7d: "7\u5929",

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

  // ---- Plural keys (Chinese: all forms identical) ----
  _pl_alertsCount: "\u63D0\u9192 ({0})|\u63D0\u9192 ({0})|\u63D0\u9192 ({0})",
  _pl_items: "\u9879|\u9879|\u9879",
  _pl_scannedPairs: "\u5DF2\u626B\u63CF\u4EA4\u6613\u5BF9|\u5DF2\u626B\u63CF\u4EA4\u6613\u5BF9|\u5DF2\u626B\u63CF\u4EA4\u6613\u5BF9",
  _pl_opportunitiesFound: "\u53D1\u73B0\u673A\u4F1A|\u53D1\u73B0\u673A\u4F1A|\u53D1\u73B0\u673A\u4F1A",
  _pl_compare: "\u5BF9\u6BD4 ({0})|\u5BF9\u6BD4 ({0})|\u5BF9\u6BD4 ({0})",
  _pl_pairCompare: "\u4EA4\u6613\u5BF9\u5BF9\u6BD4 ({0})|\u4EA4\u6613\u5BF9\u5BF9\u6BD4 ({0})|\u4EA4\u6613\u5BF9\u5BF9\u6BD4 ({0})",
};

export default zh;
