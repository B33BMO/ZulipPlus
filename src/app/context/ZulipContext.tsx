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
} from '../api/types';

// ── Presence helpers ──────────────────────────────────
export type UserStatus = 'online' | 'idle' | 'offline';

interface PresenceMap {
  [userId: number]: { status: UserStatus; timestamp: number };
}

// ── DM conversation ───────────────────────────────────
export interface DmConversation {
  userId: number;
  lastMessageTimestamp: number;
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
  typingUsers: { userId: number; timestamp: number }[];
  unreadCounts: { streams: Record<string, number>; pms: Record<number, number> };
  dmConversations: DmConversation[];
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
  addReaction: (messageId: number, emojiName: string) => Promise<void>;
  removeReaction: (messageId: number, emojiName: string) => Promise<void>;
  markMessagesAsRead: (messageIds: number[]) => Promise<void>;
  sendTyping: (to: number[], op: 'start' | 'stop') => Promise<void>;
  searchMessages: (query: string) => Promise<ZulipMessage[]>;
  getUserStatus: (userId: number) => UserStatus;
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
    { userId: number; timestamp: number }[]
  >([]);
  const [unreadCounts, setUnreadCounts] = useState<{
    streams: Record<string, number>;
    pms: Record<number, number>;
  }>({ streams: {}, pms: {} });
  const [dmConversations, setDmConversations] = useState<DmConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const currentNarrowRef = useRef<ZulipNarrow[]>([]);

  const eventLoopRef = useRef<boolean>(false);
  const queueIdRef = useRef<string | null>(null);
  const apiRef = useRef<ZulipApi | null>(null);

  // Keep ref in sync
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  // ── Event loop ────────────────────────────────────────
  const startEventLoop = useCallback(
    async (zApi: ZulipApi) => {
      try {
        const reg = await zApi.registerEventQueue();
        queueIdRef.current = reg.queue_id;
        let lastEventId = reg.last_event_id;

        // Process initial unread counts
        if (reg.unread_msgs) {
          const streamCounts: Record<string, number> = {};
          for (const s of reg.unread_msgs.streams) {
            const key = `${s.stream_id}:${s.topic}`;
            streamCounts[key] = s.unread_message_ids.length;
          }
          const pmCounts: Record<number, number> = {};
          for (const pm of reg.unread_msgs.pms) {
            pmCounts[pm.sender_id] = pm.unread_message_ids.length;
          }
          setUnreadCounts({ streams: streamCounts, pms: pmCounts });
        }

        eventLoopRef.current = true;

        while (eventLoopRef.current) {
          try {
            const eventsRes = await zApi.getEvents(
              reg.queue_id,
              lastEventId
            );
            for (const event of eventsRes.events) {
              lastEventId = event.id;

              switch (event.type) {
                case 'message': {
                  const me = event as MessageEvent;
                  setMessages((prev) => {
                    if (prev.some((m) => m.id === me.message.id)) return prev;
                    return [...prev, me.message];
                  });
                  // Update DM conversations if this is a DM
                  if (me.message.type === 'private' && Array.isArray(me.message.display_recipient)) {
                    const otherUsers = (me.message.display_recipient as { id: number }[])
                      .filter((r) => r.id !== me.message.sender_id || me.message.display_recipient.length === 1)
                      .map((r) => r.id);
                    // For the sender if they're someone else
                    const dmUserId = me.message.sender_id;
                    setDmConversations((prev) => {
                      const filtered = prev.filter((d) => d.userId !== dmUserId);
                      return [{ userId: dmUserId, lastMessageTimestamp: me.message.timestamp }, ...filtered];
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
                  if (te.op === 'start') {
                    setTypingUsers((prev) => {
                      if (prev.some((t) => t.userId === te.sender.user_id))
                        return prev;
                      return [
                        ...prev,
                        { userId: te.sender.user_id, timestamp: Date.now() },
                      ];
                    });
                  } else {
                    setTypingUsers((prev) =>
                      prev.filter((t) => t.userId !== te.sender.user_id)
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
            }
          } catch (err) {
            if (!eventLoopRef.current) break;
            // Reconnect on error after a brief delay
            await new Promise((r) => setTimeout(r, 5000));
          }
        }
      } catch (err) {
        console.error('Failed to start event queue:', err);
      }
    },
    []
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

      // Build DM conversation list from recent DM messages
      const dmMap = new Map<number, number>(); // userId → latest timestamp
      for (const msg of dmRes.messages) {
        // For DMs, display_recipient is an array of users
        if (Array.isArray(msg.display_recipient)) {
          for (const recipient of msg.display_recipient) {
            if (recipient.id !== profile.user_id) {
              const existing = dmMap.get(recipient.id);
              if (!existing || msg.timestamp > existing) {
                dmMap.set(recipient.id, msg.timestamp);
              }
            }
          }
        }
      }
      const dmConvos: DmConversation[] = Array.from(dmMap.entries())
        .map(([userId, lastMessageTimestamp]) => ({ userId, lastMessageTimestamp }))
        .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
      setDmConversations(dmConvos);

      setLoading(false);

      // Cache credentials for auto-login
      localStorage.setItem(
        'zulip_credentials',
        JSON.stringify({ server, email, apiKey })
      );

      // Start event loop in background
      startEventLoop(zApi);

      return profile;
    },
    [startEventLoop]
  );

  const logout = useCallback(() => {
    eventLoopRef.current = false;
    if (queueIdRef.current && apiRef.current) {
      apiRef.current.deleteEventQueue(queueIdRef.current).catch(() => {});
    }
    localStorage.removeItem('zulip_credentials');
    setApi(null);
    setCurrentUser(null);
    setUsers([]);
    setSubscriptions([]);
    setTopics({});
    setMessages([]);
    setPresence({});
    setTypingUsers([]);
    setUnreadCounts({ streams: {}, pms: {} });
    setDmConversations([]);
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
      setLoading(true);
      currentNarrowRef.current = narrow;
      const res = await api.getMessages({ narrow, num_before: 50, num_after: 0 });
      setMessages(res.messages);
      setHasMoreMessages(!res.found_oldest);
      setLoading(false);
    },
    [api]
  );

  const loadOlderMessages = useCallback(
    async () => {
      if (!api || loadingOlder || !hasMoreMessages || messages.length === 0) return;
      setLoadingOlder(true);
      const oldestId = messages[0].id;
      const res = await api.getMessages({
        narrow: currentNarrowRef.current,
        anchor: oldestId,
        num_before: 50,
        num_after: 0,
      });
      // Remove the anchor message (it's already in our list)
      const olderMessages = res.messages.filter((m) => m.id < oldestId);
      if (olderMessages.length > 0) {
        setMessages((prev) => [...olderMessages, ...prev]);
      }
      setHasMoreMessages(!res.found_oldest);
      setLoadingOlder(false);
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
    async (messageId: number, emojiName: string) => {
      if (!api) return;
      await api.addReaction(messageId, emojiName);
    },
    [api]
  );

  const removeReaction = useCallback(
    async (messageId: number, emojiName: string) => {
      if (!api) return;
      await api.removeReaction(messageId, emojiName);
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
    },
    [api]
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

  // Fetch a URL with auth and return a blob URL (for images in messages)
  const blobCache = useRef<Map<string, string>>(new Map());
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
        resolveUrl,
        fetchAuthenticatedUrl,
      }}
    >
      {children}
    </ZulipContext.Provider>
  );
}
