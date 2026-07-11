'use client';

import { useState } from 'react';
import { WifiOff, X } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useI18n } from '@/lib/i18n';

export function OfflineBanner() {
  const { t } = useI18n();
  const { isOnline } = useOnlineStatus();
  const [dismissed, setDismissed] = useState(false);

  // KI-24 (iter 118): Reset `dismissed` when transitioning online → offline.
  // Was:
  //   const [wasOffline, setWasOffline] = useState(false);
  //   useEffect(() => {
  //     if (!isOnline) { setWasOffline(true); setDismissed(false); }
  //   }, [isOnline]);
  //
  // Two issues with the previous implementation:
  //   1. `wasOffline` was DEAD state — set but never read. Removed as cleanup.
  //   2. The `setDismissed(false)` call inside `useEffect` fired the
  //      `react-hooks/set-state-in-effect` warning (KI-24).
  //
  // Recipe: "Adjust state during render with a previous-value guard" — the
  // canonical React pattern for resetting state on a prop change.
  // Ref: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  //
  // Why not iter 115's signal-ref pattern? The signal-ref pattern defers the
  // setState into a `useCallback` that is called synchronously from the SAME
  // effect that sets the ref. That works when there is a callback consumer
  // (e.g. `connect()` in use-price-stream.ts). Here, `dismissed` is consumed
  // ONLY in the render path — there is no callback to defer into. React
  // explicitly supports calling setState during render as a special case: it
  // re-renders immediately without committing the partial state, so there is
  // no visual flash. The `react-hooks/set-state-in-effect` rule does NOT fire
  // because the setState is NOT inside a `useEffect`.
  //
  // Semantics preserved (verified by trace):
  //   - Online → Offline: `isOnline !== prevIsOnline` and `!isOnline` →
  //     `setDismissed(false)` → banner appears.
  //   - User clicks dismiss while offline: `setDismissed(true)` → banner hides.
  //   - Offline → Online: `isOnline !== prevIsOnline` but `!isOnline` is false
  //     → `dismissed` left as-is → banner hidden (because `!isOnline` is false).
  //   - Online → Offline (again): `isOnline !== prevIsOnline` and `!isOnline`
  //     → `setDismissed(false)` → banner reappears.
  const [prevIsOnline, setPrevIsOnline] = useState(isOnline);
  if (isOnline !== prevIsOnline) {
    setPrevIsOnline(isOnline);
    if (!isOnline) {
      setDismissed(false);
    }
  }

  // Show banner when offline and not dismissed.
  // Once dismissed, don't show again until next offline event.
  const showBanner = !isOnline && !dismissed;

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-3 bg-amber-500/95 px-4 py-3 text-amber-950 shadow-lg transition-transform duration-300 ease-in-out ${
        showBanner ? 'translate-y-0' : 'translate-y-full'
      }`}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center gap-2">
        <WifiOff className="h-5 w-5 shrink-0" />
        <span className="text-sm font-medium">
          {t("offlineMessage")}
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-md p-1 hover:bg-amber-600/30 transition-colors"
        aria-label={t("dismissOffline")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
