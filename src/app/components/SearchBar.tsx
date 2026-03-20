import { useState, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { useZulip } from '../context/ZulipContext';
import type { ZulipMessage } from '../api/types';
import { format } from 'date-fns';

export function SearchBar() {
  const { searchMessages, resolveUrl } = useZulip();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ZulipMessage[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const handleSearch = useCallback(
    async (q: string) => {
      setQuery(q);
      if (!q.trim()) {
        setResults([]);
        setShowResults(false);
        return;
      }

      setSearching(true);
      setShowResults(true);
      try {
        const msgs = await searchMessages(q);
        setResults(msgs);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [searchMessages]
  );

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setShowResults(false);
  };

  // Debounce: search on Enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch(query);
    }
    if (e.key === 'Escape') {
      handleClear();
    }
  };

  return (
    <div className="px-4 py-3 border-b border-[#1e1f22] relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-500" />
        <Input
          type="text"
          placeholder="Search messages... (press Enter)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setShowResults(true)}
          className="pl-10 pr-8 bg-[#1e1f22] border-[#1e1f22] text-gray-200 placeholder:text-gray-500 focus-visible:ring-1 focus-visible:ring-[#5865f2]"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Search Results Dropdown */}
      {showResults && (
        <div className="absolute left-4 right-4 top-full mt-1 bg-[#2b2d31] border border-[#1e1f22] rounded-lg shadow-xl z-50 max-h-96 overflow-hidden">
          {searching ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 text-gray-400 animate-spin" />
            </div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-sm">
              No messages found
            </div>
          ) : (
            <ScrollArea className="max-h-96">
              <div className="p-2 space-y-1">
                {results.map((msg) => (
                  <div
                    key={msg.id}
                    className="p-2 rounded hover:bg-[#404249] cursor-pointer"
                    onClick={() => setShowResults(false)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Avatar className="size-6">
                        <AvatarImage
                          src={resolveUrl(msg.avatar_url)}
                          alt={msg.sender_full_name}
                        />
                        <AvatarFallback>
                          {msg.sender_full_name[0]}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium text-white">
                        {msg.sender_full_name}
                      </span>
                      <span className="text-xs text-gray-500">
                        {format(
                          new Date(msg.timestamp * 1000),
                          'MMM d, h:mm a'
                        )}
                      </span>
                      {msg.type === 'stream' && (
                        <span className="text-xs text-gray-400 ml-auto">
                          #{typeof msg.display_recipient === 'string' ? msg.display_recipient : ''} &gt; {msg.subject}
                        </span>
                      )}
                    </div>
                    <div
                      className="text-sm text-gray-300 line-clamp-2 zulip-content"
                      dangerouslySetInnerHTML={{
                        __html: msg.content,
                      }}
                    />
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  );
}
