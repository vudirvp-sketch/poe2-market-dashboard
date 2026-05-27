'use client';

import { useState, useEffect } from 'react';
import { WifiOff, X } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useI18n } from '@/lib/i18n';

export function OfflineBanner() {
  const { t } = useI18n();
  const { isOnline } = useOnlineStatus();
  const [dismissed, setDismissed] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
      setDismissed(false);
    }
  }, [isOnline]);

  // Show banner when offline and not dismissed
  // Once dismissed, don't show again until next offline event
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
