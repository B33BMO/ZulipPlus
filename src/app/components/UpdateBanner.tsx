import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from './ui/button';
import {
  checkForUpdate,
  dismissVersion,
  isDismissed,
  CURRENT_VERSION,
  type UpdateInfo,
} from '../api/updater';

// Slim banner that appears above the main UI when a newer GitHub Release
// exists. "Download" opens the release page in the OS browser (the user
// runs the installer manually); "X" dismisses for this version only —
// the next release will re-trigger the banner.
export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    // Stagger the check a tick so it doesn't compete with the login burst.
    const t = window.setTimeout(() => {
      checkForUpdate(ctrl.signal).then((info) => {
        if (!info) return;
        if (isDismissed(info.version)) return;
        setUpdate(info);
      });
    }, 3000);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, []);

  if (!update) return null;

  const open = () => {
    const api = (window as { electronAPI?: { openExternal?: (url: string) => void } }).electronAPI;
    if (api?.openExternal) api.openExternal(update.htmlUrl);
    else window.open(update.htmlUrl, '_blank', 'noopener,noreferrer');
  };

  const dismiss = () => {
    dismissVersion(update.version);
    setUpdate(null);
  };

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 bg-brand/15 border-b border-brand/30 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Download className="size-4 text-brand shrink-0" />
        <span className="text-text-primary truncate">
          ZulipPlus {update.version} is available
          <span className="text-text-muted ml-2">(you're on {CURRENT_VERSION})</span>
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" onClick={open}>Download</Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
