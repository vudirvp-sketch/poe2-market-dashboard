import type { TranslationKeys } from "./en";

const ko: Record<TranslationKeys, string> = {
  // App
  appTitle: "PoE2 시장",
  appDescription: "Path of Exile 2 시장 가격, 유니크 아이템 및 통화 환율을 모니터링합니다.",

  // Tabs
  tabOverview: "개요",
  tabCurrencies: "통화",
  tabUniques: "유니크",
  tabExchange: "교환",
  tabArbitrage: "채권트라지",
  tabForecast: "Forecasts",
  tabWatchlist: "관심목록",

  // Header
  searchPlaceholder: "아이템 검색...",
  autoRefresh: "자동",
  refresh: "새로고침",
  baseCurrency: "기준 통화",
  defaultCurrency: "기본값",
  realm: "서버",
  league: "리그",
  loading: "로딩...",
  inactive: "비활성",

  // Overview
  totalVolume24h: "총 거래량 (24시)",
  trackedItems: "추적 아이템",
  exchangePairs: "교환 페어",
  marketVolumeTrend: "시장 거래량 동향 (7일)",
  topMovers: "도움 종목",
  topGainers: "상승 종목",
  topLosers: "하락 종목",
  noData: "데이터 없음",

  // Currencies
  lowConfidence: "신뢰도 낮음",
  vol: "량",
  noCurrencies: "통화를 찾을 수 없음",

  // Uniques
  item: "아이템",
  price: "가격",
  change: "변동",
  sevenDay: "7일",
  volume: "거래량",
  trend: "동향",
  noUniques: "유니크 아이템을 찾을 수 없음",

  // Exchange
  noExchangePairs: "교환 페어를 찾을 수 없음",

  // Pagination
  perPage: "페이지당:",
  items: "개",
  pageOf: "페이지 {0} / {1}",

  // Detail Dialog
  priceLabel: "가격",
  change24h: "24시 변동",
  change7d: "7일 변동",
  hourly: "시간별",
  dailyCandlestick: "일별 캔들스틱",
  priceHistory: "가격 히스토리",
  tradingVolume: "거래량",
  dailyCandlestickTitle: "일별 캔들스틱",
  dailyVolume: "일별 거래량",
  noHistory: "히스토리 데이터 없음",
  noDailyStats: "일별 통계 데이터 없음",

  // Pair Detail Dialog
  current: "현재",
  min: "최저",
  max: "최고",
  average: "평균",
  spread: "스프레드",
  relativePriceOverTime: "시간별 상대 가격",
  noPairHistory: "페어 히스토리 없음",

  // Comparison Dialog
  itemComparison: "아이템 비교",
  selectAtLeast2Items: "비교할 2개 이상의 아이템을 선택하세요",
  clearAll: "모두 지우기",
  loadingComparison: "비교 데이터 로딩중...",
  priceChangeComparison: "가격 변동 비교 (% 시작가격기준)",
  currentItem: "아이템",
  currentPrice: "현재 가격",
  startPrice: "시작 가격",
  addItemsToCompare: "통화 또는 유니크 탭에서 비교할 아이템 추가",
  needAtLeast2Items: "히스토리 데이터가 있는 2개 이상의 아이템이 필요합니다",

  // Pair Comparison Dialog
  exchangePairComparison: "교환 페어 비교",
  selectAtLeast2Pairs: "비교할 2개 이상의 페어를 선택하세요",
  pair: "페어",
  addPairsToCompare: "교환 탭에서 비교할 페어 추가",
  needAtLeast2Pairs: "히스토리 데이터가 있는 2개 이상의 페어가 필요합니다",

  // Price Alert Dialog
  priceAlerts: "가격 알림",
  priceAlertsDescription: "관심 아이템에 가격 임계값을 설정하고 초과 시 브라우저 알림을 받으세요.",
  notificationsBlocked: "브라우저 알림이 차단되었습니다",
  notificationsBlockedDesc: "가격 알림을 받으려면 알림 권한을 허가해야 합니다.",
  enableNotifications: "알림 활성화",
  notificationsNotSupported: "브라우저가 알림을 지원하지 않습니다",
  notificationsNotSupportedDesc: "브라우저가 Notification API를 지원하지 않습니다.",
  activeAlerts: "활성 알림",
  noAlerts: "가격 알림이 없습니다",
  noAlertsDesc: "아래에서 알림을 추가하면 가격이 임계값을 초과할 때 알림을 받습니다",
  above: "이상",
  below: "이하",
  now: "현재",
  addAlert: "알림 추가",
  needFavoritesFirst: "알림을 설정하려면 먼저 아이템을 관심목록에 추가하세요.",
  selectFavoritedItem: "관심 아이템 선택...",
  thresholdPrice: "임계 가격",
  testNotification: "테스트 알림",
  disableAlert: "알림 비활성화",
  enableAlert: "알림 활성화",
  removeAlert: "알림 삭제",

  // Arbitrage
  arbitrageTheoretical: "채권트라지 기회는 이론적입니다",
  arbitrageTheoreticalDesc: "시장 가격은 빨리 변동됩니다. 미끄러짐은 제곱근 영향 모델로 추정됩니다. 실제 결과는 다를 수 있습니다. 거래 전 항상 현재 환율을 확인하세요.",
  scannedPairs: "검색된 페어",
  ofTotal: "총 {0} 개 (거래량 ≥ {1})",
  currencies: "통화",
  uniqueTokensInGraph: "그래프 내 고유 통화",
  opportunitiesFound: "발견된 기회",
  cyclesWithPositiveNetProfit: "양의 순이익 사이클",
  arbitrageOpportunities: "채권트라지 기회",
  settings: "설정",
  noArbitrage: "채권트라지 기회가 감지되지 않음",
  noArbitrageDesc: "정상입니다 — 효율적인 시장은 이용 가능한 사이클이 드뭅니다. 나중에 새로고침하거나 다른 리그를 확인하세요. 미끄러짐/수수료 설정을 조정할 수도 있습니다.",
  route: "경로",
  len: "길이",
  netProfit: "순이익",
  gross: "총이익",
  slippage: "미끄러짐",
  maxVol: "최대 량",
  net: "순",
  showingTopOpportunities: "순이익순 상위 {0}개 기회. 사이클 길이 제한 {1}. 거래량 < {2} 페어 제외. 미끄러짐: 제곱근 모델 ({3} bps). 수수료: {4} bps.",
  adjustSettings: "실제 거래 조건을 모델링하도록 매개변수를 조정하세요. 미끄러짐은 거래 크기와 페어 거래량의 비율에 기반한 제곱근 영향 모델을 사용합니다.",
  tradingFeeBps: "거래 수수료 (bps)",
  poeNoFees: "PoE에는 명시적인 수수료가 없습니다 (0). 기본값 0으로 설정.",
  baseSlippageBps: "기본 미끄러짐 (bps)",
  baseSlippageDesc: "거래당 기본 미끄러짐. 10 = 0.1%.",
  tradeSizeForProfit: "거래 크기 (이익 추정용)",
  tradeSizeDesc: "순이익을 추정할 통화 수량.",

  // Arbitrage — Confidence indicator (Task 6.9)
  confidence: "신뢰도",
  confidenceHigh: "높음",
  confidenceMedium: "중간",
  confidenceLow: "낮음",
  confidenceDesc: "거래량 기반 신뢰도: 페어의 거래량이 거래 크기를 얼마나 지원하는지. 높음 = 거래량이 거래 크기를 크게 초과; 낮음 = 미끄러짐이 매우 불확실함.",
  timeDecayLabel: "시간 감쇠",
  timeDecayDesc: "데이터 신선도에 기반하여 환율에 지수 감쇠 가중치를 적용합니다. Lambda는 감쇠 속도를 제어합니다 (높음 = 빠라짐). 0 = 감쇠 없음.",
  decayLambda: "감쇠 Lambda (λ)",

  // Watchlist
  noFavorites: "관심목록이 비어 있습니다",
  noFavoritesDesc: "아이템의 별 아이콘을 클릭하여 관심목록에 추가하세요",
  favoritedNotFound: "관심 아이템을 현재 리그에서 찾을 수 없음",
  favoritedNotFoundDesc: "리그를 변경하거나 새 관심목록을 추가하세요",

  // Error Boundary
  encounteredError: "{0}에 오류가 발생했습니다",
  errorBoundaryDesc: "이 섹션을 렌더링하는 중 오류가 발생했습니다. 대시보드 나머지는 계속 정상적으로 작동합니다. 이 섹션을 다시 로딩해 보세요.",
  errorDetails: "오류 세부사항",
  retry: "재시도",

  // API Error Fallback
  networkError: "네트워크 오류 — 연결을 확인하세요",
  rateLimited: "요청 제한 — 잠시 기다려주세요",
  failedToLoadData: "데이터 로딩 실패",
  connectionLost: "연결 상실",
  tooManyRequests: "요청 초과",
  connectionLostDesc: "서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 다시 시도하세요.",
  tooManyRequestsDesc: "API에 너무 많은 요청이 들어오고 있습니다. 잠시 후 다시 시도하세요.",
  failedToLoadDataDesc: "서버에서 데이터를 로딩하는 중 오류가 발생했습니다. 일시적인 문제일 수 있습니다.",
  tryAgain: "다시 시도",
  retrying: "재시도 중...",
  technicalDetails: "기술 세부사항",

  // Offline Banner
  offlineMessage: "오프라인 상태입니다. 캐시된 데이터를 표시합니다.",
  dismissOffline: "오프라인 배너 닫기",

  // Select realm/league prompt
  selectRealmLeague: "시작하려면 서버와 리그를 선택하세요",

  // Alerts button
  alerts: "알림",
  alertsCount: "알림 ({0})",

  // Compare button
  compare: "비교 ({0})",
  pairCompare: "페어 비교 ({0})",

  // Compare tooltip
  removeFromComparison: "비교에서 제거",
  addToComparison: "비교에 추가",
  removeFromFavorites: "관심목록에서 제거",
  addToFavorites: "관심목록에 추가",

  // Category filter
  all: "모두",

  // Export
  exportCsv: "CSV",
  exportJson: "JSON",

  // Time ago
  secondsAgo: "{0}초 전",
  minutesAgo: "{0}분 전",

  // Language
  language: "언어",
  english: "English",
  russian: "Русский",
  chinese: "中文",
  korean: "한국어",

  // Accessibility (WCAG 2.1 AA)
  switchLanguage: "언어 변경",
  switchToLightMode: "일반 모드로 전환",
  switchToDarkMode: "어두운 모드로 전환",
  refreshData: "데이터 새로고침",
  disableAutoRefresh: "자동 새로고침 비활성화",
  enableAutoRefresh: "자동 새로고침 활성화",

  // Timeframes
  timeframe24h: "24시",
  timeframe7d: "7일",

  // Arbitrage — Flipper Mode
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
  forecastNoAnomalies: "No anomalies detected — market looks stable",
  forecastAlertScore: "Score",
  forecastIndicators: "Indicators",
  forecastConfirmed: "Confirmed",

  // Flips Tab
  tabFlips: "플립",
  flipsTotalOpportunities: "전체 기회",
  flipsAvgScore: "평균 점수",
  flipsBestPair: "최고 페어",
  flipsBestScore: "최고 점수",
  flipsClusterFilter: "클러스터",
  flipsClusterStable: "안정",
  flipsClusterModerate: "중간",
  flipsClusterVolatile: "변동",
  flipsSearchCurrency: "통화 검색...",
  flipsDetailedOpportunities: "상세 플립 기회",
  flipsNoOpportunities: "필터 조건에 맞는 플립 기회가 없습니다",
  flipsNoOpportunitiesDesc: "필터를 조정하거나 시장 조건이 변경되면 나중에 다시 확인하세요.",
  flipsGoldFeePct: "수수료 %",
  flipsFeeFraction: "수수료 비율",
  flipsBid: "매수",
  flipsAsk: "도",
  flipsMid: "중간",
  flipsDetailTitle: "플립 상세: {0}",

  // ---- Events Sidebar ----
  eventsTitle: "이벤트",
  eventsDescription: "통화 점수 및 거래 권장 사항에 영향을 미치는 시장 이벤트를 표시하세요. 활성 이벤트는 플립 점수에 페널티를 적용합니다.",
  eventsButtonLabel: "이벤트",
  eventsActiveTitle: "활성 이벤트",
  eventsNoActive: "활성 이벤트 없음",
  eventsImpactSummary: "{0}개 활성 이벤트가 시장에 영향",
  eventsAffectedCurrencies: "영향받은 통화",
  eventsScoringPenalty: "영향받은 통화에 점수 페널티가 적용됩니다.",
  eventsAffects: "영향",
  eventsDeactivate: "비활성화",
  eventsDelete: "삭제",
  eventsCreateTitle: "새 이벤트 만들기",
  eventsEventType: "이벤트 유형",
  eventsTypeMajorPatch: "메이저 패치",
  eventsTypeMinorPatch: "마이너 패치",
  eventsTypeLeagueStart: "리그 시작",
  eventsTypeEconomyShift: "경제 변동",
  eventsTypeStreamerHype: "스트리머 화제",
  eventsTypeOther: "기타",
  eventsDescriptionLabel: "설명",
  eventsDescriptionPlaceholder: "예: 패치 0.3.0 새 통화 추가",
  eventsDescriptionRequired: "설명은 필수입니다",
  eventsAffectedLabel: "영향받는 통화 (쉼표로 구분된 API ID)",
  eventsAffectedPlaceholder: "예: divine, exalted, chaos",
  eventsAffectedHint: "비워두면 모든 통화에 페널티가 적용됩니다.",
  eventsExpiryLabel: "만료 (시간)",
  eventsExpiryHint: "이벤트 자동 만료까지의 시간 (1–168시간).",
  eventsCreateButton: "이벤트 만들기",
  eventsCreating: "만드는 중...",

  // ---- Plural keys (Korean: all forms identical) ----
  _pl_alertsCount: "알림 ({0})|알림 ({0})|알림 ({0})",
  _pl_items: "개|개|개",
  _pl_scannedPairs: "검색된 페어|검색된 페어|검색된 페어",
  _pl_opportunitiesFound: "발견된 기회|발견된 기회|발견된 기회",
  _pl_compare: "비교 ({0})|비교 ({0})|비교 ({0})",
  _pl_pairCompare: "페어 비교 ({0})|페어 비교 ({0})|페어 비교 ({0})",
};

export default ko;
