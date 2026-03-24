import { useState } from 'react';
import { ChevronRight, ChevronDown, Hash, Menu, Users, Lock, MessageSquare, Volume2, VolumeX } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useZulip, type UserStatus } from '../context/ZulipContext';

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  activeView: 'channels' | 'users';
  onViewChange: (view: 'channels' | 'users') => void;
  onSelectDM: (userId: number) => void;
  onSelectTopic: (streamId: number, topicName: string) => void;
  activeDM: number | null;
  activeTopic: { streamId: number; topicName: string } | null;
}

export function Sidebar({
  isCollapsed,
  onToggleCollapse,
  activeView,
  onViewChange,
  onSelectDM,
  onSelectTopic,
  activeDM,
  activeTopic,
}: SidebarProps) {
  const {
    users,
    subscriptions,
    topics,
    loadTopics,
    getUserStatus,
    currentUser,
    unreadCounts,
    dmConversations,
    resolveUrl,
    muteStream,
  } = useZulip();
  const [expandedStreams, setExpandedStreams] = useState<Set<number>>(new Set());
  const [showAllDMs, setShowAllDMs] = useState(false);

  const toggleStream = async (streamId: number) => {
    const next = new Set(expandedStreams);
    if (next.has(streamId)) {
      next.delete(streamId);
    } else {
      next.add(streamId);
      if (!topics[streamId]) {
        await loadTopics(streamId);
      }
    }
    setExpandedStreams(next);
  };

  const getStatusColor = (status: UserStatus) => {
    switch (status) {
      case 'online':
        return 'bg-green-500';
      case 'idle':
        return 'bg-yellow-500';
      case 'offline':
      default:
        return 'bg-gray-500';
    }
  };

  const getStreamUnreadCount = (streamId: number) => {
    let count = 0;
    for (const [key, val] of Object.entries(unreadCounts.streams)) {
      if (key.startsWith(`${streamId}:`)) {
        count += val;
      }
    }
    return count;
  };

  const getUserById = (userId: number) => {
    if (currentUser && userId === currentUser.user_id) return currentUser;
    return users.find((u) => u.user_id === userId);
  };

  const otherUsers = users.filter(
    (u) => u.user_id !== currentUser?.user_id && !u.is_bot
  );

  const sortedSubs = [...subscriptions].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  if (isCollapsed) {
    return (
      <div className="w-16 bg-surface-secondary border-r border-surface-tertiary flex flex-col items-center py-2 h-full overflow-hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          className="text-gray-400 hover:text-white hover:bg-surface-hover mb-2 shrink-0"
        >
          <Menu className="size-5" />
        </Button>

        <div className="flex-1 overflow-y-auto w-full flex flex-col items-center gap-1 px-1.5 scrollbar-none">
          {/* DM Avatars */}
          <TooltipProvider delayDuration={200}>
            {dmConversations.slice(0, 8).map((dm) => {
              const user = getUserById(dm.userId);
              if (!user) return null;
              const status = getUserStatus(user.user_id);
              const pmUnread = unreadCounts.pms[user.user_id] || 0;
              return (
                <Tooltip key={dm.userId}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onSelectDM(dm.userId)}
                      className={`relative rounded-full transition-all ${
                        activeDM === dm.userId ? 'ring-2 ring-brand' : 'hover:opacity-80'
                      }`}
                    >
                      <Avatar className="size-9">
                        <AvatarImage src={resolveUrl(user.avatar_url)} alt={user.full_name} />
                        <AvatarFallback className="text-xs">{(user.full_name || '?')[0]}</AvatarFallback>
                      </Avatar>
                      <div className={`absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-surface-secondary ${getStatusColor(status)}`} />
                      {pmUnread > 0 && (
                        <div className="absolute -top-0.5 -right-0.5 size-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold">
                          {pmUnread > 9 ? '9+' : pmUnread}
                        </div>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right"><p>{user.full_name}</p></TooltipContent>
                </Tooltip>
              );
            })}

            {/* Divider */}
            {dmConversations.length > 0 && sortedSubs.length > 0 && (
              <div className="w-8 border-t border-surface-tertiary my-1" />
            )}

            {/* Channel Icons */}
            {sortedSubs.map((sub) => {
              const unread = getStreamUnreadCount(sub.stream_id);
              const isMuted = sub.is_muted;
              return (
                <Tooltip key={sub.stream_id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => toggleStream(sub.stream_id)}
                      className={`relative size-9 rounded-lg flex items-center justify-center transition-all shrink-0 ${
                        activeTopic?.streamId === sub.stream_id
                          ? 'ring-2 ring-brand bg-surface-hover'
                          : 'hover:bg-surface-hover'
                      } ${isMuted ? 'opacity-40' : ''}`}
                      style={{ backgroundColor: isMuted ? undefined : `${sub.color}20` }}
                    >
                      {sub.invite_only ? (
                        <Lock className="size-4" style={{ color: sub.color }} />
                      ) : (
                        <Hash className="size-4" style={{ color: sub.color }} />
                      )}
                      {unread > 0 && !isMuted && (
                        <div className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold px-0.5">
                          {unread > 99 ? '99+' : unread}
                        </div>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right"><p>{sub.name}{isMuted ? ' (muted)' : ''}</p></TooltipContent>
                </Tooltip>
              );
            })}
          </TooltipProvider>
        </div>
      </div>
    );
  }

  return (
    <div className="w-60 bg-surface-secondary border-r border-surface-tertiary flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-12 border-b border-surface-tertiary px-4 flex items-center justify-between flex-shrink-0">
        <span className="font-semibold text-white">Zulip</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          className="text-gray-400 hover:text-white hover:bg-surface-hover size-8"
        >
          <Menu className="size-4" />
        </Button>
      </div>

      {/* View Toggle */}
      <div className="px-2 py-3 flex-shrink-0">
        <Tabs
          value={activeView}
          onValueChange={(v) => onViewChange(v as 'channels' | 'users')}
          className="w-full"
        >
          <TabsList className="w-full bg-surface-tertiary p-0.5">
            <TabsTrigger
              value="channels"
              className="flex-1 data-[state=active]:bg-surface-hover data-[state=active]:text-white text-gray-400 text-xs"
            >
              DMs & Channels
            </TabsTrigger>
            <TabsTrigger
              value="users"
              className="flex-1 data-[state=active]:bg-surface-hover data-[state=active]:text-white text-gray-400 text-xs"
            >
              <Users className="size-3 mr-1" />
              All Users
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeView === 'channels' ? (
          <div className="px-2 pb-4">
            {/* Direct Messages */}
            {dmConversations.length > 0 && (
              <div className="mb-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase px-2 mb-2">
                  Direct Messages
                </h3>
                <div className="space-y-0.5">
                  {(showAllDMs ? dmConversations : dmConversations.slice(0, 5)).map((dm) => {
                    const user = getUserById(dm.userId);
                    if (!user) return null;
                    const status = getUserStatus(user.user_id);
                    const pmUnread = unreadCounts.pms[user.user_id] || 0;

                    return (
                      <button
                        key={dm.userId}
                        onClick={() => onSelectDM(dm.userId)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-hover text-left ${
                          activeDM === dm.userId ? 'bg-surface-hover' : ''
                        }`}
                      >
                        <div className="relative">
                          <Avatar className="size-8">
                            <AvatarImage
                              src={resolveUrl(user.avatar_url)}
                              alt={user.full_name}
                            />
                            <AvatarFallback>
                              {user.full_name[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div
                            className={`absolute bottom-0 right-0 size-3 rounded-full border-2 border-surface-secondary ${getStatusColor(status)}`}
                          />
                        </div>
                        <span className="flex-1 text-sm text-gray-300 truncate">
                          {user.full_name}
                          {currentUser && dm.userId === currentUser.user_id && (
                            <span className="text-gray-500"> (you)</span>
                          )}
                        </span>
                        {pmUnread > 0 && (
                          <Badge className="bg-red-500 text-white text-xs px-1.5 min-w-[20px] h-5 flex items-center justify-center">
                            {pmUnread}
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                  {dmConversations.length > 5 && (
                    <button
                      onClick={() => setShowAllDMs(!showAllDMs)}
                      className="w-full text-xs text-gray-500 hover:text-gray-300 px-2 py-1 mt-1"
                    >
                      {showAllDMs ? 'Show less' : `Show ${dmConversations.length - 5} more`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Channels */}
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase px-2 mb-2">
                Channels
              </h3>
              <div className="space-y-0.5">
                {sortedSubs.map((sub) => {
                  const unread = getStreamUnreadCount(sub.stream_id);
                  const isMuted = sub.is_muted;
                  return (
                    <div key={sub.stream_id} className={`group/stream ${isMuted ? 'opacity-50' : ''}`}>
                      <div className="flex items-center">
                        <button
                          onClick={() => toggleStream(sub.stream_id)}
                          className="flex-1 flex items-center gap-1 px-2 py-1.5 rounded hover:bg-surface-hover text-left"
                        >
                          {expandedStreams.has(sub.stream_id) ? (
                            <ChevronDown className="size-3 text-gray-400" />
                          ) : (
                            <ChevronRight className="size-3 text-gray-400" />
                          )}
                          {sub.invite_only ? (
                            <Lock className="size-4 text-gray-400" />
                          ) : (
                            <Hash className="size-4" style={{ color: sub.color }} />
                          )}
                          <span className="flex-1 text-sm text-gray-300 truncate">
                            {sub.name}
                          </span>
                          {unread > 0 && !isMuted && (
                            <Badge className="bg-red-500 text-white text-xs px-1.5 min-w-[20px] h-5 flex items-center justify-center">
                              {unread}
                            </Badge>
                          )}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); muteStream(sub.stream_id, !isMuted); }}
                          className="opacity-0 group-hover/stream:opacity-100 p-1 rounded hover:bg-surface-hover text-gray-400 hover:text-gray-200 transition-opacity mr-1"
                          title={isMuted ? 'Unmute' : 'Mute'}
                        >
                          {isMuted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                        </button>
                      </div>

                      {expandedStreams.has(sub.stream_id) && (
                        <div className="ml-6 space-y-0.5 mt-0.5">
                          {(topics[sub.stream_id] || []).map((topic) => {
                            const topicUnread =
                              unreadCounts.streams[
                                `${sub.stream_id}:${topic.name}`
                              ] || 0;
                            return (
                              <button
                                key={topic.name}
                                onClick={() =>
                                  onSelectTopic(sub.stream_id, topic.name)
                                }
                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-hover text-left ${
                                  activeTopic?.streamId === sub.stream_id &&
                                  activeTopic?.topicName === topic.name
                                    ? 'bg-surface-hover'
                                    : ''
                                }`}
                              >
                                <span className="flex-1 text-sm text-gray-400 truncate">
                                  {topic.name}
                                </span>
                                {topicUnread > 0 && (
                                  <Badge className="bg-red-500 text-white text-xs px-1.5 min-w-[20px] h-5 flex items-center justify-center">
                                    {topicUnread}
                                  </Badge>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-2 pb-4">
            <div className="space-y-0.5">
              {otherUsers.map((user) => {
                const status = getUserStatus(user.user_id);
                const pmUnread = unreadCounts.pms[user.user_id] || 0;
                return (
                  <button
                    key={user.user_id}
                    onClick={() => onSelectDM(user.user_id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-hover text-left ${
                      activeDM === user.user_id ? 'bg-surface-hover' : ''
                    }`}
                  >
                    <div className="relative">
                      <Avatar className="size-8">
                        <AvatarImage
                          src={resolveUrl(user.avatar_url)}
                          alt={user.full_name}
                        />
                        <AvatarFallback>
                          {user.full_name[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div
                        className={`absolute bottom-0 right-0 size-3 rounded-full border-2 border-surface-secondary ${getStatusColor(status)}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-300 truncate">
                        {user.full_name}
                      </div>
                    </div>
                    {pmUnread > 0 && (
                      <Badge className="bg-red-500 text-white text-xs px-1.5 min-w-[20px] h-5 flex items-center justify-center">
                        {pmUnread}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
