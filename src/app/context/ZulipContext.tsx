import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import { ZulipApi } from '../api/zulipApi';
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
  DeleteMessageEvent,
  TypingEvent,
  RegisterEventQueueResponse,
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

// ── Context shape ─────────────────────────────────────
interface ZulipContextValue {
  api: ZulipApi | null;
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

  // actions
  login: (server: string, email: string, apiKey: string) => Promise<ZulipUser>;
  logout: () => void;
  loadTopics: (streamId: number) => Promise<void>;
  loadMessages: (narrow: ZulipNarrow[]) => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  sendMessage: (params: {
    type: 'stream' | 'direct';
    to: string | number | number[];
    topic?: string;
    content: string;
  }) => Promise<void>;
  uploadFile: (file: File) => Promise<string>;
  addReaction: (messageId: number, emojiName: string, emojiCode?: string, reactionType?: string) => Promise<void>;
  removeReaction: (messageId: number, emojiName: string, emojiCode?: string, reactionType?: string) => Promise<void>;
  markMessagesAsRead: (messageIds: number[]) => Promise<void>;
  sendTyping: (to: number[], op: 'start' | 'stop') => Promise<void>;
  searchMessages: (query: string) => Promise<ZulipMessage[]>;
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
  const currentNarrowRef = useRef<ZulipNarrow[]>([]);

  const eventLoopRef = useRef<boolean>(false);
  const queueIdRef = useRef<string | null>(null);
  const apiRef = useRef<ZulipApi | null>(null);
  const currentUserRef = useRef<ZulipUser | null>(null);
  const serverUrlRef = useRef<string>('');
  // Increments on every loadMessages call; used to bail stale responses.
  const loadNavTokenRef = useRef(0);
  // LRU of authenticated blob URLs; declared up-front so logout can revoke them.
  const blobCache = useRef<Map<string, string>>(new Map());
  const BLOB_CACHE_MAX = 200;
  // Zulip is pull-based for presence: we ping every 60s to keep our own
  // presence fresh AND to receive updated peer presences in the response.
  const presencePingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Cache of user_id → email for fast lookup inside the event loop without
  // depending on the (potentially stale) `users` state captured by closures.
  const userEmailByIdRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);
  useEffect(() => {
    serverUrlRef.current = serverUrl;
  }, [serverUrl]);

  // ── Event loop ────────────────────────────────────────
  const processInitialUnread = useCallback(
    (reg: RegisterEventQueueResponse, myIdHint?: number) => {
      if (!reg.unread_msgs) return;
      const myId = myIdHint ?? currentUserRef.current?.user_id;
      const streamCounts: Record<string, number> = {};
      for (const s of reg.unread_msgs.streams) {
        const key = `${s.stream_id}:${s.topic}`;
        streamCounts[key] = s.unread_message_ids.length;
      }
      const pmCounts: Record<string, number> = {};
      // Solo DMs: Zulip keys by sender_id; we key by sorted [me, sender].
      for (const pm of reg.unread_msgs.pms) {
        const ids = myId !== undefined ? [myId, pm.sender_id] : [pm.sender_id];
        pmCounts[dmKey(ids)] = pm.unread_message_ids.length;
      }
      // Group DMs: Zulip already provides a sorted user_ids_string.
      for (const h of reg.unread_msgs.huddles ?? []) {
        pmCounts[h.user_ids_string] = h.unread_message_ids.length;
      }
      setUnreadCounts({ streams: streamCounts, pms: pmCounts });
    },
    []
  );

  const startEventLoop = useCallback(
    async (zApi: ZulipApi, myId?: number) => {
      // Resolve a Zulip-relative URL to something fetchable in current runtime.
      const resolveUrlFn = (url: string) => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        const isElectron = !!(window as any).electronAPI?.isElectron;
        const isDev = import.meta.env.DEV;
        if (isElectron && !isDev) {
          return `${serverUrlRef.current.replace(/\/+$/, '')}${url}`;
        }
        return `/zulip-api${url}`;
      };

      try {
        let reg = await zApi.registerEventQueue();
        queueIdRef.current = reg.queue_id;
        let lastEventId = reg.last_event_id;
        processInitialUnread(reg, myId);

        eventLoopRef.current = true;

        while (eventLoopRef.current) {
          try {
            const eventsRes = await zApi.getEvents(
              reg.queue_id,
              lastEventId
            );
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
                          return msg.subject === n.operand;
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
                          return true;
                        default:
                          return true;
                      }
                    });
                  }
                  if (matchesNarrow) {
                    setMessages((prev) => {
                      if (prev.some((m) => m.id === me.message.id)) return prev;
                      return [...prev, me.message];
                    });
                  }
                  // Always update unread counts for messages not in current view.
                  // (The matched-narrow case is read-marked by MessageList.)
                  const msg = me.message;
                  if (!matchesNarrow && msg.sender_id !== myId) {
                    if (msg.type === 'stream' && typeof msg.stream_id === 'number') {
                      setUnreadCounts((prev) => {
                        const key = `${msg.stream_id}:${msg.subject}`;
                        return {
                          ...prev,
                          streams: { ...prev.streams, [key]: (prev.streams[key] || 0) + 1 },
                        };
                      });
                    } else if (msg.type === 'private' && Array.isArray(msg.display_recipient)) {
                      const ids = (msg.display_recipient as { id: number }[]).map((r) => r.id);
                      // Ensure self is represented even if Zulip omits us.
                      if (myId !== undefined && !ids.includes(myId)) ids.push(myId);
                      const key = dmKey(ids);
                      setUnreadCounts((prev) => ({
                        ...prev,
                        pms: { ...prev.pms, [key]: (prev.pms[key] || 0) + 1 },
                      }));
                    }
                  }
                  // Desktop notification for DMs and @-mentions from other users.
                  // Notify when not the sender AND (it's a DM OR we were mentioned).
                  // Prefer Electron's native main-process notification (more reliable
                  // on Windows than web Notification); fall back to web API.
                  {
                    const isFromMe = msg.sender_id === myId;
                    const isMentioned = Array.isArray(me.flags) && me.flags.some((f) => f === 'mentioned' || f === 'wildcard_mentioned');
                    const isDM = msg.type === 'private';
                    if (!isFromMe && (isDM || isMentioned)) {
                      const div = document.createElement('div');
                      div.innerHTML = msg.content;
                      const text = (div.textContent || div.innerText || '').slice(0, 200) || '(sent an attachment)';
                      const title = isDM
                        ? msg.sender_full_name
                        : `${msg.sender_full_name} (#${typeof msg.display_recipient === 'string' ? msg.display_recipient : ''} > ${msg.subject})`;
                      const icon = resolveUrlFn(msg.avatar_url);
                      const electronAPI = (window as any).electronAPI;
                      if (electronAPI?.showNotification) {
                        electronAPI.showNotification({ title, body: text, icon }).catch(() => {});
                      } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                        try {
                          const note = new Notification(title, { body: text, icon, tag: `zulip-${msg.id}` });
                          note.onclick = () => {
                            const api = (window as any).electronAPI;
                            if (api?.focusWindow) api.focusWindow();
                            else window.focus();
                            note.close();
                          };
                        } catch {
                          new Notification(title, { body: text });
                        }
                      }
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
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === ue.message_id
                        ? {
                            ...m,
                            ...(ue.rendered_content && {
                              content: ue.rendered_content,
                            }),
                            ...(ue.content && { content: ue.content }),
                            ...(ue.subject && { subject: ue.subject }),
                          }
                        : m
                    )
                  );
                  break;
                }
                case 'delete_message': {
                  const de = event as DeleteMessageEvent;
                  setMessages((prev) =>
                    prev.filter((m) => !de.message_ids.includes(m.id))
                  );
                  break;
                }
                case 'reaction': {
                  const re = event as ReactionEvent;
                  setMessages((prev) =>
                    prev.map((m) => {
                      if (m.id !== re.message_id) return m;
                      if (re.op === 'add') {
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
                  const pe = event as PresenceEvent;
                  const aggregated = pe.presence?.aggregated as
                    | { status: 'active' | 'idle'; timestamp: number }
                    | undefined;
                  if (aggregated) {
                    setPresence((prev) => ({
                      ...prev,
                      [pe.user_id]: {
                        status:
                          aggregated.status === 'active' ? 'online' : 'idle',
                        timestamp: aggregated.timestamp,
                      },
                    }));
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
                      if (
                        prev.some(
                          (t) => t.userId === te.sender.user_id && t.conversationKey === ck
                        )
                      ) {
                        return prev;
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
                case 'subscription': {
                  // Reload subscriptions on changes
                  const subsRes = await zApi.getSubscriptions();
                  setSubscriptions(subsRes.subscriptions);
                  break;
                }
                }
              } catch (handlerErr) {
                // Don't let one bad event halt the whole batch / loop.
                console.error('Event handler error', event, handlerErr);
              }
            }
          } catch (err: unknown) {
            if (!eventLoopRef.current) break;
            // If the queue expired (e.g. after a long sleep / network blip),
            // re-register and continue. Otherwise back off and retry.
            const msg = err instanceof Error ? err.message : String(err ?? '');
            const isBadQueue =
              /BAD_EVENT_QUEUE_ID/i.test(msg) ||
              /Bad event queue id/i.test(msg) ||
              /queue.*not.*found/i.test(msg);
            if (isBadQueue) {
              try {
                reg = await zApi.registerEventQueue();
                queueIdRef.current = reg.queue_id;
                lastEventId = reg.last_event_id;
                processInitialUnread(reg, myId);
                continue;
              } catch (reRegErr) {
                console.error('Failed to re-register event queue', reRegErr);
              }
            }
            await new Promise((r) => setTimeout(r, 5000));
          }
        }
      } catch (err) {
        console.error('Failed to start event queue:', err);
      }
    },
    [processInitialUnread]
  );

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
  const login = useCallback(
    async (server: string, email: string, apiKey: string) => {
      setLoading(true);
      const zApi = new ZulipApi(server, email, apiKey);

      // Validate credentials
      const profile = await zApi.getProfile();

      // Tell main process which origin to scope the CORS/Origin header
      // rewrites to. After this point, third-party fetches (image CDNs,
      // GIPHY, etc.) won't get force-allowed CORS responses.
      try {
        (window as any).electronAPI?.setServerUrl?.(server);
      } catch {
        // ignore — non-Electron context
      }

      // Request notification permission
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }

      // Fetch initial data in parallel
      const [usersRes, subsRes, presenceRes, dmRes] = await Promise.all([
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

      setApi(zApi);
      setServerUrl(server);
      setCurrentUser(profile);
      setUsers(usersRes.members.filter((u) => u.is_active));
      setSubscriptions(subsRes.subscriptions);

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
        if (user && data.aggregated) {
          presMap[user.user_id] = {
            status: data.aggregated.status === 'active' ? 'online' : data.aggregated.status === 'idle' ? 'idle' : 'offline',
            timestamp: data.aggregated.timestamp,
          };
        }
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

      setLoading(false);

      // Cache credentials for auto-login
      localStorage.setItem(
        'zulip_credentials',
        JSON.stringify({ server, email, apiKey })
      );

      // Start event loop in background
      startEventLoop(zApi, profile.user_id);

      // Start periodic presence ping — this both reports our own activity AND
      // fetches fresh presence for everyone. Without this, presence data is
      // only ever the initial snapshot from login.
      const pingPresence = async () => {
        try {
          const res = await zApi.updatePresence('active');
          if (res.presences) {
            const emailMap = userEmailByIdRef.current;
            const byEmail = new Map<string, number>();
            emailMap.forEach((email, uid) => byEmail.set(email, uid));
            setPresence((prev) => {
              const next = { ...prev };
              for (const [email, data] of Object.entries(res.presences)) {
                const uid = byEmail.get(email);
                if (uid && data.aggregated) {
                  next[uid] = {
                    status: data.aggregated.status === 'active' ? 'online'
                      : data.aggregated.status === 'idle' ? 'idle' : 'offline',
                    timestamp: data.aggregated.timestamp,
                  };
                }
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

  const logout = useCallback(() => {
    eventLoopRef.current = false;
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
    localStorage.removeItem('zulip_credentials');
    setApi(null);
    setServerUrl('');
    setCurrentUser(null);
    setUsers([]);
    setSubscriptions([]);
    setTopics({});
    setMessages([]);
    setPresence({});
    setTypingUsers([]);
    setUnreadCounts({ streams: {}, pms: {} });
    setDmConversations([]);
    setRealmEmoji({});
    setUserStatusText('');
    setUserStatusEmoji(null);
    currentNarrowRef.current = [];
    queueIdRef.current = null;
  }, []);

  // Auto-login on mount if credentials are cached
  useEffect(() => {
    if (autoLoginAttempted.current) return;
    autoLoginAttempted.current = true;

    const cached = localStorage.getItem('zulip_credentials');
    if (cached) {
      try {
        const { server, email, apiKey } = JSON.parse(cached);
        login(server, email, apiKey).catch(() => {
          // Credentials expired or invalid — clear them
          localStorage.removeItem('zulip_credentials');
        });
      } catch {
        localStorage.removeItem('zulip_credentials');
      }
    }
  }, [login]);

  const loadTopics = useCallback(
    async (streamId: number) => {
      if (!api) return;
      const res = await api.getTopics(streamId);
      setTopics((prev) => ({ ...prev, [streamId]: res.topics }));
    },
    [api]
  );

  const loadMessages = useCallback(
    async (narrow: ZulipNarrow[]) => {
      if (!api) return;
      const myToken = ++loadNavTokenRef.current;
      setLoading(true);
      currentNarrowRef.current = narrow;
      // Clear immediately so the previous narrow's messages don't flash.
      setMessages([]);
      setHasMoreMessages(true);
      try {
        const res = await api.getMessages({ narrow, num_before: 50, num_after: 0 });
        // Bail if a newer load (or logout) has started.
        if (loadNavTokenRef.current !== myToken) return;
        setMessages(res.messages);
        setHasMoreMessages(!res.found_oldest);

        // Mark all loaded messages as read and clear unread counts
        const unreadIds = res.messages
          .filter((m) => !(m.flags ?? []).includes('read'))
          .map((m) => m.id);
        if (unreadIds.length > 0) {
          api
            .updateMessageFlags({ messages: unreadIds, op: 'add', flag: 'read' })
            .catch(() => {});
        }

        // Clear local unread counts for this narrow
        const dmNarrow = narrow.find((n) => n.operator === 'dm' || n.operator === 'pm-with');
        const streamNarrow = narrow.find((n) => n.operator === 'stream' || n.operator === 'channel');
        const topicNarrow = narrow.find((n) => n.operator === 'topic' || n.operator === 'subject');

        if (dmNarrow) {
          // Operand is comma-separated emails of OTHER participants. Build the
          // sorted user-id set (incl. self) and clear that conversation's badge.
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
          if (ids.length > 0) {
            const key = dmKey(ids);
            setUnreadCounts((prev) => {
              const pms = { ...prev.pms };
              delete pms[key];
              return { ...prev, pms };
            });
          }
        }
        if (streamNarrow && topicNarrow) {
          const operand = streamNarrow.operand;
          const topicName = String(topicNarrow.operand);
          let streamId: number | undefined;
          if (typeof operand === 'number') {
            streamId = operand;
          } else {
            const sub = subscriptions.find(
              (s) => s.name === operand || s.stream_id === Number(operand)
            );
            streamId = sub?.stream_id;
          }
          if (streamId !== undefined) {
            setUnreadCounts((prev) => {
              const streams = { ...prev.streams };
              delete streams[`${streamId}:${topicName}`];
              return { ...prev, streams };
            });
          }
        }
      } finally {
        if (loadNavTokenRef.current === myToken) setLoading(false);
      }
    },
    [api, users, subscriptions]
  );

  const loadOlderMessages = useCallback(
    async () => {
      if (!api || loadingOlder || !hasMoreMessages || messages.length === 0) return;
      const myToken = loadNavTokenRef.current;
      const narrowAtRequest = currentNarrowRef.current;
      setLoadingOlder(true);
      try {
        const oldestId = messages[0].id;
        const res = await api.getMessages({
          narrow: narrowAtRequest,
          anchor: oldestId,
          num_before: 50,
          num_after: 0,
        });
        // Bail if user navigated to a different narrow mid-flight.
        if (loadNavTokenRef.current !== myToken) return;
        // Remove the anchor message (it's already in our list)
        const olderMessages = res.messages.filter((m) => m.id < oldestId);
        if (olderMessages.length > 0) {
          setMessages((prev) => [...olderMessages, ...prev]);
        }
        setHasMoreMessages(!res.found_oldest);
      } finally {
        if (loadNavTokenRef.current === myToken) setLoadingOlder(false);
      }
    },
    [api, loadingOlder, hasMoreMessages, messages]
  );

  const sendMessage = useCallback(
    async (params: {
      type: 'stream' | 'direct';
      to: string | number | number[];
      topic?: string;
      content: string;
    }) => {
      if (!api) return;
      await api.sendMessage(params);
    },
    [api]
  );

  const uploadFile = useCallback(
    async (file: File): Promise<string> => {
      if (!api) throw new Error('Not connected');
      const res = await api.uploadFile(file);
      return res.uri;
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

  const markMessagesAsRead = useCallback(
    async (messageIds: number[]) => {
      if (!api || messageIds.length === 0) return;
      await api.updateMessageFlags({
        messages: messageIds,
        op: 'add',
        flag: 'read',
      });
      // Clear local unread counts for the current narrow
      const narrow = currentNarrowRef.current;
      if (narrow.length === 0) return;
      const dmNarrow = narrow.find((n) => n.operator === 'dm' || n.operator === 'pm-with');
      const streamNarrow = narrow.find((n) => n.operator === 'stream' || n.operator === 'channel');
      const topicNarrow = narrow.find((n) => n.operator === 'topic' || n.operator === 'subject');

      if (dmNarrow) {
        // Clear the badge for this conversation, keyed by participant set.
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
        if (ids.length > 0) {
          const key = dmKey(ids);
          setUnreadCounts((prev) => {
            const pms = { ...prev.pms };
            delete pms[key];
            return { ...prev, pms };
          });
        }
      }
      if (streamNarrow && topicNarrow) {
        setUnreadCounts((prev) => {
          const streams = { ...prev.streams };
          // Find stream ID - operand could be name or ID
          const operand = streamNarrow.operand;
          const topicName = String(topicNarrow.operand);
          let streamId: number | undefined;
          if (typeof operand === 'number') {
            streamId = operand;
          } else {
            const sub = subscriptions.find((s) => s.name === operand || s.stream_id === Number(operand));
            streamId = sub?.stream_id;
          }
          if (streamId !== undefined) {
            delete streams[`${streamId}:${topicName}`];
          }
          return { ...prev, streams };
        });
      }
    },
    [api, users, subscriptions]
  );

  const sendTyping = useCallback(
    async (to: number[], op: 'start' | 'stop') => {
      if (!api) return;
      await api.sendTypingNotification({ op, to }).catch(() => {});
    },
    [api]
  );

  const searchMessages = useCallback(
    async (query: string): Promise<ZulipMessage[]> => {
      if (!api) return [];
      const res = await api.getMessages({
        narrow: [{ operator: 'search', operand: query }],
        num_before: 50,
        num_after: 0,
      });
      return res.messages;
    },
    [api]
  );

  const resolveUrl = useCallback(
    (url: string): string => {
      if (!url) return '';
      // Already absolute
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      // Relative URL from Zulip — proxy through /zulip-api in dev, direct in prod
      const isElectron = !!(window as any).electronAPI?.isElectron;
      const isDev = import.meta.env.DEV;
      if (isElectron && !isDev) {
        return `${serverUrl.replace(/\/+$/, '')}${url}`;
      }
      return `/zulip-api${url}`;
    },
    [serverUrl]
  );

  // Fetch a URL with auth and return a blob URL (for images in messages).
  // Uses the LRU declared up-front (so logout can revoke entries).
  const fetchAuthenticatedUrl = useCallback(
    async (url: string): Promise<string> => {
      const cached = blobCache.current.get(url);
      if (cached) return cached;

      try {
        const resolved = resolveUrl(url);
        const res = await fetch(resolved, {
          headers: api ? { Authorization: (api as any).authHeader } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);

        // Evict oldest entries if cache is full
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
      }
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

  return (
    <ZulipContext.Provider
      value={{
        api,
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
        login,
        logout,
        loadTopics,
        loadMessages,
        loadOlderMessages,
        sendMessage,
        uploadFile,
        addReaction,
        removeReaction,
        markMessagesAsRead,
        sendTyping,
        searchMessages,
        getUserStatus,
        userStatusText,
        userStatusEmoji,
        updateUserStatus,
        muteStream,
        resolveUrl,
        fetchAuthenticatedUrl,
      }}
    >
      {children}
    </ZulipContext.Provider>
  );
}
