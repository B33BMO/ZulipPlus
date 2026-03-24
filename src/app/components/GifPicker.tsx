import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { Input } from './ui/input';

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

// GIPHY public beta key
const GIPHY_API_KEY = 'dc6zaTOxFJmzC';

export function GifPicker({ onSelect }: GifPickerProps) {
  const [search, setSearch] = useState('');
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [loading, setLoading] = useState(false);
  const [trending, setTrending] = useState<GiphyGif[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Load trending on mount
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(
          `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=20&rating=g`
        );
        const data = await res.json();
        setTrending(data.data || []);
      } catch {
        // Trending not available
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (!q.trim()) {
      setGifs([]);
      return;
    }

    searchTimeout.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=20&rating=g`
        );
        const data = await res.json();
        setGifs(data.data || []);
      } catch {
        setGifs([]);
      } finally {
        setLoading(false);
      }
    }, 400);
  }, []);

  const displayGifs = search.trim() ? gifs : trending;

  return (
    <div className="w-96 h-96 bg-surface-secondary border border-surface-tertiary rounded-lg shadow-xl flex flex-col overflow-hidden">
      {/* Search */}
      <div className="p-2 border-b border-surface-tertiary">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-gray-500" />
          <Input
            type="text"
            placeholder="Search GIFs..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-8 pr-8 h-8 bg-surface-tertiary border-surface-tertiary text-gray-200 text-sm placeholder:text-gray-500"
          />
          {search && (
            <button
              onClick={() => {
                setSearch('');
                setGifs([]);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Category label */}
      <div className="px-3 py-1.5">
        <p className="text-xs text-gray-500 uppercase font-semibold">
          {search.trim() ? 'Results' : 'Trending'}
        </p>
      </div>

      {/* GIF grid */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {loading && displayGifs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-6 text-gray-400 animate-spin" />
          </div>
        ) : displayGifs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 text-sm">
              {search.trim() ? 'No GIFs found' : 'Loading...'}
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
        <p className="text-[10px] text-gray-600 text-center">Powered by GIPHY</p>
      </div>
    </div>
  );
}
