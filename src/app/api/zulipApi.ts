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
} from './types';

export class ZulipApi {
  private baseUrl: string;
  public authHeader: string;

  constructor(serverUrl: string, email: string, apiKey: string) {
    // In Electron production builds, call the Zulip server directly (no CORS in Electron).
    // In dev mode (Vite dev server), use the proxy to avoid browser CORS.
    const isElectron = !!(window as any).electronAPI?.isElectron;
    const isDev = import.meta.env.DEV;

    if (isElectron && !isDev) {
      // Production Electron — direct API calls
      const normalizedUrl = serverUrl.replace(/\/+$/, '');
      this.baseUrl = `${normalizedUrl}/api/v1`;
    } else {
      // Dev mode (browser or Electron dev) — use Vite proxy
      this.baseUrl = '/zulip-api/api/v1';
    }

    this.authHeader = 'Basic ' + btoa(`${email}:${apiKey}`);
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        body.msg || `API error: ${response.status} ${response.statusText}`
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
    const res = await this.request<{ result: string; msg: string } & ZulipUser>(
      '/users/me'
    );
    return res;
  }

  // ── Users ─────────────────────────────────────────────
  async getUsers(): Promise<GetUsersResponse> {
    return this.request('/users');
  }

  // ── Presence ──────────────────────────────────────────
  async getRealmPresence(): Promise<GetPresenceResponse> {
    return this.request('/realm/presence');
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
  }): Promise<GetMessagesResponse> {
    const query = this.encodeParams({
      narrow: params.narrow,
      anchor: params.anchor ?? 'newest',
      num_before: params.num_before ?? 50,
      num_after: params.num_after ?? 0,
      apply_markdown: params.apply_markdown ?? true,
    });
    return this.request(`/messages?${query}`);
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

  async editMessage(
    messageId: number,
    params: { content?: string; topic?: string }
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
    emojiName: string
  ): Promise<{ result: string; msg: string }> {
    const body = this.encodeParams({ emoji_name: emojiName });
    return this.request(`/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  async removeReaction(
    messageId: number,
    emojiName: string
  ): Promise<{ result: string; msg: string }> {
    const body = this.encodeParams({ emoji_name: emojiName });
    return this.request(`/messages/${messageId}/reactions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
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
  async sendTypingNotification(params: {
    op: 'start' | 'stop';
    to: number[];
    type?: 'direct' | 'stream';
    topic?: string;
  }): Promise<{ result: string; msg: string }> {
    const body = this.encodeParams({
      op: params.op,
      to: params.to,
      type: params.type ?? 'direct',
      topic: params.topic,
    });
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
    const body = this.encodeParams({
      event_types: params?.event_types ?? [
        'message',
        'update_message',
        'delete_message',
        'reaction',
        'presence',
        'stream',
        'subscription',
        'typing',
        'update_message_flags',
      ],
      all_public_streams: params?.all_public_streams ?? false,
      apply_markdown: true,
      client_gravatar: false,
    });
    return this.request('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  async getEvents(
    queueId: string,
    lastEventId: number
  ): Promise<GetEventsResponse> {
    const query = this.encodeParams({
      queue_id: queueId,
      last_event_id: lastEventId,
    });
    return this.request(`/events?${query}`);
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
}
