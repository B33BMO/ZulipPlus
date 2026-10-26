import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Hash, Loader2, Lock, MessageSquare, Search, User } from 'lucide-react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { useZulip } from '../context/ZulipContext';
import type { ZulipMessage, ZulipSubscription, ZulipUser } from '../api/types';
import { htmlToText } from '../lib/zulipMarkdown';

interface SearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the result's conversation, scrolled to that message. */
  onOpenMessage: (message: ZulipMessage) => void;
  onOpenDm: (userIds: number[]) => void;
  onOpenChannel: (streamId: number) => void;
}

type Result =
  | { kind: 'person'; key: string; user: ZulipUser }
  | { kind: 'channel'; key: string; sub: ZulipSubscription }
  | { kind: 'message'; key: string; msg: ZulipMessage };

const MAX_PEOPLE = 5;
const MAX_CHANNELS = 5;

// Ctrl+K: one box for jumping to a person or channel and for full-text
// message search. Names match locally as you type; message search hits the
// server after a pause (or immediately on Enter with no local match).
export function SearchPalette({
  open,
  onOpenChange,
  onOpenMessage,
  onOpenDm,
  onOpenChannel,
}: SearchPaletteProps) {
  const { searchMessages, resolveUrl, currentUser, users, subscriptions } = useZulip();
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ZulipMessage[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState('');
  const [index, setIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);

  // Fresh palette each time it opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setMessages([]);
    setSearched('');
    setIndex(0);
  }, [open]);

  useEffect(() => () => {
    clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);

  const runSearch = useCallback(
    async (q: string) => {
      abortRef.current?.abort();
      if (!q.trim()) {
        setMessages([]);
        setSearching(false);
        setSearched('');
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setSearching(true);
      try {
        const msgs = await searchMessages(q, controller.signal);
        if (!controller.signal.aborted) {
          // Newest first reads better in a result list.
          setMessages(msgs.slice().reverse());
          setSearched(q);
        }
      } catch (err) {
        if (!controller.signal.aborted && (err as { name?: string })?.name !== 'AbortError') {
          setMessages([]);
          setSearched(q);
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    },
    [searchMessages]
  );

  const onChange = (value: string) => {
    setQuery(value);
    setIndex(0);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), 350);
  };

  const q = query.trim().toLowerCase();
  const people = useMemo(
    () =>
      q
        ? users
            .filter(
              (u) =>
                u.is_active &&
                !u.is_bot &&
                (u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
            )
            .slice(0, MAX_PEOPLE)
        : [],
    [q, users]
  );
  const channels = useMemo(
    () => (q ? subscriptions.filter((s) => s.name.toLowerCase().includes(q)).slice(0, MAX_CHANNELS) : []),
    [q, subscriptions]
  );

  const results: Result[] = useMemo(
    () => [
      ...people.map((user) => ({ kind: 'person' as const, key: `p${user.user_id}`, user })),
      ...channels.map((sub) => ({ kind: 'channel' as const, key: `c${sub.stream_id}`, sub })),
      ...messages.map((msg) => ({ kind: 'message' as const, key: `m${msg.id}`, msg })),
    ],
    [people, channels, messages]
  );

  const choose = (r: Result | undefined) => {
    if (!r) return;
    onOpenChange(false);
    if (r.kind === 'person' && currentUser) {
      onOpenDm([currentUser.user_id, r.user.user_id]);
    } else if (r.kind === 'channel') {
      onOpenChannel(r.sub.stream_id);
    } else if (r.kind === 'message') {
      onOpenMessage(r.msg);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results.length > 0) {
        choose(results[index]);
      } else {
        clearTimeout(debounceRef.current);
        runSearch(query);
      }
    }
  };

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const snippet = (html: string) => {
    const text = htmlToText(html).replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!q) return text;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.split(new RegExp(`(${escaped})`, 'gi')).map((part, i) =>
      part.toLowerCase() === q ? (
        <mark key={i} className="bg-brand-muted text-text-primary rounded-sm px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const where = (msg: ZulipMessage) => {
    if (msg.type === 'stream') {
      const stream = typeof msg.display_recipient === 'string' ? msg.display_recipient : '';
      return `#${stream} › ${msg.subject}`;
    }
    const recipients = msg.display_recipient as Array<{ id: number; full_name: string }>;
    const others = recipients.filter((r) => r.id !== currentUser?.user_id);
    return others.length > 0 ? others.map((r) => r.full_name).join(', ') : 'You';
  };

  let row = -1;
  const section = (label: string, items: ReactNode) => (
    <div className="py-1">
      <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-text-muted">{label}</div>
      {items}
    </div>
  );
  const rowProps = (r: Result) => {
    row += 1;
    const i = row;
    return {
      'data-index': i,
      onMouseMove: () => setIndex(i),
      onClick: () => choose(r),
      className: `w-full flex items-center gap-3 px-3 py-1.5 text-left text-[13px] rounded-md ${
        index === i ? 'bg-surface-active text-text-primary' : 'text-text-secondary'
      }`,
      'aria-selected': index === i,
      role: 'option' as const,
    };
  };

  const empty = !searching && q && results.length === 0 && searched === query;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[14%] translate-y-0 sm:max-w-[640px] p-0 gap-0 bg-surface-overlay border-line text-text-primary overflow-hidden [&>button:last-child]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Search or jump to</DialogTitle>
        <DialogDescription className="sr-only">
          Type a person, channel, or words to search messages. Use the arrow keys and Enter.
        </DialogDescription>
        <div className="flex items-center gap-2 px-4 h-12 border-b border-line">
          {searching ? (
            <Loader2 className="size-4 text-text-muted animate-spin" />
          ) : (
            <Search className="size-4 text-text-muted" />
          )}
          <input
            autoFocus
            value={query}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search messages, or jump to a person or channel…"
            aria-label="Search"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="search-palette-results"
            className="flex-1 bg-transparent outline-none text-[14px] text-text-primary placeholder:text-text-muted"
          />
          <kbd className="font-mono text-[10px] border border-line border-b-2 rounded px-1 text-text-muted">Esc</kbd>
        </div>

        <div
          ref={listRef}
          id="search-palette-results"
          role="listbox"
          className="max-h-[60vh] overflow-y-auto px-1.5 pb-1.5"
        >
          {!q && (
            <div className="px-3 py-6 text-[13px] text-text-muted">
              Type a name to jump to a DM or channel. Zulip search operators work too, e.g.{' '}
              <code className="font-mono text-[12px]">from:sam backup</code> or{' '}
              <code className="font-mono text-[12px]">channel:customers has:attachment</code>.
            </div>
          )}

          {people.length > 0 &&
            section(
              'People',
              people.map((user) => {
                const r = results.find((x) => x.key === `p${user.user_id}`)!;
                return (
                  <button key={r.key} {...rowProps(r)}>
                    <Avatar className="size-5 rounded">
                      <AvatarImage src={resolveUrl(user.avatar_url)} alt="" />
                      <AvatarFallback className="rounded text-[9px]">{user.full_name[0]}</AvatarFallback>
                    </Avatar>
                    <span className="text-text-primary">{user.full_name}</span>
                    <span className="text-text-muted text-[12px] truncate">{user.email}</span>
                    <User className="size-3.5 ml-auto text-text-muted" />
                  </button>
                );
              })
            )}

          {channels.length > 0 &&
            section(
              'Channels',
              channels.map((sub) => {
                const r = results.find((x) => x.key === `c${sub.stream_id}`)!;
                return (
                  <button key={r.key} {...rowProps(r)}>
                    {sub.invite_only ? (
                      <Lock className="size-4" style={{ color: sub.color }} />
                    ) : (
                      <Hash className="size-4" style={{ color: sub.color }} />
                    )}
                    <span className="text-text-primary">{sub.name}</span>
                  </button>
                );
              })
            )}

          {messages.length > 0 &&
            section(
              `Messages · ${messages.length}${messages.length >= 50 ? '+' : ''}`,
              messages.map((msg) => {
                const r = results.find((x) => x.key === `m${msg.id}`)!;
                return (
                  <button key={r.key} {...rowProps(r)}>
                    <MessageSquare className="size-4 text-text-muted shrink-0 self-start mt-0.5" />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-baseline gap-2 text-[12px]">
                        <span className="font-medium text-text-primary">{msg.sender_full_name}</span>
                        <span className="text-text-muted truncate">{where(msg)}</span>
                        <span className="ml-auto text-text-muted shrink-0">
                          {format(new Date(msg.timestamp * 1000), 'MMM d, h:mm a')}
                        </span>
                      </span>
                      <span className="block truncate text-text-secondary">{snippet(msg.content)}</span>
                    </span>
                  </button>
                );
              })
            )}

          {empty && (
            <div className="px-3 py-6 text-[13px] text-text-muted">
              Nothing found for &ldquo;{query}&rdquo;.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
