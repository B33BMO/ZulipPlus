import { useState } from 'react';
import { ChevronRight, ChevronDown, Hash, Menu, Users, Lock, MessageSquare } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
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
  } = useZulip();
  const [expandedStreams, setExpandedStreams] = useState<Set<number>>(new Set());

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

  const getUserById = (userId: number) => users.find((u) => u.user_id === userId);

  const otherUsers = users.filter(
    (u) => u.user_id !== currentUser?.user_id && !u.is_bot
  );

  const sortedSubs = [...subscriptions].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  if (isCollapsed) {
    return (
      <div className="w-16 bg-[#2b2d31] border-r border-[#1e1f22] flex flex-col items-center py-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          className="text-gray-400 hover:text-white hover:bg-[#404249]"
        >
          <Menu className="size-5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="w-60 bg-[#2b2d31] border-r border-[#1e1f22] flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-12 border-b border-[#1e1f22] px-4 flex items-center justify-between flex-shrink-0">
        <span className="font-semibold text-white">Zulip</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          className="text-gray-400 hover:text-white hover:bg-[#404249] size-8"
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
          <TabsList className="w-full bg-[#1e1f22] p-0.5">
            <TabsTrigger
              value="channels"
              className="flex-1 data-[state=active]:bg-[#404249] data-[state=active]:text-white text-gray-400 text-xs"
            >
              DMs & Channels
            </TabsTrigger>
            <TabsTrigger
              value="users"
              className="flex-1 data-[state=active]:bg-[#404249] data-[state=active]:text-white text-gray-400 text-xs"
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
                  {dmConversations.slice(0, 5).map((dm) => {
                    const user = getUserById(dm.userId);
                    if (!user) return null;
                    const status = getUserStatus(user.user_id);
                    const pmUnread = unreadCounts.pms[user.user_id] || 0;

                    return (
                      <button
                        key={dm.userId}
                        onClick={() => onSelectDM(dm.userId)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#404249] text-left ${
                          activeDM === dm.userId ? 'bg-[#404249]' : ''
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
                            className={`absolute bottom-0 right-0 size-3 rounded-full border-2 border-[#2b2d31] ${getStatusColor(status)}`}
                          />
                        </div>
                        <span className="flex-1 text-sm text-gray-300 truncate">
                          {user.full_name}
                        </span>
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

            {/* Channels */}
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase px-2 mb-2">
                Channels
              </h3>
              <div className="space-y-0.5">
                {sortedSubs.map((sub) => {
                  const unread = getStreamUnreadCount(sub.stream_id);
                  return (
                    <div key={sub.stream_id}>
                      <button
                        onClick={() => toggleStream(sub.stream_id)}
                        className="w-full flex items-center gap-1 px-2 py-1.5 rounded hover:bg-[#404249] text-left"
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
                        {unread > 0 && (
                          <Badge className="bg-red-500 text-white text-xs px-1.5 min-w-[20px] h-5 flex items-center justify-center">
                            {unread}
                          </Badge>
                        )}
                      </button>

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
                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#404249] text-left ${
                                  activeTopic?.streamId === sub.stream_id &&
                                  activeTopic?.topicName === topic.name
                                    ? 'bg-[#404249]'
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
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#404249] text-left ${
                      activeDM === user.user_id ? 'bg-[#404249]' : ''
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
                        className={`absolute bottom-0 right-0 size-3 rounded-full border-2 border-[#2b2d31] ${getStatusColor(status)}`}
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
