import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { useZulip } from '../context/ZulipContext';
import { platform } from '../platform';
import type { ZulipMessage } from '../api/types';
import { format } from 'date-fns';
import { nameColor } from '../lib/zulipMarkdown';
import { ArrowDown, ChevronRight, Hash, Loader2, Pencil, Quote, SmilePlus, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Button } from './ui/button';
import { EmojiPicker } from './EmojiPicker';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';

interface MessageListProps {
  onQuote?: (message: ZulipMessage) => void;
  /** In-app targets for Zulip `#narrow/...` links inside messages. */
  /** `anchor` is the message a `/near/<id>` link points at, if any. */
  onNavigateToTopic?: (streamId: number, topicName: string, anchor?: number) => void;
  onNavigateToDm?: (userIds: number[], anchor?: number) => void;
  /** Compact: timestamp gutter, no avatars. Comfortable: avatars. */
  density?: 'compact' | 'comfortable';
  /**
   * For lists drawn from many conversations (Mentions, Starred): label each
   * run of messages with where it was posted.
   */
  showRecipients?: boolean;
  /** Opens a message's own conversation (recipient labels in mixed lists). */
  onOpenMessage?: (message: ZulipMessage) => void;
}

// Which conversation a message belongs to, for grouping in mixed lists.
function conversationKey(m: ZulipMessage): string {
  if (m.type === 'stream') return `s:${m.stream_id}:${m.subject.toLowerCase()}`;
  const ids = Array.isArray(m.display_recipient) ? m.display_recipient.map((r) => r.id) : [];
  return `p:${ids.sort((a, b) => a - b).join(',')}`;
}

// Inverse of Zulip's hash-component encoding (see encodeHashComponent).
function decodeHashComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\./g, '%'));
  } catch {
    return value;
  }
}

type NarrowTarget =
  | { kind: 'topic'; streamId: number; topic: string; near?: number }
  | { kind: 'dm'; userIds: number[]; near?: number };

// Parse the conversation a Zulip narrow link points at, e.g.
//   #narrow/channel/8-Customers/topic/Backups/near/123
//   #narrow/stream/8-Customers/topic/Backups        (pre-9.0 spelling)
//   #narrow/dm/10,12-group/near/456
// Returns null for anything we can't open in-app (channel-only, searches…).
function parseNarrowLink(href: string): NarrowTarget | null {
  const idx = href.indexOf('#narrow/');
  if (idx === -1) return null;
  const parts = href.slice(idx + '#narrow/'.length).split('/');
  const get = (op: string) => {
    const i = parts.indexOf(op);
    return i !== -1 && i + 1 < parts.length ? parts[i + 1] : undefined;
  };
  const nearRaw = get('near') ?? get('with');
  const nearId = nearRaw !== undefined ? parseInt(nearRaw, 10) : NaN;
  const near = Number.isFinite(nearId) ? nearId : undefined;
  const channel = get('channel') ?? get('stream');
  const topic = get('topic') ?? get('subject');
  if (channel && topic !== undefined) {
    const streamId = parseInt(channel, 10);
    if (Number.isFinite(streamId)) {
      return { kind: 'topic', streamId, topic: decodeHashComponent(topic), near };
    }
  }
  const dm = get('dm') ?? get('pm-with');
  if (dm) {
    const userIds = dm.split('-')[0].split(',').map((n) => parseInt(n, 10));
    if (userIds.length > 0 && userIds.every(Number.isFinite)) return { kind: 'dm', userIds, near };
  }
  return null;
}

function dayKey(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(timestamp) === dayKey(today.getTime() / 1000)) return 'Today';
  if (dayKey(timestamp) === dayKey(yesterday.getTime() / 1000)) return 'Yesterday';
  return format(d, d.getFullYear() === today.getFullYear() ? 'EEEE, MMMM d' : 'MMMM d, yyyy');
}

export function MessageList({
  onQuote,
  onNavigateToTopic,
  onNavigateToDm,
  density = 'compact',
  showRecipients = false,
  onOpenMessage,
}: MessageListProps = {}) {
  const compact = density === 'compact';
  const { users, subscriptions, messages, currentUser, markMessagesAsRead, addReaction, removeReaction, editMessage, deleteMessage, getMessageRaw, resolveUrl, fetchAuthenticatedUrl, loadOlderMessages, hasMoreMessages, loadingOlder, realmEmoji, serverUrl, hasNewerMessages, loadingNewer, loadNewerMessages, jumpToPresent, focusMessageId } = useZulip();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevScrollHeight = useRef(0);
  const isNearBottom = useRef(true);
  // Newest message id we've already auto-scrolled for. `null` means the list
  // is empty / we're painting a freshly-opened conversation.
  const lastMessageIdRef = useRef<number | null>(null);
  const [unreadBelow, setUnreadBelow] = useState(0);
  // Briefly highlighted after opening the view at a specific message.
  const [highlightId, setHighlightId] = useState<number | null>(null);
  // Set while a page of newer messages is being appended, so the auto-scroll
  // effect doesn't treat that page as fresh arrivals and yank to the bottom.
  const appendingNewerRef = useRef(false);
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

  // Flip a spoiler block open/closed, keeping the ARIA state in step with the
  // class the stylesheet keys off.
  const toggleSpoiler = useCallback((header: Element) => {
    const block = header.closest('.spoiler-block');
    if (!block) return;
    const open = block.classList.toggle('spoiler-open');
    header.setAttribute('aria-expanded', String(open));
    const content = block.querySelector('.spoiler-content');
    // Zulip ships aria-hidden="true" on the content; keep it truthful.
    if (content) content.setAttribute('aria-hidden', String(!open));
  }, []);

  // Enter/Space on a focused spoiler header, matching native <button>/<details>
  // behaviour. Space is preventDefault'd so it doesn't scroll the thread.
  const handleContentKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const header = (e.target as HTMLElement).closest?.('.spoiler-header');
    if (!header) return;
    e.preventDefault();
    toggleSpoiler(header);
  }, [toggleSpoiler]);

  // Handle clicks on links (open external) and images (open viewer).
  // Image takes priority over a wrapping anchor: Zulip renders inline
  // images as <a href="/user_uploads/..."><img src="/user_uploads/..."></a>,
  // so a naive link-first check would either pop the system browser
  // (Electron prod, absolute href) or navigate the renderer away from the
  // app (dev, relative /zulip-api/...) — both wrong.
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.zulip-content')) return;

    // Checked before images/links: a spoiler header can contain both, and
    // clicking it should always mean "toggle", not "open that thing".
    const spoilerHeader = target.closest('.spoiler-header');
    if (spoilerHeader) {
      e.preventDefault();
      toggleSpoiler(spoilerHeader);
      return;
    }

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
      // Links to another conversation on this server (channel/topic
      // mentions, quote "said" links) open here rather than in a browser.
      // Only for this server: a #narrow link to some other Zulip org
      // still belongs in the browser.
      const ownServer =
        href.startsWith('#') ||
        href.startsWith('/') ||
        href.startsWith(resolveUrl('/')) ||
        (!!serverUrl && href.startsWith(serverUrl.replace(/\/+$/, '') + '/'));
      const target = ownServer ? parseNarrowLink(href) : null;
      if (target?.kind === 'topic' && onNavigateToTopic) {
        onNavigateToTopic(target.streamId, target.topic, target.near);
        return;
      }
      if (target?.kind === 'dm' && onNavigateToDm && currentUser) {
        const ids = target.userIds.includes(currentUser.user_id)
          ? target.userIds
          : [...target.userIds, currentUser.user_id];
        onNavigateToDm(ids, target.near);
        return;
      }
      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        platform.openExternal(href).catch(() => {});
      }
    }
  }, [fetchAuthenticatedUrl, toggleSpoiler, onNavigateToTopic, onNavigateToDm, currentUser, resolveUrl, serverUrl]);

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

  // Auto-scroll policy. Previously this jumped to the bottom on EVERY change
  // to `messages`, so a message arriving while you were reading scrollback
  // ripped you back down to the newest one. Now we only follow along when the
  // reader is already parked at the bottom, when they sent the message
  // themselves, or on the first paint of a conversation.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (messages.length === 0) {
      lastMessageIdRef.current = null;
      setUnreadBelow(0);
      return;
    }

    // Restoring position after prepending older messages.
    if (prevScrollHeight.current > 0) {
      el.scrollTop = el.scrollHeight - prevScrollHeight.current;
      prevScrollHeight.current = 0;
      return;
    }

    const newest = messages[messages.length - 1];
    const isFirstPaint = lastMessageIdRef.current === null;
    const isNewArrival = !isFirstPaint && newest.id !== lastMessageIdRef.current;
    const sentByMe = !!currentUser && newest.sender_id === currentUser.user_id;
    lastMessageIdRef.current = newest.id;

    if (appendingNewerRef.current) {
      appendingNewerRef.current = false;
      return;
    }

    // Opened at a specific message: centre it rather than jumping to the end.
    if (isFirstPaint && focusMessageId !== null) {
      const target = el.querySelector(`[data-message-id="${focusMessageId}"]`);
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'instant' });
        isNearBottom.current = checkNearBottom();
        setHighlightId(focusMessageId);
        return;
      }
    }

    if (isFirstPaint || sentByMe || (isNewArrival && isNearBottom.current)) {
      scrollToBottom(!isFirstPaint);
      isNearBottom.current = true;
      setUnreadBelow(0);
    } else if (isNewArrival) {
      setUnreadBelow((n) => n + 1);
    }
  }, [messages, scrollToBottom, currentUser, focusMessageId, checkNearBottom]);

  useEffect(() => {
    if (highlightId === null) return;
    const t = window.setTimeout(() => setHighlightId(null), 2500);
    return () => window.clearTimeout(t);
  }, [highlightId]);

  // Lazy loading: detect scroll to top + track near-bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    isNearBottom.current = checkNearBottom();
    if (isNearBottom.current) setUnreadBelow(0);

    // Anchored view: page in newer messages as the reader nears the end.
    if (isNearBottom.current && hasNewerMessages && !loadingNewer) {
      appendingNewerRef.current = true;
      loadNewerMessages()
        .then((added) => { if (!added) appendingNewerRef.current = false; })
        .catch(() => { appendingNewerRef.current = false; });
    }

    if (!hasMoreMessages || loadingOlder) return;
    if (el.scrollTop < 100) {
      prevScrollHeight.current = el.scrollHeight;
      loadOlderMessages().then((added) => {
        // Nothing was prepended — drop the anchor so the next update isn't
        // interpreted as "restore the pre-prepend scroll position".
        if (!added) prevScrollHeight.current = 0;
      });
    }
  }, [hasMoreMessages, loadingOlder, loadOlderMessages, checkNearBottom, hasNewerMessages, loadingNewer, loadNewerMessages]);

  // Mark messages as read — but only while the app actually has focus.
  // Marking on arrival regardless of focus meant messages that landed while
  // you were in another app were already "read" when you came back, so the
  // unread badge never appeared. Ids we've submitted are remembered so a
  // slow round-trip can't cause the same batch to be POSTed repeatedly.
  const submittedReads = useRef<Set<number>>(new Set());
  useEffect(() => {
    const flush = () => {
      if (typeof document !== 'undefined' && !document.hasFocus()) return;
      const unread = messages
        .filter((m) => !(m.flags ?? []).includes('read') && !submittedReads.current.has(m.id))
        .map((m) => m.id);
      if (unread.length === 0) return;
      for (const id of unread) submittedReads.current.add(id);
      markMessagesAsRead(unread).catch(() => {
        for (const id of unread) submittedReads.current.delete(id);
      });
    };
    flush();
    window.addEventListener('focus', flush);
    return () => window.removeEventListener('focus', flush);
  }, [messages, markMessagesAsRead]);

  // Keep the submitted-ids set from growing without bound across a long
  // session: anything no longer in view can't be re-submitted anyway.
  useEffect(() => {
    if (submittedReads.current.size <= 500) return;
    const visible = new Set(messages.map((m) => m.id));
    for (const id of submittedReads.current) {
      if (!visible.has(id)) submittedReads.current.delete(id);
    }
  }, [messages]);

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
      // Step 2b: Zulip ships spoilers as an inert
      // `<div class="spoiler-block">` — the collapse/expand behaviour lives
      // in its own client's JavaScript, which we don't have. Without this the
      // block renders permanently open, which defeats the entire purpose of a
      // spoiler. Tag the header as a disclosure control so the click/keyboard
      // handlers below can drive it, and so screen readers announce it.
      out = out.replace(
        /<div\b(?![^>]*\brole=)([^>]*\bclass="[^"]*\bspoiler-header\b[^"]*"[^>]*)>/gi,
        '<div role="button" tabindex="0" aria-expanded="false"$1>'
      );

      // Step 3: defence-in-depth sanitisation. Zulip's server-rendered HTML
      // is normally trusted, but a compromised or buggy server is the kind
      // of thing this client can't otherwise defend against — and a renderer
      // XSS would steal the API key out of localStorage. ALLOW data-auth-src
      // on <img> so our authenticated-image loader still works.
      return DOMPurify.sanitize(out, {
        ADD_ATTR: ['data-auth-src', 'target', 'tabindex'],
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
    // Pass the code + type through: for custom emoji the name alone can be
    // ambiguous, and the server needs both to resolve them.
    const op = existing ? removeReaction : addReaction;
    const sample = existing ?? message.reactions.find((r) => r.emoji_name === emojiName);
    op(message.id, emojiName, sample?.emoji_code, sample?.reaction_type).catch((err) => {
      console.error('Failed to update reaction:', err);
    });
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

  // Hand the whole message up; the quote block is built from its raw markdown
  // (fetched on demand), not from the rendered HTML we happen to be showing.
  const handleQuote = useCallback((message: ZulipMessage) => {
    onQuote?.(message);
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
      <div className="flex gap-1 mt-1 mb-0.5 flex-wrap">
        {reactionGroups.map((rg) => (
          <button
            key={rg.emoji_name}
            onClick={() => handleReactionClick(message, rg.emoji_name)}
            title={`:${rg.emoji_name}:`}
            className={`flex items-center gap-1 h-[22px] border rounded-full px-2 cursor-pointer text-[12px] tabular-nums ${
              currentUser && rg.userIds.includes(currentUser.user_id)
                ? 'bg-brand-muted border-brand/45 text-text-link'
                : 'bg-transparent hover:bg-surface-hover border-line text-text-secondary'
            }`}
          >
            <span className="text-[13px] leading-none">
              {renderEmoji(rg.emoji_name, rg.emoji_code, rg.reaction_type)}
            </span>
            <span>{rg.count}</span>
          </button>
        ))}
      </div>
    );
  };

  // Message body, or the inline editor when this message is being edited.
  const renderBody = (message: (typeof processedMessages)[number]) => (
    <>
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
          className="text-text-primary text-[13px] leading-5 break-words zulip-content"
          dangerouslySetInnerHTML={{ __html: message._html }}
        />
      )}
      {message.last_edit_timestamp && editingMessageId !== message.id && (
        <span className="text-[10px] text-text-muted">(edited)</span>
      )}
      {renderReactions(message)}
    </>
  );

  return (
    <>
    <div className="relative flex-1 min-h-0 flex flex-col">
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      onClick={handleContentClick}
      onKeyDown={handleContentKeyDown}
      className="flex-1 min-h-0 overflow-y-auto"
    >
      {/* Loading older messages indicator */}
      {loadingOlder && (
        <div className="flex justify-center py-3">
          <Loader2 className="size-5 text-text-secondary animate-spin" />
        </div>
      )}

      <TooltipProvider>
      <div className="py-2">
        {processedMessages.map((message, idx) => {
          const prevMessage = idx > 0 ? processedMessages[idx - 1] : null;
          const newDay = !prevMessage || dayKey(prevMessage.timestamp) !== dayKey(message.timestamp);
          const newConversation =
            showRecipients && (!prevMessage || conversationKey(prevMessage) !== conversationKey(message));
          const showHeader =
            newDay ||
            newConversation ||
            !prevMessage ||
            prevMessage.sender_id !== message.sender_id ||
            message.timestamp - prevMessage.timestamp > 300;
          const mentionsMe = (message.flags ?? []).some(
            (f) => f === 'mentioned' || f === 'wildcard_mentioned'
          );
          const sender = users.find((u) => u.user_id === message.sender_id);
          const time = format(new Date(message.timestamp * 1000), 'h:mm a');

          return (
            <div key={message.id}>
            {newDay && (
              <div className={`flex items-center gap-3 pl-16 pr-6 ${idx === 0 ? 'mt-2' : 'mt-5'} mb-1`} role="separator">
                <span className="text-[11px] font-medium text-text-muted">
                  {dayLabel(message.timestamp)}
                </span>
                <div className="flex-1 border-t border-line" />
              </div>
            )}
            {newConversation && (
              <button
                onClick={() => onOpenMessage?.(message)}
                className={`flex items-center gap-1.5 ml-16 mr-6 ${newDay ? 'mt-1' : 'mt-4'} mb-0.5 text-[12px] text-text-secondary hover:text-text-primary`}
              >
                {message.type === 'stream' ? (
                  <>
                    <Hash
                      className="size-3"
                      style={{ color: subscriptions.find((s) => s.stream_id === message.stream_id)?.color }}
                    />
                    <span>
                      {typeof message.display_recipient === 'string' ? message.display_recipient : ''}
                    </span>
                    <ChevronRight className="size-3 text-text-muted" />
                    <span className="font-medium text-text-primary">{message.subject}</span>
                  </>
                ) : (
                  <span>
                    DM ·{' '}
                    {(Array.isArray(message.display_recipient) ? message.display_recipient : [])
                      .filter((r) => r.id !== currentUser?.user_id)
                      .map((r) => r.full_name)
                      .join(', ') || 'You'}
                  </span>
                )}
              </button>
            )}
            <div
              data-message-id={message.id}
              style={
                mentionsMe && highlightId !== message.id
                  ? { background: 'color-mix(in srgb, var(--brand) 7%, transparent)' }
                  : undefined
              }
              className={`group relative flex pr-6 transition-colors duration-700 ${
                highlightId === message.id ? 'bg-brand-muted' : 'hover:bg-surface-hover'
              } ${showHeader && !newDay && !newConversation && idx > 0 ? (compact ? 'mt-2' : 'mt-4') : ''} ${
                compact ? 'py-px' : 'py-0.5'
              }`}
            >
              {/* Hover action buttons */}
              <div className="absolute right-4 top-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-10">
                <div className="flex items-center gap-0.5 p-0.5 bg-surface-secondary border border-line rounded-md shadow-sm">
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
                  {onQuote && (
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
                  )}
                  {currentUser && message.sender_id === currentUser.user_id && (
                    <>
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
              {/* Gutter: timestamps (compact) or the avatar (comfortable). */}
              <div className="w-16 shrink-0 flex justify-end pr-3">
                {compact || !showHeader ? (
                  <span
                    className={`text-[11px] leading-5 text-text-muted tabular-nums whitespace-nowrap ${
                      compact ? '' : 'invisible group-hover:visible'
                    }`}
                    title={format(new Date(message.timestamp * 1000), 'PPPP p')}
                  >
                    {time}
                  </span>
                ) : (
                  <Avatar className="size-8 rounded-lg mt-0.5">
                    <AvatarImage src={resolveUrl(message.avatar_url)} alt="" />
                    <AvatarFallback className="rounded-lg text-xs font-semibold">
                      {message.sender_full_name[0]}
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
              <div className="flex-1 min-w-0">
                {showHeader && (
                  <div className="flex items-baseline gap-2 leading-5">
                    <span className="font-semibold text-[13px]" style={{ color: nameColor(message.sender_id) }}>
                      {message.sender_full_name}
                    </span>
                    {sender?.is_bot && (
                      <span className="text-[10px] leading-[15px] px-1 rounded border border-line text-text-muted self-center">
                        BOT
                      </span>
                    )}
                    {!compact && (
                      <span className="text-[11px] text-text-muted" title={format(new Date(message.timestamp * 1000), 'PPPP p')}>
                        {formatTime(message.timestamp)}
                      </span>
                    )}
                  </div>
                )}
                {renderBody(message)}
              </div>
            </div>
            </div>
          );
        })}
        {loadingNewer && (
          <div className="flex justify-center py-3">
            <Loader2 className="size-5 text-text-secondary animate-spin" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      </TooltipProvider>
    </div>

    {/* Jump to latest — shown when messages arrived while reading scrollback,
        so following the conversation never requires hunting for the bottom. */}
    {/* Viewing an older stretch (opened from search / a link): one click
        back to the live end of the conversation. */}
    {hasNewerMessages && (
      <button
        onClick={() => { jumpToPresent().catch(() => {}); }}
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-brand-hover"
      >
        <ArrowDown className="size-3.5" />
        Jump to present
      </button>
    )}
    {unreadBelow > 0 && !hasNewerMessages && (
      <button
        onClick={() => { scrollToBottom(true); isNearBottom.current = true; setUnreadBelow(0); }}
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-brand-hover"
      >
        <ArrowDown className="size-3.5" />
        {unreadBelow} new message{unreadBelow === 1 ? '' : 's'}
      </button>
    )}
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
