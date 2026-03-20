import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { useZulip } from '../context/ZulipContext';
import type { ZulipMessage } from '../api/types';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';

export function MessageList() {
  const { messages, currentUser, markMessagesAsRead, addReaction, removeReaction, resolveUrl, fetchAuthenticatedUrl, loadOlderMessages, hasMoreMessages, loadingOlder } = useZulip();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);
  const prevScrollHeight = useRef(0);

  // Scroll to bottom when messages change (only for new messages at the end)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;

    // If we just loaded older messages, restore scroll position
    if (prevScrollHeight.current > 0) {
      const newScrollHeight = el.scrollHeight;
      el.scrollTop = newScrollHeight - prevScrollHeight.current;
      prevScrollHeight.current = 0;
      return;
    }

    // Otherwise scroll to bottom
    bottomRef.current?.scrollIntoView({ behavior: hasScrolled.current ? 'smooth' : 'instant' });
    hasScrolled.current = true;
  }, [messages]);

  // Lazy loading: detect scroll to top
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMoreMessages || loadingOlder) return;

    if (el.scrollTop < 100) {
      prevScrollHeight.current = el.scrollHeight;
      loadOlderMessages();
    }
  }, [hasMoreMessages, loadingOlder, loadOlderMessages]);

  // Mark messages as read
  useEffect(() => {
    const unread = messages
      .filter((m) => !(m.flags ?? []).includes('read'))
      .map((m) => m.id);
    if (unread.length > 0) {
      markMessagesAsRead(unread);
    }
  }, [messages, markMessagesAsRead]);

  // Rewrite relative URLs in HTML content to go through proxy
  const processContent = useCallback(
    (html: string): string => {
      return html.replace(
        /(<(?:img|a)\s[^>]*?)(?:src|href)="(\/[^"]+)"([^>]*?>)/g,
        (_match, before: string, url: string, after: string) => {
          const resolved = resolveUrl(url);
          if (before.trim().startsWith('<img')) {
            // Use a placeholder src and store original in data attr for auth loading
            return `${before}src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-auth-src="${url}" class="zulip-auth-img"${after}`;
          }
          return `${before}href="${resolved}"${after}`;
        }
      );
    },
    [resolveUrl]
  );

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return format(date, 'h:mm a');
    } else if (days === 1) {
      return `Yesterday at ${format(date, 'h:mm a')}`;
    } else if (days < 7) {
      return format(date, "EEEE 'at' h:mm a");
    } else {
      return format(date, 'MM/dd/yyyy h:mm a');
    }
  };

  const handleReactionClick = (message: ZulipMessage, emojiName: string) => {
    if (!currentUser) return;
    const existing = message.reactions.find(
      (r) => r.emoji_name === emojiName && r.user_id === currentUser.user_id
    );
    if (existing) {
      removeReaction(message.id, emojiName);
    } else {
      addReaction(message.id, emojiName);
    }
  };

  // Group reactions by emoji
  const groupReactions = (message: ZulipMessage) => {
    const groups: Record<
      string,
      { emoji_name: string; emoji_code: string; count: number; userIds: number[] }
    > = {};
    for (const r of message.reactions) {
      if (!groups[r.emoji_name]) {
        groups[r.emoji_name] = {
          emoji_name: r.emoji_name,
          emoji_code: r.emoji_code,
          count: 0,
          userIds: [],
        };
      }
      groups[r.emoji_name].count++;
      groups[r.emoji_name].userIds.push(r.user_id);
    }
    return Object.values(groups);
  };

  // Attempt to render emoji from name (basic mapping, falls back to name)
  const renderEmoji = (emojiName: string, emojiCode: string) => {
    try {
      const codePoints = emojiCode.split('-').map((cp) => parseInt(cp, 16));
      return String.fromCodePoint(...codePoints);
    } catch {
      return `:${emojiName}:`;
    }
  };

  // Pre-process all message content with URL rewriting
  const processedMessages = useMemo(
    () => messages.map((m) => ({ ...m, _html: processContent(m.content) })),
    [messages, processContent]
  );

  // Load images with auth (Zulip requires auth for user_uploads/avatars)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const imgs = el.querySelectorAll<HTMLImageElement>('img.zulip-auth-img');
    imgs.forEach(async (img) => {
      const originalSrc = img.dataset.authSrc;
      if (!originalSrc || img.dataset.loaded === 'true') return;
      img.dataset.loaded = 'true';
      const blobUrl = await fetchAuthenticatedUrl(originalSrc);
      img.src = blobUrl;
    });
  }, [processedMessages, fetchAuthenticatedUrl]);

  const renderReactions = (message: ZulipMessage) => {
    const reactionGroups = groupReactions(message);
    if (reactionGroups.length === 0) return null;
    return (
      <div className="flex gap-1 mt-1 flex-wrap">
        {reactionGroups.map((rg) => (
          <button
            key={rg.emoji_name}
            onClick={() => handleReactionClick(message, rg.emoji_name)}
            className={`flex items-center gap-1 border rounded px-1.5 py-0.5 cursor-pointer ${
              currentUser && rg.userIds.includes(currentUser.user_id)
                ? 'bg-[#5865f2]/20 border-[#5865f2]/50'
                : 'bg-[#2e3035] hover:bg-[#3a3c42] border-[#404249]'
            }`}
          >
            <span className="text-sm">
              {renderEmoji(rg.emoji_name, rg.emoji_code)}
            </span>
            <span className="text-xs text-gray-400">{rg.count}</span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto px-4"
    >
      {/* Loading older messages indicator */}
      {loadingOlder && (
        <div className="flex justify-center py-3">
          <Loader2 className="size-5 text-gray-400 animate-spin" />
        </div>
      )}

      <div className="py-4 space-y-4">
        {processedMessages.map((message, idx) => {
          const prevMessage = idx > 0 ? processedMessages[idx - 1] : null;
          const showHeader =
            !prevMessage ||
            prevMessage.sender_id !== message.sender_id ||
            message.timestamp - prevMessage.timestamp > 300;

          return (
            <div
              key={message.id}
              className="group hover:bg-[#2e3035] -mx-2 px-2 py-0.5"
            >
              {showHeader ? (
                <div className="flex gap-3">
                  <Avatar className="size-10 mt-0.5 flex-shrink-0">
                    <AvatarImage
                      src={resolveUrl(message.avatar_url)}
                      alt={message.sender_full_name}
                    />
                    <AvatarFallback>
                      {message.sender_full_name[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="font-semibold text-white text-sm">
                        {message.sender_full_name}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatTime(message.timestamp)}
                      </span>
                    </div>
                    <div
                      className="text-gray-200 text-sm leading-relaxed break-words zulip-content"
                      dangerouslySetInnerHTML={{ __html: message._html }}
                    />
                    {renderReactions(message)}
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <div className="w-10 flex-shrink-0 flex items-center justify-end">
                    <span className="text-xs text-gray-500 opacity-0 group-hover:opacity-100">
                      {format(new Date(message.timestamp * 1000), 'h:mm a')}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-gray-200 text-sm leading-relaxed break-words zulip-content"
                      dangerouslySetInnerHTML={{ __html: message._html }}
                    />
                    {renderReactions(message)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
