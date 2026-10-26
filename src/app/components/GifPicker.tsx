import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { Input } from './ui/input';
import { useZulip } from '../context/ZulipContext';
import { platform } from '../platform';

interface GifPickerProps {
  onSelect: (url: string, altText: string) => void;
}

interface GiphyGif {
  id: string;
  title: string;
  images: {
    fixed_height: { url: string; width: string; height: string };
    fixed_height_small: { url: string; width: string; height: string };
    original: { url: string };
    downsized: { url: string };
  };
}

// The old hard-coded GIPHY public beta key was revoked long ago, so every
// request 403'd and the picker sat on "Loading..." forever. Prefer a key from
// the build env, else the one the Zulip server hands its own web client.
async function giphyFetch(path: string, apiKey: string): Promise<GiphyGif[]> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await platform.fetch(
    `https://api.giphy.com/v1/gifs/${path}${sep}api_key=${encodeURIComponent(apiKey)}&limit=20&rating=g`
  );
  if (!res.ok) throw new Error(`GIPHY ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export function GifPicker({ onSelect }: GifPickerProps) {
  const { giphyApiKey } = useZulip();
  const apiKey = import.meta.env.VITE_GIPHY_API_KEY || giphyApiKey;
  const [search, setSearch] = useState('');
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [trending, setTrending] = useState<GiphyGif[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Load trending on mount
  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    setLoading(true);
    giphyFetch('trending', apiKey)
      .then((list) => { if (!cancelled) setTrending(list); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiKey]);

  useEffect(() => () => clearTimeout(searchTimeout.current), []);

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (!q.trim() || !apiKey) {
      setGifs([]);
      return;
    }

    searchTimeout.current = setTimeout(async () => {
      setLoading(true);
      try {
        setGifs(await giphyFetch(`search?q=${encodeURIComponent(q)}`, apiKey));
        setFailed(false);
      } catch {
        setGifs([]);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }, 400);
  }, [apiKey]);

  const displayGifs = search.trim() ? gifs : trending;

  return (
    <div className="w-96 h-96 bg-surface-secondary border border-surface-tertiary rounded-lg shadow-xl flex flex-col overflow-hidden">
      {/* Search */}
      <div className="p-2 border-b border-surface-tertiary">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-text-muted" />
          <Input
            type="text"
            placeholder="Search GIFs..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-8 pr-8 h-8 bg-surface-tertiary border-surface-tertiary text-text-primary text-sm placeholder:text-text-muted"
          />
          {search && (
            <button
              onClick={() => {
                setSearch('');
                setGifs([]);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Category label */}
      <div className="px-3 py-1.5">
        <p className="text-xs text-text-muted uppercase font-semibold">
          {search.trim() ? 'Results' : 'Trending'}
        </p>
      </div>

      {/* GIF grid */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {!apiKey ? (
          <div className="flex items-center justify-center h-full px-6 text-center">
            <p className="text-text-muted text-sm">
              GIF search isn&rsquo;t set up on this Zulip server.
            </p>
          </div>
        ) : loading && displayGifs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-6 text-text-secondary animate-spin" />
          </div>
        ) : displayGifs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted text-sm">
              {failed ? 'Couldn’t reach GIPHY' : search.trim() ? 'No GIFs found' : 'Nothing trending right now'}
            </p>
          </div>
        ) : (
          <div className="columns-2 gap-1.5">
            {displayGifs.map((gif) => (
              <button
                key={gif.id}
                onClick={() =>
                  onSelect(
                    gif.images.downsized?.url || gif.images.original.url,
                    gif.title || 'GIF'
                  )
                }
                className="mb-1.5 w-full rounded overflow-hidden hover:ring-2 hover:ring-brand cursor-pointer break-inside-avoid"
              >
                <img
                  src={gif.images.fixed_height_small.url}
                  alt={gif.title}
                  className="w-full h-auto"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* GIPHY attribution */}
      <div className="px-3 py-1.5 border-t border-surface-tertiary flex-shrink-0">
        <p className="text-[10px] text-text-muted text-center">Powered by GIPHY</p>
      </div>
    </div>
  );
}
