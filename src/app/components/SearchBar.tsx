import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, Loader2, Hash, MessageSquare } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { useZulip } from '../context/ZulipContext';
import type { ZulipMessage } from '../api/types';
import { format } from 'date-fns';

interface SearchBarProps {
  onNavigateToStream?: (streamId: number, topicName: string) => void;
  onNavigateToDm?: (userId: number) => void;
}

export function SearchBar({ onNavigateToStream, onNavigateToDm }: SearchBarProps) {
  const { searchMessages, resolveUrl, currentUser, users } = useZulip();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ZulipMessage[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController>();

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setShowResults(false);
        setSearching(false);
        return;
      }

      // Cancel any in-flight search
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSearching(true);
      setShowResults(true);
      try {
        const msgs = await searchMessages(q);
        if (!controller.signal.aborted) {
          setResults(msgs);
        }
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      }
    },
    [searchMessages]
  );

  const handleChange = (value: string) => {
    setQuery(value);
    // Debounce 400ms
    clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults([]);
      setShowResults(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    setShowResults(true);
    debounceRef.current = setTimeout(() => doSearch(value), 400);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setShowResults(false);
    setSearching(false);
    clearTimeout(debounceRef.current);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      clearTimeout(debounceRef.current);
      doSearch(query);
    }
    if (e.key === 'Escape') {
      handleClear();
      inputRef.current?.blur();
    }
  };

  const handleResultClick = (msg: ZulipMessage) => {
    setShowResults(false);

    if (msg.type === 'stream') {
      // Navigate to stream > topic
      const streamId = msg.stream_id;
      const topic = msg.subject;
      if (streamId && topic && onNavigateToStream) {
        onNavigateToStream(streamId, topic);
      }
    } else if (msg.type === 'private') {
      // Navigate to DM with the other person (or self)
      if (onNavigateToDm && currentUser) {
        const recipients = msg.display_recipient as Array<{ id: number; email: string; full_name: string }>;
        const other = recipients.find(r => r.id !== currentUser.user_id);
        const targetId = other?.id ?? currentUser.user_id;
        onNavigateToDm(targetId);
      }
    }
  };

  // Extract plain text from HTML, highlight query matches
  const highlightMatch = (html: string, q: string) => {
    const div = document.createElement('div');
    div.innerHTML = html;
    const text = div.textContent || div.innerText || '';
    const trimmed = text.slice(0, 200);

    if (!q.trim()) return trimmed;

    // Escape regex special chars
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = trimmed.split(new RegExp(`(${escaped})`, 'gi'));

    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase()
        ? <mark key={i} className="bg-brand/40 text-white rounded-sm px-0.5">{part}</mark>
        : part
    );
  };

  const getLocationLabel = (msg: ZulipMessage) => {
    if (msg.type === 'stream') {
      const stream = typeof msg.display_recipient === 'string' ? msg.display_recipient : '';
      return (
        <span className="flex items-center gap-1 text-xs text-gray-400 ml-auto shrink-0">
          <Hash className="size-3" />
          {stream} &gt; {msg.subject}
        </span>
      );
    }
    // DM
    const recipients = msg.display_recipient as Array<{ id: number; full_name: string }>;
    const others = recipients.filter(r => r.id !== currentUser?.user_id);
    const name = others.length > 0 ? others.map(r => r.full_name).join(', ') : 'yourself';
    return (
      <span className="flex items-center gap-1 text-xs text-gray-400 ml-auto shrink-0">
        <MessageSquare className="size-3" />
        DM with {name}
      </span>
    );
  };

  return (
    <div ref={containerRef} className="px-4 py-3 border-b border-surface-tertiary relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-500" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search messages..."
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => query.trim() && results.length > 0 && setShowResults(true)}
          className="pl-10 pr-8 bg-surface-tertiary border border-surface-tertiary text-gray-200 placeholder:text-gray-500 focus-visible:ring-1 focus-visible:ring-brand h-9 w-full rounded-md px-3 py-1 text-sm outline-none"
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
        <div className="absolute left-4 right-4 top-full mt-1 bg-surface-secondary border border-surface-tertiary rounded-lg shadow-xl z-50 max-h-[28rem] overflow-hidden">
          {searching && results.length === 0 ? (
            <div className="flex items-center justify-center py-8 gap-2">
              <Loader2 className="size-5 text-gray-400 animate-spin" />
              <span className="text-sm text-gray-400">Searching...</span>
            </div>
          ) : !searching && results.length === 0 && query.trim() ? (
            <div className="py-8 text-center text-gray-500 text-sm">
              No messages found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <>
              {searching && (
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-tertiary">
                  <Loader2 className="size-3.5 text-gray-400 animate-spin" />
                  <span className="text-xs text-gray-400">Updating results...</span>
                </div>
              )}
              <div className="px-3 py-1.5 border-b border-surface-tertiary text-xs text-gray-500">
                {results.length} result{results.length !== 1 ? 's' : ''}
              </div>
              <div className="max-h-96 overflow-y-auto">
                <div className="p-1.5 space-y-0.5">
                  {results.map((msg) => (
                    <div
                      key={msg.id}
                      className="p-2.5 rounded-md hover:bg-surface-hover cursor-pointer transition-colors"
                      onClick={() => handleResultClick(msg)}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Avatar className="size-5">
                          <AvatarImage
                            src={resolveUrl(msg.avatar_url)}
                            alt={msg.sender_full_name}
                          />
                          <AvatarFallback className="text-[10px]">
                            {msg.sender_full_name[0]}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium text-white">
                          {msg.sender_full_name}
                        </span>
                        <span className="text-xs text-gray-500">
                          {format(new Date(msg.timestamp * 1000), 'MMM d, yyyy h:mm a')}
                        </span>
                        {getLocationLabel(msg)}
                      </div>
                      <p className="text-sm text-gray-300 line-clamp-2 ml-7">
                        {highlightMatch(msg.content, query)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
