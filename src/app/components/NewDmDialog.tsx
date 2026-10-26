import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { useZulip } from '../context/ZulipContext';
import type { ZulipUser } from '../api/types';

interface NewDmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** People already picked when it opens (e.g. the DM you're adding to). Excludes you. */
  initialUserIds?: number[];
  /** Called with every participant, you included, sorted. */
  onStart: (userIds: number[]) => void;
}

const MAX_SUGGESTIONS = 8;

// Pick one person (a DM) or several (a group DM) from everyone in the org,
// not just people you've already talked to.
export function NewDmDialog({ open, onOpenChange, initialUserIds = [], onStart }: NewDmDialogProps) {
  const { users, currentUser, resolveUrl, getUserStatus } = useZulip();
  const [picked, setPicked] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Seed from the caller each time it opens. Keyed on the ids' contents, not
  // the array identity, so a re-render of the parent doesn't wipe the picks.
  const initialKey = initialUserIds.join(',');
  useEffect(() => {
    if (!open) return;
    setPicked(initialKey ? initialKey.split(',').map(Number) : []);
    setQuery('');
    setIndex(0);
  }, [open, initialKey]);

  const byId = useMemo(() => new Map(users.map((u) => [u.user_id, u])), [users]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = users.filter(
      (u) => u.is_active && u.user_id !== currentUser?.user_id && !picked.includes(u.user_id)
    );
    const matches = q
      ? pool.filter((u) => u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      : pool;
    // People before bots; names starting with the query before mid-word hits.
    return matches
      .sort((a, b) => {
        if (a.is_bot !== b.is_bot) return a.is_bot ? 1 : -1;
        if (q) {
          const as = a.full_name.toLowerCase().startsWith(q) ? 0 : 1;
          const bs = b.full_name.toLowerCase().startsWith(q) ? 0 : 1;
          if (as !== bs) return as - bs;
        }
        return a.full_name.localeCompare(b.full_name);
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [users, currentUser, picked, query]);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(suggestions.length - 1, 0)));
  }, [suggestions.length]);

  const add = (u: ZulipUser) => {
    setPicked((p) => (p.includes(u.user_id) ? p : [...p, u.user_id]));
    setQuery('');
    setIndex(0);
    inputRef.current?.focus();
  };

  const remove = (id: number) => setPicked((p) => p.filter((x) => x !== id));

  const start = () => {
    if (!currentUser || picked.length === 0) return;
    onOpenChange(false);
    onStart([currentUser.user_id, ...picked].sort((a, b) => a - b));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Enter adds the highlighted person while you're typing a name, and
      // starts the conversation once the box is empty.
      if (query.trim() && suggestions[index]) add(suggestions[index]);
      else start();
    } else if (e.key === 'Backspace' && !query && picked.length > 0) {
      e.preventDefault();
      remove(picked[picked.length - 1]);
    }
  };

  const presenceDot = (u: ZulipUser) => {
    if (u.is_bot) return null;
    const s = getUserStatus(u.user_id);
    const cls = s === 'online' ? 'bg-[#3fb47c]' : s === 'idle' ? 'bg-[#d9a23a]' : 'border border-text-muted';
    return <span className={`size-2 rounded-full shrink-0 ${cls}`} aria-label={s} role="img" />;
  };

  const label =
    picked.length === 0 ? 'Start' : picked.length === 1 ? 'Start DM' : `Start group (${picked.length + 1})`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[14%] translate-y-0 sm:max-w-[560px] p-0 gap-0 bg-surface-overlay border-line text-text-primary overflow-hidden [&>button:last-child]:hidden"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">New message</DialogTitle>
        <DialogDescription className="sr-only">
          Add one person for a direct message, or several for a group. Enter adds the highlighted
          person; Enter on an empty box starts the conversation.
        </DialogDescription>

        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5 border-b border-line min-h-12">
          <span className="text-[13px] text-text-muted pr-1">To</span>
          {picked.map((id) => {
            const u = byId.get(id);
            return (
              <span
                key={id}
                className="flex items-center gap-1.5 h-6 pl-1 pr-1 rounded-md bg-brand-muted text-[12px] text-text-primary"
              >
                <Avatar className="size-4 rounded">
                  <AvatarImage src={u ? resolveUrl(u.avatar_url) : undefined} alt="" />
                  <AvatarFallback className="rounded text-[8px]">{(u?.full_name || '?')[0]}</AvatarFallback>
                </Avatar>
                {u?.full_name ?? 'Unknown user'}
                <button
                  onClick={() => remove(id)}
                  aria-label={`Remove ${u?.full_name ?? 'person'}`}
                  className="size-4 flex items-center justify-center rounded text-text-muted hover:text-text-primary"
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={picked.length === 0 ? 'Type a name or email…' : 'Add more people…'}
            aria-label="Add people"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="new-dm-suggestions"
            className="flex-1 min-w-[140px] bg-transparent outline-none text-[14px] placeholder:text-text-muted"
          />
        </div>

        <div id="new-dm-suggestions" role="listbox" className="max-h-[46vh] overflow-y-auto p-1.5">
          {suggestions.length === 0 ? (
            <div className="px-3 py-5 text-[13px] text-text-muted">
              {query.trim() ? <>No one matches &ldquo;{query}&rdquo;.</> : 'Everyone is already added.'}
            </div>
          ) : (
            suggestions.map((u, i) => (
              <button
                key={u.user_id}
                role="option"
                aria-selected={i === index}
                onMouseMove={() => setIndex(i)}
                onClick={() => add(u)}
                className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-left text-[13px] ${
                  i === index ? 'bg-surface-active text-text-primary' : 'text-text-secondary'
                }`}
              >
                <Avatar className="size-6 rounded-md">
                  <AvatarImage src={resolveUrl(u.avatar_url)} alt="" />
                  <AvatarFallback className="rounded-md text-[10px]">{u.full_name[0]}</AvatarFallback>
                </Avatar>
                <span className="text-text-primary">{u.full_name}</span>
                {u.is_bot && (
                  <span className="text-[10px] leading-[15px] px-1 rounded border border-line text-text-muted">BOT</span>
                )}
                <span className="text-[12px] text-text-muted truncate">{u.email}</span>
                <span className="ml-auto">{presenceDot(u)}</span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-t border-line">
          <span className="text-[11px] text-text-muted">
            <kbd className="font-mono border border-line border-b-2 rounded px-1">Enter</kbd> add ·{' '}
            <kbd className="font-mono border border-line border-b-2 rounded px-1">Enter</kbd> on empty to start ·{' '}
            <kbd className="font-mono border border-line border-b-2 rounded px-1">Backspace</kbd> remove last
          </span>
          <button
            onClick={start}
            disabled={picked.length === 0}
            className="ml-auto h-7 px-3 rounded-md bg-brand text-white text-[13px] font-medium hover:bg-brand-hover disabled:opacity-40"
          >
            {label}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
