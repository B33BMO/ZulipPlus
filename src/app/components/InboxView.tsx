import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, Hash, Inbox as InboxIcon, Lock } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import { toast } from 'sonner';
import { useZulip, dmKey } from '../context/ZulipContext';
import type { ZulipMessage } from '../api/types';
import { htmlToText } from '../lib/zulipMarkdown';

interface InboxViewProps {
  onOpenTopic: (streamId: number, topicName: string) => void;
  onOpenDm: (userIds: number[]) => void;
}

interface Row {
  key: string;
  label: string;
  count: number;
  latest?: ZulipMessage;
  mentioned: boolean;
  open: () => void;
}

interface Group {
  key: string;
  label: string;
  icon: 'dm' | 'public' | 'private';
  color?: string;
  rows: Row[];
  latestTs: number;
}

function when(ts: number): string {
  const d = new Date(ts * 1000);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d');
}

// Every conversation with unread messages, one row each. Counts come from
// the context's unread map (authoritative); the sender/snippet/time preview
// comes from a fetch of recent unread messages, refreshed as counts change.
// Viewing the inbox never marks anything read.
export function InboxView({ onOpenTopic, onOpenDm }: InboxViewProps) {
  const {
    unreadCounts,
    subscriptions,
    users,
    currentUser,
    fetchInboxPreviews,
    unreadMentionKeys,
    markAllAsRead,
  } = useZulip();
  const [recent, setRecent] = useState<ZulipMessage[]>([]);
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Refetch previews when the set of unread conversations changes, debounced
  // so a burst of messages costs one request.
  const countsKey = JSON.stringify(unreadCounts);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      fetchInboxPreviews()
        .then((msgs) => { if (!cancelled) setRecent(msgs); })
        .catch((err) => console.warn('Inbox preview fetch failed', err));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [countsKey, fetchInboxPreviews]);

  const groups = useMemo<Group[]>(() => {
    const myId = currentUser?.user_id;
    // Newest unread message per conversation. Mentions come from the
    // context's unread map, which covers every conversation.
    const latest = new Map<string, ZulipMessage>();
    const mentioned = unreadMentionKeys;
    for (const m of recent) {
      let key: string | null = null;
      if (m.type === 'stream' && typeof m.stream_id === 'number') {
        key = `s:${m.stream_id}:${m.subject.toLowerCase()}`;
      } else if (Array.isArray(m.display_recipient)) {
        const ids = m.display_recipient.map((r) => r.id);
        if (myId !== undefined && !ids.includes(myId)) ids.push(myId);
        key = `p:${dmKey(ids)}`;
      }
      if (!key) continue;
      const prev = latest.get(key);
      if (!prev || m.id > prev.id) latest.set(key, m);
    }

    const name = (id: number) =>
      id === myId ? currentUser?.full_name : users.find((u) => u.user_id === id)?.full_name;

    const dmRows: Row[] = Object.entries(unreadCounts.pms)
      .filter(([, n]) => n > 0)
      .map(([key, count]) => {
        const ids = key.split(',').map(Number);
        const others = ids.filter((id) => id !== myId);
        const label = others.length === 0
          ? `${currentUser?.full_name ?? 'You'} (you)`
          : others.map((id) => name(id) ?? 'Unknown user').join(', ');
        return {
          key: `p:${key}`,
          label,
          count,
          latest: latest.get(`p:${key}`),
          mentioned: true, // a DM is always addressed to you
          open: () => onOpenDm(ids),
        };
      });

    const byStream = new Map<number, Row[]>();
    for (const [key, count] of Object.entries(unreadCounts.streams)) {
      if (count <= 0) continue;
      const sep = key.indexOf(':');
      const streamId = Number(key.slice(0, sep));
      const topic = key.slice(sep + 1);
      const sub = subscriptions.find((s) => s.stream_id === streamId);
      if (!sub || sub.is_muted) continue;
      const lk = `s:${streamId}:${topic.toLowerCase()}`;
      const rows = byStream.get(streamId) ?? [];
      rows.push({
        key: lk,
        label: topic,
        count,
        latest: latest.get(lk),
        mentioned: mentioned.has(lk),
        open: () => onOpenTopic(streamId, topic),
      });
      byStream.set(streamId, rows);
    }

    const newest = (rows: Row[]) => Math.max(0, ...rows.map((r) => r.latest?.timestamp ?? 0));
    const sortRows = (rows: Row[]) =>
      rows.sort((a, b) => (b.latest?.timestamp ?? 0) - (a.latest?.timestamp ?? 0));

    const out: Group[] = [];
    if (dmRows.length > 0) {
      out.push({ key: 'dms', label: 'Direct messages', icon: 'dm', rows: sortRows(dmRows), latestTs: Infinity });
    }
    const streamGroups: Group[] = [];
    for (const [streamId, rows] of byStream) {
      const sub = subscriptions.find((s) => s.stream_id === streamId)!;
      streamGroups.push({
        key: `s${streamId}`,
        label: sub.name,
        icon: sub.invite_only ? 'private' : 'public',
        color: sub.color,
        rows: sortRows(rows),
        latestTs: newest(rows),
      });
    }
    streamGroups.sort((a, b) => b.latestTs - a.latestTs);
    return [...out, ...streamGroups];
  }, [recent, unreadCounts, unreadMentionKeys, subscriptions, users, currentUser, onOpenDm, onOpenTopic]);

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(flat.length - 1, 0)));
  }, [flat.length]);

  // J/K/arrows to move, Enter or O to open — only while focus isn't in a
  // text field elsewhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, flat.length - 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      } else if (
        (e.key === 'o' || (e.key === 'Enter' && !(t && /^(BUTTON|A)$/.test(t.tagName)))) &&
        flat[index]
      ) {
        // Enter on a focused button belongs to that button.
        e.preventDefault();
        flat[index].open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, index]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const markAll = () => {
    markAllAsRead().catch((err) =>
      toast.error('Couldn’t mark everything as read', {
        description: err instanceof Error ? err.message : undefined,
      })
    );
  };

  let i = -1;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="h-12 shrink-0 flex items-center gap-3 px-6 border-b border-line">
        <h1 className="m-0 text-[13px] font-semibold text-text-primary">Inbox</h1>
        <span className="text-[12px] text-text-muted">
          {flat.length === 0 ? 'All caught up' : `${flat.length} conversation${flat.length === 1 ? '' : 's'}`}
        </span>
        {flat.length > 0 && (
          <button
            onClick={markAll}
            className="ml-auto flex items-center gap-1.5 h-7 px-2 rounded-md text-[13px] text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <CheckCheck className="size-4" />
            Mark all as read
          </button>
        )}
      </header>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-2" role="list">
        {flat.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-text-muted">
            <InboxIcon className="size-8" />
            <p className="text-[13px]">Nothing unread. Nice.</p>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.key} className="mt-3 first:mt-1">
            <div className="flex items-center gap-1.5 px-3 pb-1 text-[11px] font-medium text-text-muted">
              {g.icon === 'public' && <Hash className="size-3" style={{ color: g.color }} />}
              {g.icon === 'private' && <Lock className="size-3" style={{ color: g.color }} />}
              {g.label}
            </div>
            {g.rows.map((r) => {
              i += 1;
              const idx = i;
              const selected = idx === index;
              const preview = r.latest ? htmlToText(r.latest.content).replace(/\s+/g, ' ').trim() : '';
              return (
                <button
                  key={r.key}
                  data-index={idx}
                  role="listitem"
                  onClick={r.open}
                  onMouseMove={() => setIndex(idx)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left text-[13px] ${
                    selected ? 'bg-surface-active' : 'hover:bg-surface-hover'
                  }`}
                >
                  <span className="size-1.5 rounded-full bg-brand shrink-0" aria-hidden="true" />
                  <span className="w-[220px] shrink-0 truncate font-semibold text-text-primary">{r.label}</span>
                  <span className="flex-1 min-w-0 truncate text-text-secondary">
                    {r.latest && <span className="text-text-primary">{r.latest.sender_full_name}: </span>}
                    {preview || (r.latest ? '(attachment)' : '')}
                  </span>
                  <span className="w-[72px] shrink-0 text-right text-[11px] text-text-muted tabular-nums">
                    {r.latest ? when(r.latest.timestamp) : ''}
                  </span>
                  <span
                    className={`min-w-[22px] h-[18px] px-1.5 rounded-full text-[11px] leading-[18px] text-center tabular-nums shrink-0 ${
                      r.mentioned ? 'bg-brand text-white' : 'bg-surface-active text-text-secondary'
                    }`}
                  >
                    {r.count}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {flat.length > 0 && (
          <div className="mt-6 px-3 text-[11px] text-text-muted">
            <kbd className="font-mono border border-line border-b-2 rounded px-1">J</kbd>{' '}
            <kbd className="font-mono border border-line border-b-2 rounded px-1">K</kbd> move ·{' '}
            <kbd className="font-mono border border-line border-b-2 rounded px-1">Enter</kbd> open
          </div>
        )}
      </div>
    </div>
  );
}
