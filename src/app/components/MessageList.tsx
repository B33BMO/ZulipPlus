import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { useZulip } from '../context/ZulipContext';
import type { ZulipMessage } from '../api/types';
import { format } from 'date-fns';
import { Loader2, Pencil, Quote, SmilePlus, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Button } from './ui/button';
import { EmojiPicker } from './EmojiPicker';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';

interface MessageListProps {
  onQuote?: (senderName: string, content: string) => void;
}

export function MessageList({ onQuote }: MessageListProps = {}) {
  const { messages, currentUser, markMessagesAsRead, addReaction, removeReaction, editMessage, deleteMessage, getMessageRaw, resolveUrl, fetchAuthenticatedUrl, loadOlderMessages, hasMoreMessages, loadingOlder, realmEmoji } = useZulip();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);
  const prevScrollHeight = useRef(0);
  const isNearBottom = useRef(true);
  const [reactingMessageId, setReactingMessageId] = useState<number | null>(null);
  const [pickerPos, setPickerPos] = useState<{ right: number; bottom: number } | null>(null);
  const reactPickerRef = useRef<HTMLDivElement>(null);
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  // Edit/delete UI state. Inline edit is a controlled textarea seeded with
  // the raw markdown (fetched on edit-start because cached messages only
  // store rendered HTML). Delete uses a confirm dialog because the action
  // is irreversible and there's no undo from the server side.
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const startEdit = useCallback(async (messageId: number) => {
    setEditingMessageId(messageId);
    setEditDraft('');
    try {
      const raw = await getMessageRaw(messageId);
      setEditDraft(raw);
    } catch (err) {
      console.error('Failed to fetch raw message for edit:', err);
      setEditingMessageId(null);
    }
  }, [getMessageRaw]);

  const cancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditDraft('');
  }, []);

  const saveEdit = useCallback(async () => {
    if (editingMessageId === null) return;
    const content = editDraft.trim();
    if (!content) return;
    setEditSaving(true);
    try {
      await editMessage(editingMessageId, content);
      setEditingMessageId(null);
      setEditDraft('');
    } catch (err) {
      console.error('Failed to edit message:', err);
    } finally {
      setEditSaving(false);
    }
  }, [editingMessageId, editDraft, editMessage]);

  const confirmDelete = useCallback(async () => {
    if (deleteTargetId === null) return;
    setDeleting(true);
    try {
      await deleteMessage(deleteTargetId);
      setDeleteTargetId(null);
    } catch (err) {
      console.error('Failed to delete message:', err);
    } finally {
      setDeleting(false);
    }
  }, [deleteTargetId, deleteMessage]);

  // Handle clicks on links (open external) and images (open viewer).
  // Image takes priority over a wrapping anchor: Zulip renders inline
  // images as <a href="/user_uploads/..."><img src="/user_uploads/..."></a>,
  // so a naive link-first check would either pop the system browser
  // (Electron prod, absolute href) or navigate the renderer away from the
  // app (dev, relative /zulip-api/...) — both wrong.
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.zulip-content')) return;

    const img = target.closest('img');
    if (img) {
      e.preventDefault();
      e.stopPropagation();
      // After the auth-loader effect runs, img.src holds the blob URL.
      // If the user clicks before that completes, fall back to the stashed
      // data-auth-src and fetch on demand.
      if (img.src && !img.src.startsWith('data:')) {
        setViewerImage(img.src);
      } else {
        const authSrc = img.getAttribute('data-auth-src');
        if (authSrc) {
          fetchAuthenticatedUrl(authSrc)
            .then((blobUrl) => setViewerImage(blobUrl))
            .catch(() => { /* ignore */ });
        }
      }
      return;
    }

    const anchor = target.closest('a');
    if (anchor) {
      const href = anchor.getAttribute('href');
      // Always preventDefault — a relative href would otherwise navigate
      // the whole renderer away from the app, even if we don't recognise
      // the scheme.
      e.preventDefault();
      if (!href) return;
      if (href.startsWith('http://') || href.startsWith('https://')) {
        const electronAPI = (window as { electronAPI?: { openExternal?: (url: string) => void } }).electronAPI;
        if (electronAPI?.openExternal) {
          electronAPI.openExternal(href);
        } else {
          window.open(href, '_blank', 'noopener,noreferrer');
        }
      }
      // Other schemes (mailto:, #narrow/...) are intentionally swallowed
      // for now — we can wire internal narrow navigation as a follow-up.
    }
  }, [fetchAuthenticatedUrl]);

  // Close reaction picker on click outside
  useEffect(() => {
    if (reactingMessageId === null) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (reactPickerRef.current && !reactPickerRef.current.contains(target)) {
        setReactingMessageId(null);
        setPickerPos(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [reactingMessageId]);

  const scrollToBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  }, []);

  const checkNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }, []);

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
    isNearBottom.current = true;
    scrollToBottom(hasScrolled.current);
    hasScrolled.current = true;
  }, [messages, scrollToBottom]);

  // Lazy loading: detect scroll to top + track near-bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    isNearBottom.current = checkNearBottom();

    if (!hasMoreMessages || loadingOlder) return;
    if (el.scrollTop < 100) {
      prevScrollHeight.current = el.scrollHeight;
      loadOlderMessages();
    }
  }, [hasMoreMessages, loadingOlder, loadOlderMessages, checkNearBottom]);

  // Mark messages as read
  useEffect(() => {
    const unread = messages
      .filter((m) => !(m.flags ?? []).includes('read'))
      .map((m) => m.id);
    if (unread.length > 0) {
      markMessagesAsRead(unread);
    }
  }, [messages, markMessagesAsRead]);

  // Rewrite relative URLs in HTML content to go through proxy.
  // For <img>, swap src for a placeholder and stash the real URL in data-auth-src
  // so the auth loader (below) can fetch with credentials. Critically, we must
  // MERGE the zulip-auth-img class into any existing class attribute — emitting
  // a second class="..." makes browsers ignore the second one, so the loader
  // selector `img.zulip-auth-img` wouldn't match emoji tags (which have class="emoji").
  const processContent = useCallback(
    (html: string): string => {
      // Step 1: convert Zulip's unicode-emoji spans to real characters.
      // Zulip renders `:smile:` as
      //   <span class="emoji emoji-1f604" role="img" title="...">:smile:</span>
      // relying on a CSS sheet that paints a background image from the
      // `emoji-XXXX` class. Without that sheet we'd just see the literal
      // `:smile:` text inside the span.
      let out = html.replace(
        /<span\b[^>]*\bclass="[^"]*\bemoji-([0-9a-f-]+)\b[^"]*"[^>]*>[^<]*<\/span>/gi,
        (match, codepoints: string) => {
          try {
            const chars = codepoints
              .split('-')
              .map((cp) => parseInt(cp, 16))
              .filter((n) => Number.isFinite(n));
            if (!chars.length) return match;
            return String.fromCodePoint(...chars);
          } catch {
            return match;
          }
        }
      );
      // Step 2: rewrite relative URLs on <img>/<a>. For <img>, swap src for a
      // 1x1 placeholder and stash the real URL in data-auth-src so the auth
      // loader fetches it with credentials. Merge zulip-auth-img into any
      // existing class attribute rather than emitting a duplicate class="...".
      out = out.replace(
        /(<(?:img|a)\b)([^>]*?)\s(?:src|href)="(\/[^"]+)"([^>]*?>)/g,
        (_match, tagOpen: string, beforeAttrs: string, url: string, after: string) => {
          const resolved = resolveUrl(url);
          if (tagOpen === '<img') {
            const attrs = beforeAttrs + after;
            const hasClass = /\sclass="([^"]*)"/.test(attrs);
            let newBeforeAttrs = beforeAttrs;
            let newAfter = after;
            if (hasClass) {
              const merge = (s: string) =>
                s.replace(/\sclass="([^"]*)"/, (_m, cls) => ` class="${cls} zulip-auth-img"`);
              newBeforeAttrs = merge(beforeAttrs);
              newAfter = merge(after);
            } else {
              newAfter = ` class="zulip-auth-img"${after}`;
            }
            const placeholder =
              'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            return `${tagOpen}${newBeforeAttrs} src="${placeholder}" data-auth-src="${url}"${newAfter}`;
          }
          return `${tagOpen}${beforeAttrs} href="${resolved}"${after}`;
        }
      );
      // Step 3: defence-in-depth sanitisation. Zulip's server-rendered HTML
      // is normally trusted, but a compromised or buggy server is the kind
      // of thing this client can't otherwise defend against — and a renderer
      // XSS would steal the API key out of localStorage. ALLOW data-auth-src
      // on <img> so our authenticated-image loader still works.
      return DOMPurify.sanitize(out, {
        ADD_ATTR: ['data-auth-src', 'target'],
        FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form'],
      });
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
      { emoji_name: string; emoji_code: string; reaction_type: string; count: number; userIds: number[] }
    > = {};
    for (const r of message.reactions) {
      if (!groups[r.emoji_name]) {
        groups[r.emoji_name] = {
          emoji_name: r.emoji_name,
          emoji_code: r.emoji_code,
          reaction_type: r.reaction_type,
          count: 0,
          userIds: [],
        };
      }
      groups[r.emoji_name].count++;
      groups[r.emoji_name].userIds.push(r.user_id);
    }
    return Object.values(groups);
  };

  // Build Zulip-style quote from a message
  const handleQuote = useCallback((message: ZulipMessage) => {
    if (!onQuote) return;
    // Extract text from HTML content
    const div = document.createElement('div');
    div.innerHTML = message.content;
    const text = div.textContent || div.innerText || '';
    onQuote(message.sender_full_name, text.trim());
  }, [onQuote]);

  // Render emoji: unicode emoji from codepoint, or custom emoji image
  const renderEmoji = (emojiName: string, emojiCode: string, reactionType: string) => {
    if (reactionType === 'realm_emoji') {
      // Look up the custom emoji source URL by ID
      const customEmoji = realmEmoji[emojiCode];
      if (customEmoji) {
        return (
          <img
            src={resolveUrl(customEmoji.source_url)}
            alt={`:${emojiName}:`}
            className="size-4 object-contain inline"
          />
        );
      }
      return `:${emojiName}:`;
    }
    try {
      const codePoints = emojiCode.split('-').map((cp) => parseInt(cp, 16));
      return String.fromCodePoint(...codePoints);
    } catch {
      return `:${emojiName}:`;
    }
  };

  // Pre-process all message content with URL rewriting + sanitization.
  // Cached by message id + content (so edits via update_message bust the
  // entry). Without this, every new event re-runs the full regex pass +
  // DOMPurify over every message in the thread — a 200-message view
  // would re-process all 200 on each incoming message.
  const renderCache = useRef<Map<number, { content: string; html: string }>>(new Map());
  // Bust the cache if processContent identity changes (e.g. login/logout
  // changes resolveUrl, which would invalidate every cached href/src).
  useEffect(() => { renderCache.current.clear(); }, [processContent]);

  const processedMessages = useMemo(
    () => {
      const cache = renderCache.current;
      const seenIds = new Set<number>();
      const out = messages.map((m) => {
        seenIds.add(m.id);
        const hit = cache.get(m.id);
        if (hit && hit.content === m.content) return { ...m, _html: hit.html };
        const html = processContent(m.content);
        cache.set(m.id, { content: m.content, html });
        return { ...m, _html: html };
      });
      // Drop entries for messages that left the view (e.g. narrow change)
      // so the cache doesn't grow unboundedly across long sessions.
      if (cache.size > seenIds.size + 100) {
        for (const id of cache.keys()) if (!seenIds.has(id)) cache.delete(id);
      }
      return out;
    },
    [messages, processContent]
  );

  // Load images with auth (Zulip requires auth for user_uploads/avatars)
  // Re-scroll to bottom after each image loads to prevent layout shift
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const imgs = el.querySelectorAll<HTMLImageElement>('img.zulip-auth-img');
    const unloadedImgs = Array.from(imgs).filter(
      (img) => !img.dataset.loaded
    );

    if (unloadedImgs.length === 0) return;

    unloadedImgs.forEach(async (img) => {
      const originalSrc = img.dataset.authSrc;
      if (!originalSrc) return;
      img.dataset.loaded = 'true';

      try {
        const blobUrl = await fetchAuthenticatedUrl(originalSrc);
        img.src = blobUrl;
      } catch {
        return;
      }

      // When the image actually renders, re-scroll if user was near bottom.
      img.onload = () => {
        if (isNearBottom.current) scrollToBottom(false);
      };
    });
  }, [processedMessages, fetchAuthenticatedUrl, scrollToBottom]);

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
                ? 'bg-brand-muted border-brand/50'
                : 'bg-surface-secondary hover:bg-surface-hover border-surface-hover'
            }`}
          >
            <span className="text-sm">
              {renderEmoji(rg.emoji_name, rg.emoji_code, rg.reaction_type)}
            </span>
            <span className="text-xs text-text-secondary">{rg.count}</span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <>
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      onClick={handleContentClick}
      className="flex-1 min-h-0 overflow-y-auto px-4"
    >
      {/* Loading older messages indicator */}
      {loadingOlder && (
        <div className="flex justify-center py-3">
          <Loader2 className="size-5 text-text-secondary animate-spin" />
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
              className="group relative hover:bg-surface-secondary -mx-2 px-2 py-0.5"
            >
              {/* Hover action buttons */}
              <div className="absolute right-2 top-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <div className="flex items-center gap-0.5 bg-surface-secondary border border-surface-hover rounded shadow-lg">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-text-secondary hover:text-text-primary hover:bg-surface-hover"
                          onClick={(e) => {
                            if (reactingMessageId === message.id) {
                              setReactingMessageId(null);
                              setPickerPos(null);
                            } else {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              const pickerHeight = 384; // h-96
                              // Position upward from the bottom of the button
                              let bottom = window.innerHeight - rect.top + 4;
                              // If picker would go above viewport, position downward instead
                              if (rect.top - pickerHeight < 8) {
                                bottom = window.innerHeight - rect.bottom - pickerHeight - 4;
                                // Clamp so picker stays on screen
                                if (bottom < 8) bottom = 8;
                              }
                              setPickerPos({
                                right: Math.max(8, window.innerWidth - rect.right),
                                bottom: Math.max(8, bottom),
                              });
                              setReactingMessageId(message.id);
                            }
                          }}
                        >
                          <SmilePlus className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>Add Reaction</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {onQuote && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-text-secondary hover:text-text-primary hover:bg-surface-hover"
                            onClick={() => handleQuote(message)}
                          >
                            <Quote className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent><p>Quote</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {currentUser && message.sender_id === currentUser.user_id && (
                    <>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-text-secondary hover:text-text-primary hover:bg-surface-hover"
                              onClick={() => startEdit(message.id)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Edit</p></TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-red-400 hover:text-red-300 hover:bg-surface-hover"
                              onClick={() => setDeleteTargetId(message.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Delete</p></TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </>
                  )}
                </div>
                {reactingMessageId === message.id && pickerPos && createPortal(
                  <div
                    ref={reactPickerRef}
                    className="fixed z-[100]"
                    style={{ right: pickerPos.right, bottom: pickerPos.bottom }}
                  >
                    <EmojiPicker
                      onSelect={() => {}}
                      onReact={(reaction) => {
                        addReaction(message.id, reaction.emojiName, reaction.emojiCode, reaction.reactionType);
                        setReactingMessageId(null);
                        setPickerPos(null);
                      }}
                    />
                  </div>,
                  document.body
                )}
              </div>
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
                      <span className="font-semibold text-text-primary text-sm">
                        {message.sender_full_name}
                      </span>
                      <span className="text-xs text-text-muted">
                        {formatTime(message.timestamp)}
                      </span>
                    </div>
                    {editingMessageId === message.id ? (
                      <div className="space-y-2">
                        <textarea
                          autoFocus
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(); }
                          }}
                          className="w-full bg-surface-tertiary text-text-primary text-sm rounded p-2 border border-surface-hover focus:border-brand outline-none font-mono resize-y min-h-[3rem]"
                        />
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={saveEdit} disabled={editSaving || !editDraft.trim()}>
                            {editSaving ? 'Saving…' : 'Save'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={editSaving}>
                            Cancel
                          </Button>
                          <span className="text-xs text-text-muted">
                            Ctrl+Enter to save, Esc to cancel
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="text-text-primary text-sm leading-relaxed break-words zulip-content"
                        dangerouslySetInnerHTML={{ __html: message._html }}
                      />
                    )}
                    {message.last_edit_timestamp && editingMessageId !== message.id && (
                      <span className="text-[10px] text-text-muted ml-1">(edited)</span>
                    )}
                    {renderReactions(message)}
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <div className="w-10 flex-shrink-0 flex items-center justify-end">
                    <span className="text-xs text-text-muted opacity-0 group-hover:opacity-100">
                      {format(new Date(message.timestamp * 1000), 'h:mm a')}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    {editingMessageId === message.id ? (
                      <div className="space-y-2">
                        <textarea
                          autoFocus
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(); }
                          }}
                          className="w-full bg-surface-tertiary text-text-primary text-sm rounded p-2 border border-surface-hover focus:border-brand outline-none font-mono resize-y min-h-[3rem]"
                        />
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={saveEdit} disabled={editSaving || !editDraft.trim()}>
                            {editSaving ? 'Saving…' : 'Save'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={editSaving}>
                            Cancel
                          </Button>
                          <span className="text-xs text-text-muted">
                            Ctrl+Enter to save, Esc to cancel
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="text-text-primary text-sm leading-relaxed break-words zulip-content"
                        dangerouslySetInnerHTML={{ __html: message._html }}
                      />
                    )}
                    {message.last_edit_timestamp && editingMessageId !== message.id && (
                      <span className="text-[10px] text-text-muted ml-1">(edited)</span>
                    )}
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

    {/* Image Viewer Modal */}
    {viewerImage && (
      <ImageViewer src={viewerImage} onClose={() => setViewerImage(null)} />
    )}

    {/* Delete confirmation */}
    <Dialog open={deleteTargetId !== null} onOpenChange={(o) => !o && setDeleteTargetId(null)}>
      <DialogContent className="bg-surface-secondary border-surface-tertiary text-text-primary sm:max-w-md">
        <DialogTitle>Delete message?</DialogTitle>
        <DialogDescription className="text-text-secondary">
          This permanently removes the message for everyone. This action can't be undone.
        </DialogDescription>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setDeleteTargetId(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

// ── Image Viewer with zoom & pan ──────────────────────
function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setScale((s) => Math.min(Math.max(0.25, s + delta), 8));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragging(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setTranslate((t) => ({ x: t.x + dx, y: t.y + dy }));
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Reset on double click
  const handleDoubleClick = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onWheel={handleWheel}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white text-3xl font-light z-10 size-10 flex items-center justify-center rounded-full hover:bg-white/10"
      >
        &times;
      </button>

      {/* Zoom indicator */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-sm bg-black/50 px-3 py-1 rounded-full">
        {Math.round(scale * 100)}% — Scroll to zoom, drag to pan, double-click to reset
      </div>

      {/* Image */}
      <img
        src={src}
        alt="Preview"
        className="max-w-[90vw] max-h-[90vh] object-contain select-none"
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          cursor: dragging ? 'grabbing' : 'grab',
          transition: dragging ? 'none' : 'transform 0.1s ease-out',
        }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        draggable={false}
      />
    </div>
  );
}
