import type {
  ZulipUser,
  ZulipNarrow,
  GetMessagesResponse,
  GetUsersResponse,
  GetSubscriptionsResponse,
  GetTopicsResponse,
  SendMessageResponse,
  UploadFileResponse,
  RegisterEventQueueResponse,
  GetEventsResponse,
  UpdateMessageFlagsResponse,
  GetPresenceResponse,
  TypingTarget,
} from './types';
import { platform } from '../platform';

// btoa() throws on any code point above U+00FF. Encode to UTF-8 bytes first
// so non-ASCII email addresses can authenticate.
function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// Carries the HTTP status and Zulip's machine-readable `code` (e.g.
// BAD_EVENT_QUEUE_ID, UNAUTHORIZED) so callers can branch on them instead of
// pattern-matching human-readable messages.
export class ZulipApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ZulipApiError';
  }
}

/** True when the server rejected the credentials themselves, as opposed to being unreachable. */
export function isAuthError(err: unknown): boolean {
  return err instanceof ZulipApiError && (err.status === 401 || err.status === 403);
}

export class ZulipApi {
  private baseUrl: string;
  public authHeader: string;

  constructor(serverUrl: string, email: string, apiKey: string) {
    // Whether we can reach the server directly or have to go through a dev
    // proxy is a property of the shell we're running in, not of this class.
    this.baseUrl = platform.apiBaseUrl(serverUrl);
    // btoa() only handles Latin-1; API keys are ASCII but email addresses can
    // carry non-ASCII characters, which would throw here.
    this.authHeader = 'Basic ' + toBase64(`${email}:${apiKey}`);
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await platform.fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ZulipApiError(
        body.msg || `API error: ${response.status} ${response.statusText}`,
        response.status,
        typeof body.code === 'string' ? body.code : undefined
      );
    }

    return response.json();
  }

  private encodeParams(params: Record<string, unknown>): string {
    return Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(
        ([k, v]) =>
          `${encodeURIComponent(k)}=${encodeURIComponent(
            typeof v === 'object' ? JSON.stringify(v) : String(v)
          )}`
      )
      .join('&');
  }

  // ── Auth ──────────────────────────────────────────────
  async getProfile(): Promise<ZulipUser> {
    const res = await this.request<{ result: string; msg: string } & Partial<ZulipUser>>(
      '/users/me'
    );
    // Older Zulip versions nest the user object differently or omit fields
    // we depend on. Validate the shape so downstream code can rely on
    // user_id / email being present without ?-chaining everywhere.
    if (typeof res.user_id !== 'number' || typeof res.email !== 'string') {
      throw new Error(
        '/users/me response is missing user_id or email — incompatible Zulip server version'
      );
    }
    return res as ZulipUser;
  }

  // ── Users ─────────────────────────────────────────────
  async getUsers(): Promise<GetUsersResponse> {
    return this.request('/users');
  }

  // ── Presence ──────────────────────────────────────────
  async getRealmPresence(): Promise<GetPresenceResponse> {
    return this.request('/realm/presence');
  }

  // POST /users/me/presence — ping our own status AND receive fresh presences
  // for all users in the realm. Zulip clients are expected to call this on a
  // regular interval (~60s) to keep presence data warm.
  async updatePresence(
    status: 'active' | 'idle' = 'active',
    pingOnly: boolean = false
  ): Promise<GetPresenceResponse & { server_timestamp: number }> {
    const body = this.encodeParams({
      status,
      ping_only: pingOnly,
      new_user_input: status === 'active',
      slim_presence: false,
    });
    return this.request('/users/me/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  // ── Streams / Subscriptions ───────────────────────────
  async getSubscriptions(): Promise<GetSubscriptionsResponse> {
    return this.request('/users/me/subscriptions');
  }

  async getTopics(streamId: number): Promise<GetTopicsResponse> {
    return this.request(`/users/me/${streamId}/topics`);
  }

  // ── Messages ──────────────────────────────────────────
  async getMessages(params: {
    narrow: ZulipNarrow[];
    anchor?: string | number;
    num_before?: number;
    num_after?: number;
    apply_markdown?: boolean;
    signal?: AbortSignal;
  }): Promise<GetMessagesResponse> {
    const query = this.encodeParams({
      narrow: params.narrow,
      anchor: params.anchor ?? 'newest',
      num_before: params.num_before ?? 50,
      num_after: params.num_after ?? 0,
      apply_markdown: params.apply_markdown ?? true,
    });
    return this.request(`/messages?${query}`, { signal: params.signal });
  }

  async sendMessage(params: {
    type: 'stream' | 'direct';
    to: string | number | number[];
    topic?: string;
    content: string;
  }): Promise<SendMessageResponse> {
    const body = this.encodeParams({
      type: params.type,
      to: params.type === 'direct' ? JSON.stringify(params.to) : params.to,
      topic: params.topic,
      content: params.content,
    });
    return this.request('/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  // Fetch the raw markdown source of a message — needed to seed the
  // inline edit UI, since the cached `messages` array stores rendered HTML.
  async getMessageRaw(messageId: number): Promise<string> {
    const res = await this.request<{ result: string; msg: string; raw_content?: string }>(
      `/messages/${messageId}?apply_markdown=false`
    );
    return res.raw_content ?? '';
  }

  async editMessage(
    messageId: number,
    params: {
      content?: string;
      topic?: string;
      /** For topic edits: 'change_all' moves the whole topic, not just this message. */
      propagate_mode?: 'change_one' | 'change_later' | 'change_all';
    }
  ): Promise<{ result: string; msg: string }> {
    const body = this.encodeParams(params);
    return this.request(`/messages/${messageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  async deleteMessage(
    messageId: number
  ): Promise<{ result: string; msg: string }> {
    return this.request(`/messages/${messageId}`, { method: 'DELETE' });
  }

  // ── Reactions ─────────────────────────────────────────
  async addReaction(
    messageId: number,
    emojiName: string,
    emojiCode?: string,
    reactionType?: string
  ): Promise<{ result: string; msg: string }> {
    const params: Record<string, string> = { emoji_name: emojiName };
    if (emojiCode) params.emoji_code = emojiCode;
    if (reactionType) params.reaction_type = reactionType;
    const body = this.encodeParams(params);
    return this.request(`/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  async removeReaction(
    messageId: number,
    emojiName: string,
    emojiCode?: string,
    reactionType?: string
  ): Promise<{ result: string; msg: string }> {
    const params: Record<string, string> = { emoji_name: emojiName };
    if (emojiCode) params.emoji_code = emojiCode;
    if (reactionType) params.reaction_type = reactionType;
    const body = this.encodeParams(params);
    return this.request(`/messages/${messageId}/reactions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  // Marks every message read. The server answers with an
  // update_message_flags `all` event, which clears the local badges.
  async markAllAsRead(): Promise<{ result: string; msg: string }> {
    return this.request('/mark_all_as_read', { method: 'POST' });
  }

  // ── Message Flags (read, starred, etc.) ───────────────
  async updateMessageFlags(params: {
    messages: number[];
    op: 'add' | 'remove';
    flag: string;
  }): Promise<UpdateMessageFlagsResponse> {
    const body = this.encodeParams({
      messages: params.messages,
      op: params.op,
      flag: params.flag,
    });
    return this.request('/messages/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  // ── Typing ────────────────────────────────────────────
  // DMs address users by id; channel typing (Zulip 8.0+) addresses one
  // topic by stream_id + topic.
  async sendTypingNotification(
    params: { op: 'start' | 'stop' } & TypingTarget
  ): Promise<{ result: string; msg: string }> {
    const body = this.encodeParams(
      params.type === 'stream'
        ? { op: params.op, type: 'stream', stream_id: params.streamId, topic: params.topic }
        : { op: params.op, type: 'direct', to: params.to }
    );
    return this.request('/typing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  // ── File Upload ───────────────────────────────────────
  async uploadFile(file: File): Promise<UploadFileResponse> {
    const formData = new FormData();
    formData.append('file', file);
    return this.request('/user_uploads', {
      method: 'POST',
      body: formData,
    });
  }

  // ── Event Queue ───────────────────────────────────────
  async registerEventQueue(params?: {
    event_types?: string[];
    narrow?: ZulipNarrow[];
    all_public_streams?: boolean;
    fetch_event_types?: string[];
  }): Promise<RegisterEventQueueResponse> {
    const eventTypes = params?.event_types ?? [
      'message',
      'update_message',
      'delete_message',
      'reaction',
      'presence',
      'stream',
      'subscription',
      'typing',
      'update_message_flags',
      'user_status',
    ];
    const body = this.encodeParams({
      event_types: eventTypes,
      // Initial state we read but don't need live events for: our own
      // status/invisible setting, and the realm's GIPHY key.
      fetch_event_types: params?.fetch_event_types ?? [
        ...eventTypes,
        'user_settings',
        'realm',
      ],
      all_public_streams: params?.all_public_streams ?? false,
      apply_markdown: true,
      client_gravatar: false,
      // Without this, delete_message events carry a single `message_id`
      // rather than the `message_ids` array we handle.
      client_capabilities: { bulk_message_deletion: true },
    });
    return this.request('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  async getEvents(
    queueId: string,
    lastEventId: number,
    signal?: AbortSignal
  ): Promise<GetEventsResponse> {
    const query = this.encodeParams({
      queue_id: queueId,
      last_event_id: lastEventId,
    });
    return this.request(`/events?${query}`, { signal });
  }

  async deleteEventQueue(
    queueId: string
  ): Promise<{ result: string; msg: string }> {
    const body = this.encodeParams({ queue_id: queueId });
    return this.request('/events', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  // ── User Status ───────────────────────────────────────
  async updateStatus(params: {
    status_text?: string;
    away?: boolean;
    emoji_name?: string;
    emoji_code?: string;
    reaction_type?: string;
  }): Promise<{ result: string; msg: string }> {
    const body = this.encodeParams(params);
    return this.request('/users/me/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  // ── User Settings ─────────────────────────────────────
  async updateSettings(
    params: Record<string, string | number | boolean>
  ): Promise<{ result: string; msg: string }> {
    const body = this.encodeParams(params);
    return this.request('/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  // ── Subscription Properties ────────────────────────────
  async updateSubscriptionProperty(
    streamId: number,
    property: string,
    value: boolean | string | number
  ): Promise<{ result: string; msg: string }> {
    const body = this.encodeParams({
      subscription_data: JSON.stringify([{ stream_id: streamId, property, value }]),
    });
    return this.request('/users/me/subscriptions/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }
}
