import { useEffect, useState, type ReactNode } from 'react';
import {
  AtSign,
  ChevronDown,
  ChevronRight,
  Hash,
  Inbox,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Star,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useZulip, dmKey, type UserStatus } from '../context/ZulipContext';
import { Logo } from './Logo';

export type SpecialView = 'inbox' | 'mentions' | 'starred';

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  // Sorted user IDs of all participants in the target DM (incl. self).
  onSelectDM: (userIds: number[]) => void;
  onSelectTopic: (streamId: number, topicName: string) => void;
  onSelectSpecial: (view: SpecialView) => void;
  onOpenSearch: () => void;
  activeDM: number[] | null;
  activeTopic: { streamId: number; topicName: string } | null;
  activeSpecial: SpecialView | null;
  /** Rendered at the bottom: the current user / settings menu. */
  footer: ReactNode;
}

// Below this many topics the list is scannable by eye and a search box is
// just clutter; above it, finding a topic by scrolling is miserable.
const TOPIC_FILTER_THRESHOLD = 8;
// Topics shown per channel before "Show all".
const TOPIC_LIMIT = 8;
const DM_LIMIT = 6;

const PRESENCE_COLOR: Record<UserStatus, string> = {
  online: 'bg-[#3fb47c]',
  idle: 'bg-[#d9a23a]',
  offline: 'bg-transparent border-text-muted',
};

// Shared row styling: one height, one radius, hover/active from the theme.
function rowClass(active: boolean, unread = false) {
  return [
    'group/row w-full flex items-center gap-2 h-7 px-2 rounded-md text-left text-[13px] outline-none',
    'focus-visible:ring-2 focus-visible:ring-brand/60',
    active
      ? 'bg-surface-active text-text-primary'
      : `${unread ? 'text-text-primary font-semibold' : 'text-text-secondary'} hover:bg-surface-hover hover:text-text-primary`,
  ].join(' ');
}

function CountBadge({ count, accent = false }: { count: number; accent?: boolean }) {
  if (count <= 0) return null;
  const text = count > 999 ? '999+' : String(count);
  return accent ? (
    <span className="ml-auto min-w-[18px] h-[18px] px-1.5 rounded-full bg-brand text-white text-[11px] leading-[18px] text-center font-medium tabular-nums">
      {text}
    </span>
  ) : (
    <span className="ml-auto text-[11px] text-text-muted tabular-nums font-normal">{text}</span>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pb-1 text-[11px] font-medium text-text-muted tracking-[0.02em]">
      {children}
    </div>
  );
}

export function Sidebar({
  isCollapsed,
  onToggleCollapse,
  onSelectDM,
  onSelectTopic,
  onSelectSpecial,
  onOpenSearch,
  activeDM,
  activeTopic,
  activeSpecial,
  footer,
}: SidebarProps) {
  const {
    users,
    subscriptions,
    topics,
    loadTopics,
    getUserStatus,
    currentUser,
    unreadCounts,
    unreadMentionCount,
    dmConversations,
    resolveUrl,
    muteStream,
    realmName,
    serverUrl,
  } = useZulip();
  const [expandedStreams, setExpandedStreams] = useState<Set<number>>(new Set());
  const [showAllTopics, setShowAllTopics] = useState<Set<number>>(new Set());
  const [showAllDMs, setShowAllDMs] = useState(false);
  // Per-stream topic filter text, keyed by stream id.
  const [topicFilters, setTopicFilters] = useState<Record<number, string>>({});

  const setTopicFilter = (streamId: number, value: string) =>
    setTopicFilters((prev) => ({ ...prev, [streamId]: value }));

  // Expand immediately and (re)fetch topics in the background. Topics are
  // always refetched: the event loop seeds `topics[id]` with just the one
  // topic a new message landed in, so "already have some" doesn't mean
  // "have the list".
  const expandStream = (streamId: number) => {
    setExpandedStreams((prev) => new Set(prev).add(streamId));
    loadTopics(streamId).catch((err) => console.error('Failed to load topics:', err));
  };

  const toggleStream = (streamId: number) => {
    if (expandedStreams.has(streamId)) {
      setExpandedStreams((prev) => {
        const next = new Set(prev);
        next.delete(streamId);
        return next;
      });
    } else {
      expandStream(streamId);
    }
  };

  // Reveal the open topic's channel when navigation happens from outside the
  // sidebar (search, links, notifications).
  const activeStreamId = activeTopic?.streamId;
  useEffect(() => {
    if (activeStreamId === undefined) return;
    setExpandedStreams((prev) => (prev.has(activeStreamId) ? prev : new Set(prev).add(activeStreamId)));
  }, [activeStreamId]);

  const getStreamUnreadCount = (streamId: number) => {
    let count = 0;
    for (const [key, val] of Object.entries(unreadCounts.streams)) {
      if (key.startsWith(`${streamId}:`)) count += val;
    }
    return count;
  };

  const getUserById = (userId: number) => {
    if (currentUser && userId === currentUser.user_id) return currentUser;
    return users.find((u) => u.user_id === userId);
  };

  const activeDmKey = activeDM ? dmKey(activeDM) : null;

  // Other participants' names, or "<me> (you)" for a self-DM.
  const dmLabel = (userIds: number[]): string => {
    if (!currentUser) return 'Direct message';
    const others = userIds.filter((id) => id !== currentUser.user_id);
    if (others.length === 0) return `${currentUser.full_name} (you)`;
    const names = others.map((id) => getUserById(id)?.full_name).filter(Boolean) as string[];
    return names.length === 0 ? 'Direct message' : names.join(', ');
  };

  const dmPrimaryUserId = (userIds: number[]): number | undefined => {
    if (!currentUser) return userIds[0];
    const others = userIds.filter((id) => id !== currentUser.user_id);
    return others.length === 0 ? currentUser.user_id : others[0];
  };

  // Unread channels first would reorder the list under the cursor as
  // messages arrive; alphabetical keeps positions learnable.
  const sortedSubs = [...subscriptions].sort((a, b) => a.name.localeCompare(b.name));
  const inboxCount =
    Object.values(unreadCounts.pms).reduce((a, b) => a + b, 0) +
    subscriptions
      .filter((s) => !s.is_muted)
      .reduce((sum, s) => sum + getStreamUnreadCount(s.stream_id), 0);

  const workspaceName = realmName || (() => {
    try {
      return new URL(serverUrl).hostname;
    } catch {
      return 'Zulip';
    }
  })();

  const navItems: { id: SpecialView; label: string; icon: ReactNode; count: number; accent: boolean }[] = [
    { id: 'inbox', label: 'Inbox', icon: <Inbox className="size-4" />, count: inboxCount, accent: false },
    { id: 'mentions', label: 'Mentions', icon: <AtSign className="size-4" />, count: unreadMentionCount, accent: true },
    { id: 'starred', label: 'Starred', icon: <Star className="size-4" />, count: 0, accent: false },
  ];

  const renderDmAvatar = (userIds: number[], size: string) => {
    const primaryId = dmPrimaryUserId(userIds);
    const user = primaryId !== undefined ? getUserById(primaryId) : undefined;
    const others = currentUser ? userIds.filter((id) => id !== currentUser.user_id) : userIds;
    const isGroup = others.length > 1;
    const status = !isGroup && user ? getUserStatus(user.user_id) : null;
    return (
      <span className="relative shrink-0">
        <Avatar className={`${size} rounded-[5px]`}>
          <AvatarImage src={user ? resolveUrl(user.avatar_url) : undefined} alt="" />
          <AvatarFallback className="rounded-[5px] text-[9px] font-semibold bg-surface-active">
            {isGroup ? others.length : (user?.full_name || '?')[0]}
          </AvatarFallback>
        </Avatar>
        {status && (
          <span
            className={`absolute -right-0.5 -bottom-0.5 size-2 rounded-full border-2 border-surface-sidebar ${PRESENCE_COLOR[status]}`}
            aria-label={status}
            role="img"
          />
        )}
      </span>
    );
  };

  if (isCollapsed) {
    return (
      <TooltipProvider delayDuration={200}>
        <nav
          aria-label="Workspace"
          className="w-14 bg-surface-sidebar border-r border-line flex flex-col items-center py-3 gap-1 h-full overflow-hidden"
        >
          <button
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            className="size-8 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover mb-2"
          >
            <PanelLeftOpen className="size-4" />
          </button>
          {navItems.map((item) => (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSelectSpecial(item.id)}
                  aria-label={item.label}
                  className={`relative size-8 rounded-md flex items-center justify-center ${
                    activeSpecial === item.id
                      ? 'bg-surface-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                  }`}
                >
                  {item.icon}
                  {item.count > 0 && (
                    <span
                      className={`absolute -top-0.5 -right-0.5 size-2 rounded-full ${item.accent ? 'bg-brand' : 'bg-text-muted'}`}
                    />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ))}
          <div className="w-6 border-t border-line my-2" />
          <div className="flex-1 overflow-y-auto w-full flex flex-col items-center gap-1 scrollbar-none">
            {dmConversations.slice(0, 8).map((dm) => {
              const key = dmKey(dm.userIds);
              const unread = unreadCounts.pms[key] || 0;
              return (
                <Tooltip key={key}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onSelectDM(dm.userIds)}
                      aria-label={dmLabel(dm.userIds)}
                      className={`relative p-1 rounded-md ${activeDmKey === key ? 'bg-surface-active' : 'hover:bg-surface-hover'}`}
                    >
                      {renderDmAvatar(dm.userIds, 'size-6')}
                      {unread > 0 && <span className="absolute top-0 right-0 size-2 rounded-full bg-brand" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{dmLabel(dm.userIds)}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </nav>
      </TooltipProvider>
    );
  }

  return (
    <nav
      aria-label="Workspace"
      className="w-[248px] shrink-0 bg-surface-sidebar border-r border-line flex flex-col h-full overflow-hidden"
    >
      {/* Workspace + collapse */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <Logo size={22} className="shrink-0" />
        <span className="font-semibold text-[13px] text-text-primary truncate">{workspaceName}</span>
        <button
          onClick={onToggleCollapse}
          aria-label="Collapse sidebar"
          className="ml-auto size-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      {/* Search / jump */}
      <div className="px-2 pb-3">
        <button
          onClick={onOpenSearch}
          className="w-full h-[30px] flex items-center gap-2 px-2 rounded-md border border-line bg-surface-primary text-[13px] text-text-muted hover:text-text-secondary hover:border-text-muted/40"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <kbd className="font-mono text-[10px] border border-line border-b-2 rounded px-1 text-text-muted">Ctrl K</kbd>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-4 flex flex-col gap-4">
        {/* Views */}
        <div className="flex flex-col gap-px">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectSpecial(item.id)}
              className={rowClass(activeSpecial === item.id)}
              aria-current={activeSpecial === item.id ? 'page' : undefined}
            >
              <span className="text-text-muted">{item.icon}</span>
              <span>{item.label}</span>
              <CountBadge count={item.count} accent={item.accent} />
            </button>
          ))}
        </div>

        {/* Direct messages */}
        {dmConversations.length > 0 && (
          <div className="flex flex-col gap-px">
            <SectionLabel>Direct messages</SectionLabel>
            {(showAllDMs ? dmConversations : dmConversations.slice(0, DM_LIMIT)).map((dm) => {
              const key = dmKey(dm.userIds);
              const unread = unreadCounts.pms[key] || 0;
              return (
                <button
                  key={key}
                  onClick={() => onSelectDM(dm.userIds)}
                  className={rowClass(activeDmKey === key, unread > 0)}
                  aria-current={activeDmKey === key ? 'page' : undefined}
                >
                  {renderDmAvatar(dm.userIds, 'size-4')}
                  <span className="truncate">{dmLabel(dm.userIds)}</span>
                  <CountBadge count={unread} accent />
                </button>
              );
            })}
            {dmConversations.length > DM_LIMIT && (
              <button
                onClick={() => setShowAllDMs(!showAllDMs)}
                className="h-6 px-2 text-left text-[12px] text-text-muted hover:text-text-primary"
              >
                {showAllDMs ? 'Show fewer' : `Show ${dmConversations.length - DM_LIMIT} more`}
              </button>
            )}
          </div>
        )}

        {/* Channels */}
        <div className="flex flex-col gap-px">
          <SectionLabel>Channels</SectionLabel>
          {sortedSubs.map((sub) => {
            const unread = sub.is_muted ? 0 : getStreamUnreadCount(sub.stream_id);
            const expanded = expandedStreams.has(sub.stream_id);
            const allTopics = topics[sub.stream_id] || [];
            const filter = (topicFilters[sub.stream_id] || '').trim().toLowerCase();
            const matching = filter
              ? allTopics.filter((t) => t.name.toLowerCase().includes(filter))
              : allTopics;
            const limited = !filter && !showAllTopics.has(sub.stream_id);
            // Keep the open topic visible even when it's past the limit.
            const visibleTopics = limited
              ? matching.filter(
                  (t, i) =>
                    i < TOPIC_LIMIT ||
                    (activeTopic?.streamId === sub.stream_id && activeTopic.topicName === t.name)
                )
              : matching;
            const hidden = matching.length - visibleTopics.length;
            const showFilter = allTopics.length > TOPIC_FILTER_THRESHOLD;
            return (
              <div key={sub.stream_id} className={sub.is_muted ? 'opacity-60' : ''}>
                <div className="relative group/stream">
                  <button
                    onClick={() => toggleStream(sub.stream_id)}
                    className={rowClass(false, unread > 0)}
                    aria-expanded={expanded}
                  >
                    {sub.invite_only ? (
                      <Lock className="size-3.5 shrink-0" style={{ color: sub.color }} />
                    ) : (
                      <Hash className="size-3.5 shrink-0" style={{ color: sub.color }} />
                    )}
                    <span className="truncate">{sub.name}</span>
                    <span className="ml-auto flex items-center gap-1">
                      <span className="group-hover/stream:hidden">
                        <CountBadge count={unread} />
                      </span>
                      {expanded ? (
                        <ChevronDown className="size-3 text-text-muted" />
                      ) : (
                        <ChevronRight className="size-3 text-text-muted opacity-0 group-hover/stream:opacity-100" />
                      )}
                    </span>
                  </button>
                  <button
                    onClick={() => muteStream(sub.stream_id, !sub.is_muted)}
                    aria-label={sub.is_muted ? `Unmute ${sub.name}` : `Mute ${sub.name}`}
                    title={sub.is_muted ? 'Unmute' : 'Mute'}
                    className="absolute right-6 top-1/2 -translate-y-1/2 hidden group-hover/stream:flex size-5 items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-active"
                  >
                    {sub.is_muted ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
                  </button>
                </div>

                {expanded && (
                  <div className="flex flex-col gap-px">
                    {showFilter && (
                      <div className="relative my-1 ml-6 mr-1">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-text-muted pointer-events-none" />
                        <input
                          type="text"
                          value={topicFilters[sub.stream_id] || ''}
                          onChange={(e) => setTopicFilter(sub.stream_id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              setTopicFilter(sub.stream_id, '');
                            }
                          }}
                          placeholder={`Filter ${allTopics.length} topics`}
                          aria-label={`Filter topics in ${sub.name}`}
                          className="w-full h-6 pl-6 pr-6 rounded border border-line bg-surface-primary text-text-primary placeholder:text-text-muted text-[12px] outline-none focus:border-brand"
                        />
                        {filter && (
                          <button
                            onClick={() => setTopicFilter(sub.stream_id, '')}
                            aria-label="Clear topic filter"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </div>
                    )}
                    {matching.length === 0 && filter && (
                      <div className="pl-8 pr-2 py-1 text-[12px] text-text-muted italic">
                        No topics match &ldquo;{topicFilters[sub.stream_id]}&rdquo;
                      </div>
                    )}
                    {visibleTopics.map((topic) => {
                      const topicUnread = unreadCounts.streams[`${sub.stream_id}:${topic.name}`] || 0;
                      const active =
                        activeTopic?.streamId === sub.stream_id && activeTopic?.topicName === topic.name;
                      return (
                        <button
                          key={topic.name}
                          onClick={() => onSelectTopic(sub.stream_id, topic.name)}
                          className={`${rowClass(active, topicUnread > 0 && !sub.is_muted)} pl-8 h-[26px]`}
                          aria-current={active ? 'page' : undefined}
                        >
                          <span className="truncate">{topic.name}</span>
                          {!sub.is_muted && <CountBadge count={topicUnread} />}
                        </button>
                      );
                    })}
                    {(hidden > 0 || (!limited && !filter && allTopics.length > TOPIC_LIMIT)) && (
                      <button
                        onClick={() =>
                          setShowAllTopics((prev) => {
                            const next = new Set(prev);
                            if (next.has(sub.stream_id)) next.delete(sub.stream_id);
                            else next.add(sub.stream_id);
                            return next;
                          })
                        }
                        className="h-6 pl-8 text-left text-[12px] text-text-muted hover:text-text-primary"
                      >
                        {limited ? `Show all ${allTopics.length} topics` : 'Show fewer'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-line p-2">{footer}</div>
    </nav>
  );
}
