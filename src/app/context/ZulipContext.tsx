import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import { ZulipApi, ZulipApiError, isAuthError } from '../api/zulipApi';
import { htmlToText } from '../lib/zulipMarkdown';
import { platform } from '../platform';
import { loadCredentials, saveCredentials, clearCredentials } from '../api/credentialStore';
import type {
  ZulipUser,
  ZulipMessage,
  ZulipSubscription,
  ZulipTopic,
  ZulipNarrow,
  MessageEvent,
  ReactionEvent,
  PresenceEvent,
  UpdateMessageEvent,
  UpdateMessageFlagsEvent,
  DeleteMessageEvent,
  TypingEvent,
  SubscriptionEvent,
  UserStatusEvent,
  RegisterEventQueueResponse,
  TypingTarget,
} from '../api/types';

// ── Presence helpers ──────────────────────────────────
export type UserStatus = 'online' | 'idle' | 'offline';

interface PresenceMap {
  [userId: number]: { status: UserStatus; timestamp: number };
}

// ── DM conversation ───────────────────────────────────
// `userIds` is sorted ascending and INCLUDES the current user, matching
// Zulip's huddle convention (user_ids_string). Solo DM = [me, other].
// Self-DM = [me]. Group = [me, a, b, ...].
export interface DmConversation {
  userIds: number[];
  lastMessageTimestamp: number;
}

// Stable key for a DM/huddle conversation. Mirrors Zulip's user_ids_string.
export function dmKey(userIds: number[]): string {
  return userIds.slice().sort((a, b) => a - b).join(',');
}

// Union of two message lists by id, oldest first.
function mergeMessages(a: ZulipMessage[], b: ZulipMessage[]): ZulipMessage[] {
  const byId = new Map<number, ZulipMessage>();
  for (const m of a) byId.set(m.id, m);
  let added = false;
  for (const m of b) {
    if (!byId.has(m.id)) {
      byId.set(m.id, m);
      added = true;
    }
  }
  if (!added) return a;
  return Array.from(byId.values()).sort((x, y) => x.id - y.id);
}

// Which badge an unread message counts toward: a `${streamId}:${topic}` key
// in `unreadCounts.streams`, or a dmKey in `unreadCounts.pms`.
interface UnreadLoc {
  kind: 'streams' | 'pms';
  key: string;
}

// Zulip sends presence either as an `aggregated` roll-up or (in live events)
// as one entry per client. Collapse either form into a single status.
function aggregatePresence(
  presence: Record<string, { status: string; timestamp: number } | undefined> | undefined
): { status: UserStatus; timestamp: number } | null {
  if (!presence) return null;
  const agg = presence.aggregated;
  if (agg) {
    return {
      status: agg.status === 'active' ? 'online' : agg.status === 'idle' ? 'idle' : 'offline',
      timestamp: agg.timestamp,
    };
  }
  let best: { status: UserStatus; timestamp: number } | null = null;
  for (const entry of Object.values(presence)) {
    if (!entry || typeof entry.timestamp !== 'number') continue;
    const status: UserStatus = entry.status === 'active' ? 'online' : 'idle';
    if (
      !best ||
      (status === 'online' && best.status !== 'online') ||
      (status === best.status && entry.timestamp > best.timestamp)
    ) {
      best = { status, timestamp: entry.timestamp };
    }
  }
  return best;
}

// ── Context shape ─────────────────────────────────────
interface ZulipContextValue {
  api: ZulipApi | null;
  serverUrl: string;
  currentUser: ZulipUser | null;
  users: ZulipUser[];
  subscriptions: ZulipSubscription[];
  topics: Record<number, ZulipTopic[]>; // streamId → topics
  messages: ZulipMessage[];
  presence: PresenceMap;
  typingUsers: { userId: number; conversationKey: string; timestamp: number }[];
  unreadCounts: { streams: Record<string, number>; pms: Record<string, number> };
  dmConversations: DmConversation[];
  realmEmoji: Record<string, { name: string; source_url: string }>; // id → emoji info
  loading: boolean;
  loadingOlder: boolean;
  hasMoreMessages: boolean;
  /** True when the view was opened at an older message and there's more below it. */
  hasNewerMessages: boolean;
  loadingNewer: boolean;
  /** Message the current view was opened at (search result, link, notification). */
  focusMessageId: number | null;

  // actions
  login: (server: string, email: string, apiKey: string) => Promise<ZulipUser>;
  logout: () => void;
  /** Fetches (and stores) a channel's topics, newest first. */
  loadTopics: (streamId: number) => Promise<ZulipTopic[]>;
  /**
   * Leave the open conversation (Inbox and other non-message views). Without
   * this, live messages for the conversation left behind would still count
   * as "on screen" and never get an unread badge.
   */
  clearNarrow: () => void;
  /** Opens a narrow at its newest message, or centred on `anchor` if given. */
  loadMessages: (narrow: ZulipNarrow[], anchor?: number) => Promise<void>;
  /** Prepends older messages; resolves with how many were added. */
  loadOlderMessages: () => Promise<number>;
  /** Appends the next page below an anchored view; resolves with how many were added. */
  loadNewerMessages: () => Promise<number>;
  /** Reloads the current narrow at its newest message. */
  jumpToPresent: () => Promise<void>;
  /**
   * Registers what "open this message" means (notification clicks). The
   * context knows the message; only the app knows how to navigate to it.
   */
  setMessageOpener: (opener: ((message: ZulipMessage) => void) | null) => void;
  sendMessage: (params: {
    type: 'stream' | 'direct';
    to: string | number | number[];
    topic?: string;
    content: string;
  }) => Promise<void>;
  uploadFile: (file: File) => Promise<string>;
  addReaction: (messageId: number, emojiName: string, emojiCode?: string, reactionType?: string) => Promise<void>;
  removeReaction: (messageId: number, emojiName: string, emojiCode?: string, reactionType?: string) => Promise<void>;
  editMessage: (messageId: number, content: string) => Promise<void>;
  deleteMessage: (messageId: number) => Promise<void>;
  getMessageRaw: (messageId: number) => Promise<string>;
  markMessagesAsRead: (messageIds: number[]) => Promise<void>;
  sendTyping: (target: TypingTarget, op: 'start' | 'stop') => Promise<void>;
  searchMessages: (query: string, signal?: AbortSignal) => Promise<ZulipMessage[]>;
  getUserStatus: (userId: number) => UserStatus;
  userStatusText: string;
  userStatusEmoji: { name: string; code: string; type: string } | null;
  updateUserStatus: (params: {
    status_text?: string;
    away?: boolean;
    emoji_name?: string;
    emoji_code?: string;
    reaction_type?: string;
  }) => Promise<void>;
  muteStream: (streamId: number, mute: boolean) => Promise<void>;
  /** False while invisible mode is on (Zulip's `presence_enabled` setting). */
  presenceEnabled: boolean;
  setInvisible: (invisible: boolean) => Promise<void>;
  /** The realm's GIPHY key, or '' if the server doesn't configure one. */
  giphyApiKey: string;
  /** Organization display name ('' until the server answers). */
  realmName: string;
  /** The org's uploaded icon, or '' when it only has Zulip's Gravatar default. */
  realmIconUrl: string;
  /** Unread messages that mention you, for the Mentions badge. */
  unreadMentionCount: number;
  /** The newest unread message in each unread conversation (Inbox previews). */
  fetchInboxPreviews: () => Promise<ZulipMessage[]>;
  /**
   * Conversations holding an unread mention, as Inbox row keys:
   * `s:<streamId>:<topic lowercased>` or `p:<dmKey>`.
   */
  unreadMentionKeys: Set<string>;
  /**
   * Rename a whole topic (Zulip's "resolve" is a rename to a "✔ " prefix).
   * `messageId` is any message in the topic.
   */
  renameTopic: (messageId: number, newTopic: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  /** Set when cached credentials couldn't be used because the server was unreachable. */
  autoLoginError: string | null;
  /**
   * Null while the live event connection is healthy; otherwise the most
   * recent reason it isn't (registration rejected, network down, …).
   */
  connectionError: string | null;
  resolveUrl: (url: string) => string;
  fetchAuthenticatedUrl: (url: string) => Promise<string>;
}

const ZulipContext = createContext<ZulipContextValue | null>(null);

export function useZulip() {
  const ctx = useContext(ZulipContext);
  if (!ctx) throw new Error('useZulip must be used within ZulipProvider');
  return ctx;
}

// ── Provider ──────────────────────────────────────────
export function ZulipProvider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<ZulipApi | null>(null);
  const [serverUrl, setServerUrl] = useState<string>('');
  const [currentUser, setCurrentUser] = useState<ZulipUser | null>(null);
  const [users, setUsers] = useState<ZulipUser[]>([]);
  const [subscriptions, setSubscriptions] = useState<ZulipSubscription[]>([]);
  const [topics, setTopics] = useState<Record<number, ZulipTopic[]>>({});
  const [messages, setMessages] = useState<ZulipMessage[]>([]);
  const [presence, setPresence] = useState<PresenceMap>({});
  const [typingUsers, setTypingUsers] = useState<
    { userId: number; conversationKey: string; timestamp: number }[]
  >([]);
  const [unreadCounts, setUnreadCounts] = useState<{
    streams: Record<string, number>;
    pms: Record<string, number>;
  }>({ streams: {}, pms: {} });
  const [dmConversations, setDmConversations] = useState<DmConversation[]>([]);
  const [realmEmoji, setRealmEmoji] = useState<Record<string, { name: string; source_url: string }>>({});
  const [userStatusText, setUserStatusText] = useState('');
  const [userStatusEmoji, setUserStatusEmoji] = useState<{ name: string; code: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [hasNewerMessages, setHasNewerMessages] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [focusMessageId, setFocusMessageId] = useState<number | null>(null);
  // Mirrors hasNewerMessages for the event loop: while the view doesn't reach
  // the present, a live message can't be appended without leaving a gap.
  const hasNewerRef = useRef(false);
  useEffect(() => { hasNewerRef.current = hasNewerMessages; }, [hasNewerMessages]);
  const messageOpenerRef = useRef<((message: ZulipMessage) => void) | null>(null);
  const [autoLoginError, setAutoLoginError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [presenceEnabled, setPresenceEnabled] = useState(true);
  const [giphyApiKey, setGiphyApiKey] = useState('');
  const [realmName, setRealmName] = useState('');
  const [realmIconUrl, setRealmIconUrl] = useState('');
  const [unreadMentionCount, setUnreadMentionCount] = useState(0);
  const [unreadMentionKeys, setUnreadMentionKeys] = useState<Set<string>>(new Set());
  const featureLevelRef = useRef(0);
  const currentNarrowRef = useRef<ZulipNarrow[]>([]);

  // Bumped on every login/logout. Each event loop captures the value it
  // started with and exits as soon as it changes. A plain on/off flag let a
  // loop still parked in a 90s long-poll survive logout → login: the next
  // login flipped the flag back on and the old loop carried on with the
  // previous account's credentials, double-counting every event.
  const loopGenRef = useRef(0);
  // The in-flight /events long-poll, so it can be abandoned and retried.
  const pollAbortRef = useRef<AbortController | null>(null);
  const lastPollOkRef = useRef(Date.now());
  const queueIdRef = useRef<string | null>(null);
  const apiRef = useRef<ZulipApi | null>(null);
  const currentUserRef = useRef<ZulipUser | null>(null);
  const serverUrlRef = useRef<string>('');
  // Increments on every loadMessages call; used to bail stale responses.
  const loadNavTokenRef = useRef(0);
  // LRU of authenticated blob URLs; declared up-front so logout can revoke them.
  const blobCache = useRef<Map<string, string>>(new Map());
  const inflightBlobs = useRef<Map<string, Promise<string>>>(new Map());
  const BLOB_CACHE_MAX = 200;
  // Zulip is pull-based for presence: we ping every 60s to keep our own
  // presence fresh AND to receive updated peer presences in the response.
  const presencePingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Cache of user_id → email for fast lookup inside the event loop without
  // depending on the (potentially stale) `users` state captured by closures.
  const userEmailByIdRef = useRef<Map<number, string>>(new Map());
  // Timestamp of the last real user interaction. The presence ping used to
  // hard-code 'active', which meant you showed up green to the whole realm
  // even after the laptop had been shut for a day.
  const lastActivityRef = useRef<number>(Date.now());
  const IDLE_AFTER_MS = 5 * 60_000;

  useEffect(() => {
    const bump = () => { lastActivityRef.current = Date.now(); };
    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'wheel', 'focus'];
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    const onVisible = () => { if (document.visibilityState === 'visible') bump(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);
  useEffect(() => {
    serverUrlRef.current = serverUrl;
  }, [serverUrl]);

  // ── Unread tracking ───────────────────────────────────
  // Every unread message id we know about → the badge it counts toward.
  // `unreadCounts` is derived from this map rather than bumped up and down
  // independently, so reading on another device, deletions and topic moves
  // all land on the right badge instead of leaving stale counts behind.
  const unreadRef = useRef<Map<number, UnreadLoc>>(new Map());
  // Ids of messages that mention us. Only those still in unreadRef count, so
  // every path that marks something read clears its mention for free.
  const mentionIdsRef = useRef<Set<number>>(new Set());

  const publishUnread = useCallback(() => {
    const streams: Record<string, number> = {};
    const pms: Record<string, number> = {};
    for (const { kind, key } of unreadRef.current.values()) {
      const bucket = kind === 'streams' ? streams : pms;
      bucket[key] = (bucket[key] || 0) + 1;
    }
    setUnreadCounts({ streams, pms });
    const mentionKeys = new Set<string>();
    for (const id of mentionIdsRef.current) {
      const loc = unreadRef.current.get(id);
      if (!loc) {
        mentionIdsRef.current.delete(id);
        continue;
      }
      mentionKeys.add(loc.kind === 'streams' ? `s:${loc.key.toLowerCase()}` : `p:${loc.key}`);
    }
    setUnreadMentionCount(mentionIdsRef.current.size);
    setUnreadMentionKeys(mentionKeys);
  }, []);

  const forgetUnread = useCallback(
    (ids: Iterable<number>) => {
      let changed = false;
      for (const id of ids) changed = unreadRef.current.delete(id) || changed;
      if (changed) publishUnread();
    },
    [publishUnread]
  );

  // Topic names are case-insensitive on the server, so match keys that way.
  const clearUnreadKey = useCallback(
    (kind: UnreadLoc['kind'], key: string) => {
      const target = key.toLowerCase();
      let changed = false;
      for (const [id, loc] of unreadRef.current) {
        if (loc.kind === kind && loc.key.toLowerCase() === target) {
          unreadRef.current.delete(id);
          changed = true;
        }
      }
      if (changed) publishUnread();
    },
    [publishUnread]
  );

  // ── Event loop ────────────────────────────────────────
  // Everything we read out of a /register response: unread state, our own
  // status, the invisible-mode setting and the realm's GIPHY key.
  const applyRegisterState = useCallback(
    (reg: RegisterEventQueueResponse, myIdHint?: number) => {
      const myId = myIdHint ?? currentUserRef.current?.user_id;
      if (reg.unread_msgs) {
        const map = new Map<number, UnreadLoc>();
        for (const s of reg.unread_msgs.streams) {
          const key = `${s.stream_id}:${s.topic}`;
          for (const id of s.unread_message_ids) map.set(id, { kind: 'streams', key });
        }
        // Solo DMs: Zulip keys by sender_id; we key by sorted [me, sender].
        for (const pm of reg.unread_msgs.pms) {
          const key = dmKey(myId !== undefined ? [myId, pm.sender_id] : [pm.sender_id]);
          for (const id of pm.unread_message_ids) map.set(id, { kind: 'pms', key });
        }
        // Group DMs: Zulip already provides a sorted user_ids_string.
        for (const h of reg.unread_msgs.huddles ?? []) {
          for (const id of h.unread_message_ids) {
            map.set(id, { kind: 'pms', key: h.user_ids_string });
          }
        }
        unreadRef.current = map;
        mentionIdsRef.current = new Set(reg.unread_msgs.mentions ?? []);
        publishUnread();
      }
      const mine = myId !== undefined ? reg.user_status?.[String(myId)] : undefined;
      setUserStatusText(mine?.status_text ?? '');
      setUserStatusEmoji(
        mine?.emoji_name
          ? {
              name: mine.emoji_name,
              code: mine.emoji_code ?? '',
              type: mine.reaction_type ?? 'unicode_emoji',
            }
          : null
      );
      const enabled = reg.user_settings?.presence_enabled ?? reg.presence_enabled;
      if (typeof enabled === 'boolean') setPresenceEnabled(enabled);
      setGiphyApiKey(reg.giphy_api_key ?? '');
      if (reg.realm_name) setRealmName(reg.realm_name);
      if (typeof reg.zulip_feature_level === 'number') featureLevelRef.current = reg.zulip_feature_level;
      if (reg.realm_icon_url !== undefined) {
        setRealmIconUrl(reg.realm_icon_source === 'U' ? reg.realm_icon_url : '');
      }
    },
    [publishUnread]
  );

  const startEventLoop = useCallback(
    async (zApi: ZulipApi, myId?: number) => {
      const gen = loopGenRef.current;
      const alive = () => loopGenRef.current === gen;
      // Resolve a Zulip-relative URL to something fetchable in this runtime.
      const resolveUrlFn = (url: string) => platform.assetUrl(serverUrlRef.current, url);

      try {
        // Keep trying to register: a server blip right at login used to
        // leave the app with no event loop at all — no new messages, ever,
        // until restart.
        let reg: RegisterEventQueueResponse | null = null;
        for (let attempt = 0; !reg; attempt++) {
          try {
            reg = await zApi.registerEventQueue();
          } catch (err) {
            if (!alive()) return;
            console.warn('Event queue registration failed; retrying', err);
            setConnectionError(err instanceof Error ? err.message : String(err));
            await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * 2 ** attempt)));
            if (!alive()) return;
          }
        }
        if (!alive()) {
          zApi.deleteEventQueue(reg.queue_id).catch(() => {});
          return;
        }
        setConnectionError(null);
        queueIdRef.current = reg.queue_id;
        let lastEventId = reg.last_event_id;
        applyRegisterState(reg, myId);

        while (alive()) {
          // Each poll gets a deadline. Zulip answers a long-poll within ~60s
          // even when idle (heartbeat), so 90s of silence means the
          // connection died under us (sleep, Wi-Fi change) without ever
          // erroring — and without this the loop would wait on it forever.
          const poll = new AbortController();
          pollAbortRef.current = poll;
          const deadline = setTimeout(() => poll.abort(), 90_000);
          try {
            const eventsRes = await zApi.getEvents(
              reg.queue_id,
              lastEventId,
              poll.signal
            );
            lastPollOkRef.current = Date.now();
            setConnectionError(null);
            if (!alive()) break;
            for (const event of eventsRes.events) {
              try {
                lastEventId = event.id;

                switch (event.type) {
                case 'message': {
                  const me = event as MessageEvent;
                  const myId = currentUserRef.current?.user_id;
                  const myEmail = currentUserRef.current?.email;
                  // Only add to message list if it matches the current narrow.
                  // Empty narrow = match nothing (no view open).
                  const narrow = currentNarrowRef.current;
                  let matchesNarrow = false;
                  if (narrow.length > 0) {
                    const msg = me.message;
                    matchesNarrow = narrow.every((n) => {
                      switch (n.operator) {
                        case 'stream':
                        case 'channel':
                          // Operand may be either a stream name (string) or stream id (number),
                          // depending on how the narrow was constructed. Match on both so topics
                          // selected by id still receive live updates.
                          if (msg.type !== 'stream') return false;
                          if (typeof n.operand === 'number') return msg.stream_id === n.operand;
                          return msg.display_recipient === n.operand;
                        case 'topic':
                        case 'subject':
                          // Topic names are case-insensitive on the Zulip server,
                          // so a strict === would silently drop live messages
                          // whose subject differs only in case.
                          return String(msg.subject).toLowerCase()
                            === String(n.operand).toLowerCase();
                        case 'dm':
                        case 'pm-with': {
                          // Compare the recipient set of the incoming message with the
                          // narrow's recipient set. A DM narrow in Zulip specifies the
                          // OTHER party's email(s); the message's display_recipient
                          // always INCLUDES the current user. So we strip the current
                          // user's email from the message side before comparing.
                          // Using substring matching here caused a privacy bug: a
                          // self-DM narrow (just your own email) matched any DM whose
                          // participant list contained you.
                          if (msg.type !== 'private') return false;
                          if (!Array.isArray(msg.display_recipient)) return false;
                          // Strict set equality on emails. Narrow operand is the
                          // OTHER party (or comma-separated others); always
                          // include current user in the expected set.
                          const msgEmails = (msg.display_recipient as { email: string }[])
                            .map((r) => r.email.toLowerCase())
                            .sort();
                          const others = String(n.operand)
                            .split(',')
                            .map((e) => e.trim().toLowerCase())
                            .filter(Boolean);
                          const expected = myEmail
                            ? Array.from(new Set([myEmail.toLowerCase(), ...others])).sort()
                            : others.slice().sort();
                          if (msgEmails.length !== expected.length) return false;
                          return msgEmails.every((e, i) => e === expected[i]);
                        }
                        case 'is':
                          if (n.operand === 'dm' || n.operand === 'private') return msg.type === 'private';
                          if (n.operand === 'mentioned') {
                            return Array.isArray(me.flags)
                              && me.flags.some((f) => f === 'mentioned' || f === 'wildcard_mentioned');
                          }
                          if (n.operand === 'starred') {
                            return Array.isArray(me.flags) && me.flags.includes('starred');
                          }
                          if (n.operand === 'unread') {
                            return Array.isArray(me.flags) && !me.flags.includes('read');
                          }
                          // Unknown is:* operand — fail closed so we don't
                          // append messages to a view that didn't ask for them.
                          return false;
                        default:
                          // Unknown narrow operator — fail closed for safety.
                          return false;
                      }
                    });
                  }
                  // A view opened at an older message doesn't reach the
                  // present yet; appending would leave a gap, so the message
                  // is treated as off-screen (unread, notifiable) instead.
                  const shownLive = matchesNarrow && !hasNewerRef.current;
                  if (shownLive) {
                    setMessages((prev) => {
                      if (prev.some((m) => m.id === me.message.id)) return prev;
                      return [...prev, me.message];
                    });
                  }
                  // Always update unread counts for messages not in current view.
                  // (The matched-narrow case is read-marked by MessageList.)
                  const msg = me.message;
                  const alreadyRead = Array.isArray(me.flags) && me.flags.includes('read');
                  if (!shownLive && msg.sender_id !== myId && !alreadyRead) {
                    if (me.flags?.some((f) => f === 'mentioned' || f === 'wildcard_mentioned')) {
                      mentionIdsRef.current.add(msg.id);
                    }
                    if (msg.type === 'stream' && typeof msg.stream_id === 'number') {
                      unreadRef.current.set(msg.id, {
                        kind: 'streams',
                        key: `${msg.stream_id}:${msg.subject}`,
                      });
                      publishUnread();
                    } else if (msg.type === 'private' && Array.isArray(msg.display_recipient)) {
                      const ids = (msg.display_recipient as { id: number }[]).map((r) => r.id);
                      // Ensure self is represented even if Zulip omits us.
                      if (myId !== undefined && !ids.includes(myId)) ids.push(myId);
                      unreadRef.current.set(msg.id, { kind: 'pms', key: dmKey(ids) });
                      publishUnread();
                    }
                  }
                  // Desktop notification for DMs and @-mentions from other users.
                  // Notify when not the sender AND (it's a DM OR we were mentioned)
                  // AND the user is NOT actively looking at this conversation right
                  // now. The "actively looking" gate is window-focused + tab-visible
                  // + the message matches the open narrow — without it, every reply
                  // in an open thread spams an OS toast.
                  // Prefer Electron's native main-process notification (more reliable
                  // on Windows than web Notification); fall back to web API.
                  {
                    const isFromMe = msg.sender_id === myId;
                    const isMentioned = Array.isArray(me.flags) && me.flags.some((f) => f === 'mentioned' || f === 'wildcard_mentioned');
                    const isDM = msg.type === 'private';
                    const focused = typeof document !== 'undefined'
                      && document.hasFocus()
                      && document.visibilityState === 'visible';
                    const userIsLookingAtThis = focused && shownLive;
                    if (!isFromMe && (isDM || isMentioned) && !userIsLookingAtThis) {
                      const text = htmlToText(msg.content).slice(0, 200) || '(sent an attachment)';
                      const title = isDM
                        ? msg.sender_full_name
                        : `${msg.sender_full_name} (#${typeof msg.display_recipient === 'string' ? msg.display_recipient : ''} > ${msg.subject})`;
                      const icon = resolveUrlFn(msg.avatar_url);
                      platform
                        .notify({
                          title,
                          body: text,
                          icon,
                          tag: `zulip-${msg.id}`,
                          onClick: () => messageOpenerRef.current?.(msg),
                        })
                        .catch(() => {});
                    }
                  }
                  // Bump the DM/huddle conversation to the top of the list.
                  if (
                    me.message.type === 'private' &&
                    Array.isArray(me.message.display_recipient) &&
                    myId !== undefined
                  ) {
                    const recipients = me.message.display_recipient as { id: number }[];
                    const ids = recipients.map((r) => r.id);
                    if (!ids.includes(myId)) ids.push(myId);
                    const sortedIds = ids.slice().sort((a, b) => a - b);
                    const targetKey = dmKey(sortedIds);
                    setDmConversations((prev) => {
                      const filtered = prev.filter((d) => dmKey(d.userIds) !== targetKey);
                      return [
                        { userIds: sortedIds, lastMessageTimestamp: me.message.timestamp },
                        ...filtered,
                      ];
                    });
                  }
                  // Bump topic to top of its stream's topic list on new stream message
                  if (me.message.type === 'stream' && me.message.stream_id != null) {
                    const sid = me.message.stream_id;
                    const topicName = me.message.subject;
                    setTopics((prev) => {
                      const list = prev[sid] || [];
                      const filtered = list.filter((t) => t.name !== topicName);
                      return {
                        ...prev,
                        [sid]: [{ name: topicName, max_id: me.message.id }, ...filtered],
                      };
                    });
                  }
                  break;
                }
                case 'update_message': {
                  const ue = event as UpdateMessageEvent;
                  // Zulip sends BOTH `content` (raw markdown) and
                  // `rendered_content` (HTML) on a content edit. MessageList
                  // renders `content` as HTML, so we must take rendered_content
                  // — taking raw markdown made every edited message display
                  // literal `**bold**` / `[text](url)` until reload.
                  const isContentEdit =
                    typeof ue.rendered_content === 'string' || typeof ue.content === 'string';
                  const newContent = ue.rendered_content ?? ue.content;
                  // A topic/stream move applies to EVERY id in `message_ids`;
                  // `message_id` alone only covers the message that was edited.
                  const movedIds = new Set(
                    Array.isArray(ue.message_ids) && ue.message_ids.length > 0
                      ? ue.message_ids
                      : [ue.message_id]
                  );
                  const isMove =
                    typeof ue.subject === 'string' || typeof ue.new_stream_id === 'number';
                  if (isMove) {
                    // Re-home any unread moved messages onto their new topic's badge.
                    let changed = false;
                    for (const id of movedIds) {
                      const loc = unreadRef.current.get(id);
                      if (!loc || loc.kind !== 'streams') continue;
                      const sep = loc.key.indexOf(':');
                      const sid = ue.new_stream_id ?? Number(loc.key.slice(0, sep));
                      const topic = ue.subject ?? loc.key.slice(sep + 1);
                      unreadRef.current.set(id, { kind: 'streams', key: `${sid}:${topic}` });
                      changed = true;
                    }
                    if (changed) publishUnread();
                  }
                  setMessages((prev) => {
                    const next = prev.map((m) => {
                      const edited = m.id === ue.message_id && isContentEdit;
                      const moved = movedIds.has(m.id) && isMove;
                      if (!edited && !moved) return m;
                      const out = { ...m };
                      if (edited && newContent !== undefined) {
                        out.content = newContent;
                        // Only a real content edit gets the "(edited)"
                        // marker — not a topic move, and not the server
                        // re-rendering to attach a link preview.
                        if (!ue.rendering_only) out.last_edit_timestamp = ue.edit_timestamp;
                      }
                      if (moved) {
                        if (typeof ue.subject === 'string') out.subject = ue.subject;
                        if (typeof ue.new_stream_id === 'number') out.stream_id = ue.new_stream_id;
                      }
                      return out;
                    });
                    // Messages moved out of the narrow we're looking at should
                    // leave the view rather than linger under the old topic.
                    const narrow = currentNarrowRef.current;
                    if (!isMove || narrow.length === 0) return next;
                    const topicOp = narrow.find(
                      (n) => n.operator === 'topic' || n.operator === 'subject'
                    );
                    const streamOp = narrow.find(
                      (n) => n.operator === 'stream' || n.operator === 'channel'
                    );
                    if (!topicOp && !streamOp) return next;
                    return next.filter((m) => {
                      if (!movedIds.has(m.id)) return true;
                      if (
                        topicOp &&
                        String(m.subject).toLowerCase() !== String(topicOp.operand).toLowerCase()
                      ) {
                        return false;
                      }
                      if (
                        streamOp &&
                        typeof streamOp.operand === 'number' &&
                        m.stream_id !== streamOp.operand
                      ) {
                        return false;
                      }
                      return true;
                    });
                  });
                  break;
                }
                case 'delete_message': {
                  const de = event as DeleteMessageEvent;
                  const deleted = new Set(
                    de.message_ids ?? (typeof de.message_id === 'number' ? [de.message_id] : [])
                  );
                  if (deleted.size === 0) break;
                  setMessages((prev) => prev.filter((m) => !deleted.has(m.id)));
                  forgetUnread(deleted);
                  break;
                }
                case 'reaction': {
                  const re = event as ReactionEvent;
                  setMessages((prev) =>
                    prev.map((m) => {
                      if (m.id !== re.message_id) return m;
                      if (re.op === 'add') {
                        // A re-registered event queue can replay reactions we
                        // already have; without this guard the count doubles.
                        if (
                          m.reactions.some(
                            (r) => r.user_id === re.user_id && r.emoji_name === re.emoji_name
                          )
                        ) {
                          return m;
                        }
                        return {
                          ...m,
                          reactions: [
                            ...m.reactions,
                            {
                              emoji_name: re.emoji_name,
                              emoji_code: re.emoji_code,
                              reaction_type: re.reaction_type,
                              user_id: re.user_id,
                              user: re.user,
                            },
                          ],
                        };
                      } else {
                        return {
                          ...m,
                          reactions: m.reactions.filter(
                            (r) =>
                              !(
                                r.emoji_name === re.emoji_name &&
                                r.user_id === re.user_id
                              )
                          ),
                        };
                      }
                    })
                  );
                  break;
                }
                case 'presence': {
                  // Live presence events carry one entry per client and
                  // usually no `aggregated` key — only reading `aggregated`
                  // meant these were all dropped and presence only moved
                  // on the 60s ping.
                  const pe = event as PresenceEvent;
                  const next = aggregatePresence(pe.presence);
                  if (next) {
                    setPresence((prev) => ({ ...prev, [pe.user_id]: next }));
                  }
                  break;
                }
                case 'typing': {
                  const te = event as TypingEvent;
                  const myTypingId = currentUserRef.current?.user_id;
                  // Never show yourself as typing — even when typing from
                  // another device, the same account triggers the event.
                  if (te.sender.user_id === myTypingId) break;

                  // Build a stable conversation key from the typing event so
                  // the indicator only renders when the user is in that exact
                  // conversation.
                  let conversationKey: string | null = null;
                  if (te.message_type === 'private') {
                    const ids = te.recipients.map((r) => r.user_id);
                    if (!ids.includes(te.sender.user_id)) ids.push(te.sender.user_id);
                    if (myTypingId !== undefined && !ids.includes(myTypingId)) {
                      ids.push(myTypingId);
                    }
                    conversationKey = `dm:${dmKey(ids)}`;
                  } else if (
                    te.message_type === 'stream' &&
                    typeof te.stream_id === 'number' &&
                    typeof te.topic === 'string'
                  ) {
                    conversationKey = `stream:${te.stream_id}:${te.topic}`;
                  }
                  if (!conversationKey) break;
                  const ck = conversationKey;

                  if (te.op === 'start') {
                    setTypingUsers((prev) => {
                      // A repeated 'start' (clients re-send while typing)
                      // refreshes the timestamp so the 15s expiry below
                      // doesn't hide someone who's still typing.
                      if (
                        prev.some(
                          (t) => t.userId === te.sender.user_id && t.conversationKey === ck
                        )
                      ) {
                        return prev.map((t) =>
                          t.userId === te.sender.user_id && t.conversationKey === ck
                            ? { ...t, timestamp: Date.now() }
                            : t
                        );
                      }
                      return [
                        ...prev,
                        {
                          userId: te.sender.user_id,
                          conversationKey: ck,
                          timestamp: Date.now(),
                        },
                      ];
                    });
                  } else {
                    setTypingUsers((prev) =>
                      prev.filter(
                        (t) => !(t.userId === te.sender.user_id && t.conversationKey === ck)
                      )
                    );
                  }
                  break;
                }
                case 'update_message_flags': {
                  // Read/starred state changed — usually because the same
                  // account acted from another device. We register for this
                  // event type but previously dropped it on the floor, so
                  // reading a thread on mobile left it bold here.
                  const fe = event as UpdateMessageFlagsEvent;
                  if (fe.flag === 'read') {
                    if (fe.op === 'add' && fe.all) {
                      unreadRef.current.clear();
                      publishUnread();
                    } else if (fe.op === 'add') {
                      forgetUnread(fe.messages ?? []);
                    } else {
                      // Marked unread (here or elsewhere): put the badge back.
                      const myFlagsId = currentUserRef.current?.user_id;
                      for (const id of fe.messages ?? []) {
                        const d = fe.message_details?.[String(id)];
                        if (!d) continue;
                        if (d.mentioned) mentionIdsRef.current.add(id);
                        if (d.type === 'stream' && typeof d.stream_id === 'number') {
                          unreadRef.current.set(id, {
                            kind: 'streams',
                            key: `${d.stream_id}:${d.topic ?? ''}`,
                          });
                        } else if (d.type === 'private') {
                          const ids = (d.user_ids ?? []).slice();
                          if (myFlagsId !== undefined && !ids.includes(myFlagsId)) ids.push(myFlagsId);
                          unreadRef.current.set(id, { kind: 'pms', key: dmKey(ids) });
                        }
                      }
                      publishUnread();
                    }
                  }
                  if (!Array.isArray(fe.messages) || fe.messages.length === 0) break;
                  const flagIds = new Set(fe.messages);
                  setMessages((prev) =>
                    prev.map((m) => {
                      if (!flagIds.has(m.id)) return m;
                      const flags = new Set(m.flags ?? []);
                      if (fe.op === 'add') flags.add(fe.flag);
                      else flags.delete(fe.flag);
                      return { ...m, flags: Array.from(flags) };
                    })
                  );
                  break;
                }
                case 'subscription': {
                  // Reload subscriptions on changes. peer_add/peer_remove are
                  // other people joining/leaving and don't change our list.
                  const op = (event as SubscriptionEvent).op;
                  if (op === 'peer_add' || op === 'peer_remove') break;
                  // Not awaited: a slow refetch mustn't stall event delivery.
                  zApi
                    .getSubscriptions()
                    .then((subsRes) => { if (alive()) setSubscriptions(subsRes.subscriptions); })
                    .catch((err) => console.warn('Subscription refresh failed', err));
                  break;
                }
                case 'user_status': {
                  // Our own status changed (possibly from another device).
                  const se = event as UserStatusEvent;
                  if (se.user_id !== currentUserRef.current?.user_id) break;
                  if (typeof se.status_text === 'string') setUserStatusText(se.status_text);
                  if (typeof se.emoji_name === 'string') {
                    setUserStatusEmoji(
                      se.emoji_name
                        ? {
                            name: se.emoji_name,
                            code: se.emoji_code ?? '',
                            type: se.reaction_type ?? 'unicode_emoji',
                          }
                        : null
                    );
                  }
                  break;
                }
                }
              } catch (handlerErr) {
                // Don't let one bad event halt the whole batch / loop.
                console.error('Event handler error', event, handlerErr);
              }
            }
          } catch (err: unknown) {
            if (!alive()) break;
            // Deadline hit or deliberately kicked: poll again straight away.
            if (poll.signal.aborted) continue;
            // If the queue expired (e.g. after a long sleep / network blip),
            // re-register and continue. Otherwise back off and retry.
            const msg = err instanceof Error ? err.message : String(err ?? '');
            setConnectionError(msg || 'Connection lost');
            const isBadQueue =
              (err instanceof ZulipApiError && err.code === 'BAD_EVENT_QUEUE_ID') ||
              /Bad event queue id/i.test(msg) ||
              /queue.*not.*found/i.test(msg);
            if (isBadQueue) {
              try {
                reg = await zApi.registerEventQueue();
                if (!alive()) {
                  zApi.deleteEventQueue(reg.queue_id).catch(() => {});
                  break;
                }
                queueIdRef.current = reg.queue_id;
                lastEventId = reg.last_event_id;
                // Prefer the live ref over the captured `myId` argument:
                // on a re-register after a network blip the original arg may
                // be stale (e.g. undefined if login raced the first call).
                applyRegisterState(reg, currentUserRef.current?.user_id ?? myId);
                // Anything sent while the old queue was dead never reached
                // us as an event, so the open conversation would silently
                // be missing those messages. Pull them in.
                const narrow = currentNarrowRef.current;
                const navToken = loadNavTokenRef.current;
                if (narrow.length > 0 && !hasNewerRef.current) {
                  zApi
                    .getMessages({ narrow, num_before: 50, num_after: 0 })
                    .then((res) => {
                      if (!alive() || loadNavTokenRef.current !== navToken) return;
                      setMessages((prev) => mergeMessages(prev, res.messages));
                    })
                    .catch(() => {});
                }
                continue;
              } catch (reRegErr) {
                console.error('Failed to re-register event queue', reRegErr);
                setConnectionError(reRegErr instanceof Error ? reRegErr.message : String(reRegErr));
              }
            }
            await new Promise((r) => setTimeout(r, 5000));
          } finally {
            clearTimeout(deadline);
          }
        }
      } catch (err) {
        console.error('Failed to start event queue:', err);
      }
    },
    [applyRegisterState, publishUnread, forgetUnread]
  );

  // Abandon the current long-poll and immediately start a fresh one. Used
  // when there's reason to think the connection went stale quietly.
  const kickEventLoop = useCallback(() => {
    pollAbortRef.current?.abort();
  }, []);

  // Coming back online, or back to the window after the poll has been quiet
  // longer than its own deadline (the machine slept, timers didn't run):
  // reconnect now instead of waiting out a dead socket.
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastPollOkRef.current > 100_000) kickEventLoop();
    };
    window.addEventListener('online', kickEventLoop);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('online', kickEventLoop);
      window.removeEventListener('focus', onFocus);
    };
  }, [kickEventLoop]);

  // Clean up typing indicators that are stale (>15s)
  useEffect(() => {
    const interval = setInterval(() => {
      setTypingUsers((prev) =>
        prev.filter((t) => Date.now() - t.timestamp < 15000)
      );
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // ── Auto-login from cached credentials ────────────────
  const autoLoginAttempted = useRef(false);

  // ── Actions ───────────────────────────────────────────
  const loginInner = useCallback(
    async (server: string, email: string, apiKey: string) => {
      const zApi = new ZulipApi(server, email, apiKey);

      // Validate credentials
      const profile = await zApi.getProfile();

      // Tell the shell which origin to scope any origin-specific handling to.
      // Under Electron this narrows the CORS header rewrites to this one host,
      // so third-party fetches (image CDNs, GIPHY, …) stop getting
      // force-allowed CORS responses.
      platform.setServerOrigin(server).catch(() => {});

      platform.requestNotificationPermission().catch(() => {});

      // Fetch initial data in parallel. Users + subscriptions are required
      // to render the sidebar; presence and recent-DM history are best-effort
      // (Zulip's /realm/presence in particular is its flakiest endpoint, and
      // a transient 500 there shouldn't bounce the user back to the sign-in
      // page and clear their cached credentials).
      const [usersR, subsR, presenceR, dmR] = await Promise.allSettled([
        zApi.getUsers(),
        zApi.getSubscriptions(),
        zApi.getRealmPresence(),
        zApi.getMessages({
          narrow: [{ operator: 'is', operand: 'dm' }],
          num_before: 200,
          num_after: 0,
          anchor: 'newest',
        }),
      ]);
      if (usersR.status !== 'fulfilled') throw usersR.reason;
      if (subsR.status !== 'fulfilled') throw subsR.reason;
      const usersRes = usersR.value;
      const subsRes = subsR.value;
      const presenceRes = presenceR.status === 'fulfilled'
        ? presenceR.value
        : { result: 'success', msg: '', presences: {} };
      const dmRes = dmR.status === 'fulfilled'
        ? dmR.value
        : { result: 'success', msg: '', messages: [], found_anchor: false, found_oldest: true, found_newest: true };
      if (presenceR.status !== 'fulfilled') {
        console.warn('Initial /realm/presence failed; presence will populate on first ping', presenceR.reason);
      }
      if (dmR.status !== 'fulfilled') {
        console.warn('Initial DM history fetch failed; sidebar will populate as DMs arrive', dmR.reason);
      }

      setApi(zApi);
      setServerUrl(server);
      setCurrentUser(profile);
      // Keep deactivated users in the global list so historical DMs and
      // mentions can still resolve their names. Call sites that show a
      // pickable list of people (Sidebar's DM-able users, mention
      // autocomplete) filter on `is_active` themselves.
      setUsers(usersRes.members);
      setSubscriptions(subsRes.subscriptions);

      // Org name and icon from the public endpoint, so they show straight
      // away rather than waiting on /register. A Gravatar icon is Zulip's
      // generated default, not something the org chose: skip it.
      zApi
        .getServerSettings()
        .then((ss) => {
          if (ss.realm_name) setRealmName(ss.realm_name);
          if (typeof ss.zulip_feature_level === 'number') featureLevelRef.current = ss.zulip_feature_level;
          if (ss.realm_icon && !/gravatar\.com/i.test(ss.realm_icon)) setRealmIconUrl(ss.realm_icon);
        })
        .catch(() => {});

      // Fetch realm custom emoji (non-blocking)
      zApi.request<{ result: string; emoji: Record<string, { id: string; name: string; source_url: string; deactivated: boolean }> }>('/realm/emoji')
        .then((res) => {
          const emojiMap: Record<string, { name: string; source_url: string }> = {};
          for (const [id, info] of Object.entries(res.emoji)) {
            if (!info.deactivated) {
              emojiMap[id] = { name: info.name, source_url: info.source_url };
            }
          }
          setRealmEmoji(emojiMap);
        })
        .catch(() => {});

      // Build email→userId lookup for presence updates
      const emailMap = new Map<number, string>();
      for (const u of usersRes.members) emailMap.set(u.user_id, u.email);
      userEmailByIdRef.current = emailMap;

      // Build presence map
      const presMap: PresenceMap = {};
      for (const [email, data] of Object.entries(presenceRes.presences)) {
        const user = usersRes.members.find((u) => u.email === email);
        const p = aggregatePresence(data);
        if (user && p) presMap[user.user_id] = p;
      }
      setPresence(presMap);

      // Build DM conversation list from recent DM messages, keyed by the full
      // sorted participant set (matches Zulip huddle convention).
      const dmMap = new Map<string, { userIds: number[]; ts: number }>();
      for (const msg of dmRes.messages) {
        if (!Array.isArray(msg.display_recipient)) continue;
        const ids = (msg.display_recipient as { id: number }[]).map((r) => r.id);
        if (!ids.includes(profile.user_id)) ids.push(profile.user_id);
        const sortedIds = ids.slice().sort((a, b) => a - b);
        const key = dmKey(sortedIds);
        const existing = dmMap.get(key);
        if (!existing || msg.timestamp > existing.ts) {
          dmMap.set(key, { userIds: sortedIds, ts: msg.timestamp });
        }
      }
      const dmConvos: DmConversation[] = Array.from(dmMap.values())
        .map(({ userIds, ts }) => ({ userIds, lastMessageTimestamp: ts }))
        .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
      setDmConversations(dmConvos);

      // Cache credentials for auto-login. Encrypted via Electron's
      // safeStorage when available; fallback to localStorage in
      // browser-only dev. See src/app/api/credentialStore.ts.
      saveCredentials({ server, email, apiKey }).catch((err) => {
        console.warn('Failed to persist credentials:', err);
      });

      // Start event loop in background. Bumping the generation first retires
      // any loop left over from a previous session.
      loopGenRef.current++;
      setAutoLoginError(null);
      startEventLoop(zApi, profile.user_id);

      // Start periodic presence ping — this both reports our own activity AND
      // fetches fresh presence for everyone. Without this, presence data is
      // only ever the initial snapshot from login.
      const pingPresence = async () => {
        try {
          const idle =
            Date.now() - lastActivityRef.current > IDLE_AFTER_MS ||
            (typeof document !== 'undefined' && document.visibilityState === 'hidden');
          const res = await zApi.updatePresence(idle ? 'idle' : 'active');
          if (res.presences) {
            const emailMap = userEmailByIdRef.current;
            const byEmail = new Map<string, number>();
            emailMap.forEach((email, uid) => byEmail.set(email, uid));
            setPresence((prev) => {
              const next = { ...prev };
              for (const [email, data] of Object.entries(res.presences)) {
                const uid = byEmail.get(email);
                const p = aggregatePresence(data);
                if (uid && p) next[uid] = p;
              }
              return next;
            });
          }
        } catch (err) {
          console.warn('Presence ping failed:', err);
        }
      };
      pingPresence();
      if (presencePingRef.current) clearInterval(presencePingRef.current);
      presencePingRef.current = setInterval(pingPresence, 60_000);

      return profile;
    },
    [startEventLoop]
  );

  // `loading` gates the sign-in screen's spinner. It MUST be cleared on the
  // failure path too — otherwise a bad API key (or a server that's down)
  // leaves the app stuck on "Signing in..." forever with no error and no way
  // back to the form short of restarting.
  const login = useCallback(
    async (server: string, email: string, apiKey: string) => {
      setLoading(true);
      try {
        return await loginInner(server, email, apiKey);
      } finally {
        setLoading(false);
      }
    },
    [loginInner]
  );

  const logout = useCallback(() => {
    loopGenRef.current++;
    if (presencePingRef.current) {
      clearInterval(presencePingRef.current);
      presencePingRef.current = null;
    }
    if (queueIdRef.current && apiRef.current) {
      apiRef.current.deleteEventQueue(queueIdRef.current).catch(() => {});
    }
    // Invalidate any in-flight loadMessages results.
    loadNavTokenRef.current++;
    // Revoke cached blob URLs so we don't leak the previous user's avatars/images.
    for (const url of blobCache.current.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    blobCache.current.clear();
    inflightBlobs.current.clear();
    clearCredentials().catch(() => { /* ignore */ });
    setApi(null);
    setServerUrl('');
    setCurrentUser(null);
    setUsers([]);
    setSubscriptions([]);
    setTopics({});
    setMessages([]);
    setHasNewerMessages(false);
    hasNewerRef.current = false;
    setFocusMessageId(null);
    setPresence({});
    setTypingUsers([]);
    unreadRef.current.clear();
    mentionIdsRef.current.clear();
    setUnreadMentionCount(0);
    setUnreadMentionKeys(new Set());
    setRealmName('');
    setRealmIconUrl('');
    setConnectionError(null);
    setUnreadCounts({ streams: {}, pms: {} });
    setDmConversations([]);
    setRealmEmoji({});
    setUserStatusText('');
    setUserStatusEmoji(null);
    setPresenceEnabled(true);
    setGiphyApiKey('');
    currentNarrowRef.current = [];
    queueIdRef.current = null;
  }, []);

  // Auto-login on mount if credentials are cached.
  // loadCredentials() also runs the one-time migration from plaintext
  // localStorage into Electron's encrypted store on first launch after
  // upgrade, see src/app/api/credentialStore.ts.
  useEffect(() => {
    if (autoLoginAttempted.current) return;
    autoLoginAttempted.current = true;

    loadCredentials()
      .then((cached) => {
        if (!cached) return;
        return login(cached.server, cached.email, cached.apiKey).catch((err) => {
          // Only a rejected key means the saved credentials are bad. A
          // server that's down or a laptop that woke up offline used to
          // wipe them too, forcing a trip to Zulip settings for the key.
          if (isAuthError(err)) {
            setAutoLoginError('Your saved API key was rejected. Sign in again.');
            return clearCredentials();
          }
          setAutoLoginError(
            `Couldn't reach ${cached.server}${err instanceof Error ? ` (${err.message})` : ''}`
          );
        });
      })
      .catch(() => { /* swallow */ });
  }, [login]);

  const loadTopics = useCallback(
    async (streamId: number): Promise<ZulipTopic[]> => {
      if (!api) return [];
      const res = await api.getTopics(streamId);
      setTopics((prev) => ({ ...prev, [streamId]: res.topics }));
      return res.topics;
    },
    [api]
  );

  const clearNarrow = useCallback(() => {
    loadNavTokenRef.current++;
    currentNarrowRef.current = [];
    hasNewerRef.current = false;
    setHasNewerMessages(false);
    setFocusMessageId(null);
    setMessages([]);
    setLoading(false);
  }, []);

  // Clear the badge for the conversation a narrow points at. Opening a
  // conversation counts as reading it, even past the first page we fetched.
  const clearNarrowUnread = useCallback(
    (narrow: ZulipNarrow[]) => {
      const dmNarrow = narrow.find((n) => n.operator === 'dm' || n.operator === 'pm-with');
      const streamNarrow = narrow.find((n) => n.operator === 'stream' || n.operator === 'channel');
      const topicNarrow = narrow.find((n) => n.operator === 'topic' || n.operator === 'subject');

      if (dmNarrow) {
        // Operand is comma-separated emails of OTHER participants. Build the
        // sorted user-id set (incl. self).
        const others = String(dmNarrow.operand)
          .split(',')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);
        const myId = currentUserRef.current?.user_id;
        const ids: number[] = [];
        if (myId !== undefined) ids.push(myId);
        for (const email of others) {
          const u = users.find((x) => x.email.toLowerCase() === email);
          if (u && !ids.includes(u.user_id)) ids.push(u.user_id);
        }
        if (ids.length > 0) clearUnreadKey('pms', dmKey(ids));
      }
      if (streamNarrow && topicNarrow) {
        const operand = streamNarrow.operand;
        const streamId =
          typeof operand === 'number'
            ? operand
            : subscriptions.find((s) => s.name === operand || s.stream_id === Number(operand))
                ?.stream_id;
        if (streamId !== undefined) {
          clearUnreadKey('streams', `${streamId}:${String(topicNarrow.operand)}`);
        }
      }
    },
    [users, subscriptions, clearUnreadKey]
  );

  const loadMessages = useCallback(
    async (narrow: ZulipNarrow[], anchor?: number) => {
      if (!api) return;
      const myToken = ++loadNavTokenRef.current;
      setLoading(true);
      currentNarrowRef.current = narrow;
      // Clear immediately so the previous narrow's messages don't flash.
      setMessages([]);
      setHasMoreMessages(true);
      setHasNewerMessages(false);
      hasNewerRef.current = false;
      setFocusMessageId(null);
      try {
        const res = await api.getMessages(
          anchor === undefined
            ? { narrow, num_before: 50, num_after: 0 }
            : { narrow, anchor, num_before: 25, num_after: 25 }
        );
        // Bail if a newer load (or logout) has started.
        if (loadNavTokenRef.current !== myToken) return;
        const reachesPresent = anchor === undefined || res.found_newest;
        hasNewerRef.current = !reachesPresent;
        setHasNewerMessages(!reachesPresent);
        setFocusMessageId(anchor !== undefined && res.found_anchor ? anchor : null);

        // Mark all loaded messages as read, and stamp the `read` flag onto our
        // local copies. Without the local stamp the flags never change, so
        // MessageList's mark-as-read effect re-fires — and re-POSTs the whole
        // unread set — on every single incoming event.
        const unreadIds = res.messages
          .filter((m) => !(m.flags ?? []).includes('read'))
          .map((m) => m.id);
        if (unreadIds.length > 0) {
          const unreadSet = new Set(unreadIds);
          setMessages(
            res.messages.map((m) =>
              unreadSet.has(m.id) ? { ...m, flags: [...(m.flags ?? []), 'read'] } : m
            )
          );
          api
            .updateMessageFlags({ messages: unreadIds, op: 'add', flag: 'read' })
            .catch(() => {});
        } else {
          setMessages(res.messages);
        }
        setHasMoreMessages(!res.found_oldest);

        clearNarrowUnread(narrow);
      } finally {
        if (loadNavTokenRef.current === myToken) setLoading(false);
      }
    },
    [api, clearNarrowUnread]
  );

  // Read the oldest-message id from a ref instead of putting `messages` in
  // the deps. Otherwise this callback's identity changes on every event,
  // which detaches/reattaches the scroll listener in MessageList on every
  // single message arrival.
  const messagesRef = useRef<ZulipMessage[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const loadOlderMessages = useCallback(
    async (): Promise<number> => {
      const cur = messagesRef.current;
      if (!api || loadingOlder || !hasMoreMessages || cur.length === 0) return 0;
      const myToken = loadNavTokenRef.current;
      const narrowAtRequest = currentNarrowRef.current;
      setLoadingOlder(true);
      try {
        const oldestId = cur[0].id;
        const res = await api.getMessages({
          narrow: narrowAtRequest,
          anchor: oldestId,
          num_before: 50,
          num_after: 0,
        });
        if (loadNavTokenRef.current !== myToken) return 0;
        const olderMessages = res.messages.filter((m) => m.id < oldestId);
        if (olderMessages.length > 0) {
          setMessages((prev) => [...olderMessages, ...prev]);
        }
        setHasMoreMessages(!res.found_oldest);
        return olderMessages.length;
      } finally {
        if (loadNavTokenRef.current === myToken) setLoadingOlder(false);
      }
    },
    [api, loadingOlder, hasMoreMessages]
  );

  const loadNewerMessages = useCallback(
    async (): Promise<number> => {
      const cur = messagesRef.current;
      if (!api || loadingNewer || !hasNewerMessages || cur.length === 0) return 0;
      const myToken = loadNavTokenRef.current;
      setLoadingNewer(true);
      try {
        const newestId = cur[cur.length - 1].id;
        const res = await api.getMessages({
          narrow: currentNarrowRef.current,
          anchor: newestId,
          num_before: 0,
          num_after: 50,
        });
        if (loadNavTokenRef.current !== myToken) return 0;
        const newer = res.messages.filter((m) => m.id > newestId);
        if (newer.length > 0) setMessages((prev) => mergeMessages(prev, newer));
        hasNewerRef.current = !res.found_newest;
        setHasNewerMessages(!res.found_newest);
        return newer.length;
      } finally {
        if (loadNavTokenRef.current === myToken) setLoadingNewer(false);
      }
    },
    [api, loadingNewer, hasNewerMessages]
  );

  const jumpToPresent = useCallback(
    () => loadMessages(currentNarrowRef.current),
    [loadMessages]
  );

  const setMessageOpener = useCallback(
    (opener: ((message: ZulipMessage) => void) | null) => {
      messageOpenerRef.current = opener;
    },
    []
  );

  const sendMessage = useCallback(
    async (params: {
      type: 'stream' | 'direct';
      to: string | number | number[];
      topic?: string;
      content: string;
    }) => {
      if (!api) return;
      const res = await api.sendMessage(params);
      // Safety net: our own message should arrive back over the event loop
      // within a moment. If it hasn't, the loop is probably stuck on a dead
      // connection — fetch the message directly so the sender sees it, and
      // kick the loop so everything after it flows again.
      const narrow = currentNarrowRef.current;
      const navToken = loadNavTokenRef.current;
      const sentId = res.id;
      if (typeof sentId !== 'number' || narrow.length === 0) return;
      window.setTimeout(() => {
        if (loadNavTokenRef.current !== navToken || hasNewerRef.current) return;
        if (messagesRef.current.some((m) => m.id === sentId)) return;
        console.warn(`Sent message ${sentId} never arrived via events; fetching it and reconnecting`);
        kickEventLoop();
        api
          .getMessages({ narrow, anchor: sentId, num_before: 0, num_after: 0 })
          .then((r) => {
            if (loadNavTokenRef.current !== navToken) return;
            const found = r.messages.filter((m) => m.id === sentId);
            if (found.length > 0) setMessages((prev) => mergeMessages(prev, found));
          })
          .catch(() => {});
      }, 2500);
    },
    [api, kickEventLoop]
  );

  const uploadFile = useCallback(
    async (file: File): Promise<string> => {
      if (!api) throw new Error('Not connected');
      const res = await api.uploadFile(file);
      // `uri` was renamed to `url` in newer Zulip releases; accept either so
      // uploads don't silently insert "undefined" as the link target.
      const uploaded = res.url ?? res.uri;
      if (!uploaded) throw new Error('Upload succeeded but the server returned no URL');
      return uploaded;
    },
    [api]
  );

  const addReaction = useCallback(
    async (messageId: number, emojiName: string, emojiCode?: string, reactionType?: string) => {
      if (!api) return;
      await api.addReaction(messageId, emojiName, emojiCode, reactionType);
    },
    [api]
  );

  const removeReaction = useCallback(
    async (messageId: number, emojiName: string, emojiCode?: string, reactionType?: string) => {
      if (!api) return;
      await api.removeReaction(messageId, emojiName, emojiCode, reactionType);
    },
    [api]
  );

  // Edit/delete actions. Local message state is updated by the event-loop
  // handlers for `update_message` and `delete_message` events that the
  // server echoes back, so we don't optimistically mutate `messages` here.
  const editMessage = useCallback(
    async (messageId: number, content: string) => {
      if (!api) return;
      await api.editMessage(messageId, { content });
    },
    [api]
  );

  const deleteMessage = useCallback(
    async (messageId: number) => {
      if (!api) return;
      await api.deleteMessage(messageId);
    },
    [api]
  );

  const getMessageRaw = useCallback(
    async (messageId: number): Promise<string> => {
      if (!api) return '';
      return api.getMessageRaw(messageId);
    },
    [api]
  );

  const markMessagesAsRead = useCallback(
    async (messageIds: number[]) => {
      if (!api || messageIds.length === 0) return;
      // Stamp the flag locally first so callers observing `messages` stop
      // treating these as unread immediately (and don't re-submit them).
      const markedSet = new Set(messageIds);
      setMessages((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          if (!markedSet.has(m.id) || (m.flags ?? []).includes('read')) return m;
          changed = true;
          return { ...m, flags: [...(m.flags ?? []), 'read'] };
        });
        return changed ? next : prev;
      });
      await api.updateMessageFlags({
        messages: messageIds,
        op: 'add',
        flag: 'read',
      });
      forgetUnread(messageIds);
      clearNarrowUnread(currentNarrowRef.current);
    },
    [api, forgetUnread, clearNarrowUnread]
  );

  const sendTyping = useCallback(
    async (target: TypingTarget, op: 'start' | 'stop') => {
      if (!api) return;
      await api.sendTypingNotification({ op, ...target }).catch(() => {});
    },
    [api]
  );

  const searchMessages = useCallback(
    async (query: string, signal?: AbortSignal): Promise<ZulipMessage[]> => {
      if (!api) return [];
      const res = await api.getMessages({
        narrow: [{ operator: 'search', operand: query }],
        num_before: 50,
        num_after: 0,
        signal,
      });
      return res.messages;
    },
    [api]
  );

  const resolveUrl = useCallback(
    (url: string): string => platform.assetUrl(serverUrl, url),
    [serverUrl]
  );

  // Fetch a URL with auth and return a blob URL (for images in messages).
  // Real LRU: re-inserting on hit keeps recently-accessed entries young.
  // Map iteration order is insertion order, so deleting + re-setting moves
  // the entry to the tail and `keys().next().value` gives us the head.
  const fetchAuthenticatedUrl = useCallback(
    async (url: string): Promise<string> => {
      const cached = blobCache.current.get(url);
      if (cached) {
        blobCache.current.delete(url);
        blobCache.current.set(url, cached);
        return cached;
      }
      // Coalesce concurrent requests for the same URL. Two <img> tags pointing
      // at one attachment used to each create a blob URL; the second `set`
      // orphaned the first, leaking it for the life of the session.
      const inflight = inflightBlobs.current.get(url);
      if (inflight) return inflight;

      const job = (async () => {
      try {
        const resolved = resolveUrl(url);
        const res = await platform.fetch(resolved, {
          headers: api ? { Authorization: api.authHeader } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);

        // Evict the LRU head if the cache is full.
        if (blobCache.current.size >= BLOB_CACHE_MAX) {
          const firstKey = blobCache.current.keys().next().value;
          if (firstKey) {
            const oldUrl = blobCache.current.get(firstKey);
            if (oldUrl) URL.revokeObjectURL(oldUrl);
            blobCache.current.delete(firstKey);
          }
        }

        blobCache.current.set(url, blobUrl);
        return blobUrl;
      } catch {
        return resolveUrl(url);
      } finally {
        inflightBlobs.current.delete(url);
      }
      })();
      inflightBlobs.current.set(url, job);
      return job;
    },
    [api, resolveUrl]
  );

  const getUserStatus = useCallback(
    (userId: number): UserStatus => {
      const p = presence[userId];
      if (!p) return 'offline';
      // Consider stale if >5 min old
      const age = Date.now() / 1000 - p.timestamp;
      if (age > 300) return 'offline';
      return p.status;
    },
    [presence]
  );

  const updateUserStatus = useCallback(
    async (params: {
      status_text?: string;
      away?: boolean;
      emoji_name?: string;
      emoji_code?: string;
      reaction_type?: string;
    }) => {
      if (!api) return;
      await api.updateStatus(params);
      if (params.status_text !== undefined) setUserStatusText(params.status_text);
      if (params.emoji_name !== undefined) {
        setUserStatusEmoji(
          params.emoji_name
            ? { name: params.emoji_name, code: params.emoji_code || '', type: params.reaction_type || 'unicode_emoji' }
            : null
        );
      }
    },
    [api]
  );

  const muteStream = useCallback(
    async (streamId: number, mute: boolean) => {
      if (!api) return;
      await api.updateSubscriptionProperty(streamId, 'is_muted', mute);
      setSubscriptions((prev) =>
        prev.map((s) => (s.stream_id === streamId ? { ...s, is_muted: mute } : s))
      );
    },
    [api]
  );

  // Fetching "the newest N unread" starves quiet conversations whenever one
  // channel is busy (Monitoring's alerts filled all 300, leaving most Inbox
  // rows without a preview). Instead take the newest unread id per
  // conversation from the unread map and fetch exactly those.
  const fetchInboxPreviews = useCallback(async (): Promise<ZulipMessage[]> => {
    if (!api) return [];
    const newest = new Map<string, number>();
    for (const [id, loc] of unreadRef.current) {
      const k = `${loc.kind}:${loc.key.toLowerCase()}`;
      if ((newest.get(k) ?? 0) < id) newest.set(k, id);
    }
    const ids = Array.from(newest.values());
    if (ids.length === 0) return [];
    if (featureLevelRef.current >= 300) {
      const out: ZulipMessage[] = [];
      for (let i = 0; i < ids.length; i += 500) {
        const res = await api.getMessagesByIds(ids.slice(i, i + 500));
        out.push(...res.messages);
      }
      return out;
    }
    // Pre-9.0 servers: best effort with the newest unread messages overall.
    const res = await api.getMessages({
      narrow: [{ operator: 'is', operand: 'unread' }],
      anchor: 'newest',
      num_before: 300,
      num_after: 0,
    });
    return res.messages;
  }, [api]);

  const renameTopic = useCallback(
    async (messageId: number, newTopic: string) => {
      if (!api) return;
      await api.editMessage(messageId, { topic: newTopic, propagate_mode: 'change_all' });
    },
    [api]
  );

  const markAllAsRead = useCallback(async () => {
    if (!api) return;
    await api.markAllAsRead();
    unreadRef.current.clear();
    publishUnread();
  }, [api, publishUnread]);

  const setInvisible = useCallback(
    async (invisible: boolean) => {
      if (!api) return;
      await api.updateSettings({ presence_enabled: !invisible });
      setPresenceEnabled(!invisible);
    },
    [api]
  );

  return (
    <ZulipContext.Provider
      value={{
        api,
        serverUrl,
        currentUser,
        users,
        subscriptions,
        topics,
        messages,
        presence,
        typingUsers,
        unreadCounts,
        dmConversations,
        realmEmoji,
        loading,
        loadingOlder,
        hasMoreMessages,
        hasNewerMessages,
        loadingNewer,
        focusMessageId,
        login,
        logout,
        loadTopics,
        clearNarrow,
        loadMessages,
        loadOlderMessages,
        loadNewerMessages,
        jumpToPresent,
        setMessageOpener,
        sendMessage,
        uploadFile,
        addReaction,
        removeReaction,
        editMessage,
        deleteMessage,
        getMessageRaw,
        markMessagesAsRead,
        sendTyping,
        searchMessages,
        getUserStatus,
        userStatusText,
        userStatusEmoji,
        updateUserStatus,
        muteStream,
        presenceEnabled,
        setInvisible,
        giphyApiKey,
        realmName,
        realmIconUrl,
        unreadMentionCount,
        fetchInboxPreviews,
        unreadMentionKeys,
        renameTopic,
        markAllAsRead,
        autoLoginError,
        connectionError,
        resolveUrl,
        fetchAuthenticatedUrl,
      }}
    >
      {children}
    </ZulipContext.Provider>
  );
}
