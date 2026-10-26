// Zulip API type definitions

export interface ZulipUser {
  user_id: number;
  email: string;
  full_name: string;
  avatar_url: string;
  is_bot: boolean;
  is_admin: boolean;
  is_active: boolean;
  date_joined: string;
  timezone: string;
  role: number;
  delivery_email?: string;
}

export interface ZulipPresence {
  [client: string]: {
    status: 'active' | 'idle';
    timestamp: number;
  };
}

/** Per-user presence: an `aggregated` roll-up plus one entry per client. */
export interface ZulipUserPresence {
  aggregated?: {
    status: 'active' | 'idle' | 'offline';
    timestamp: number;
  };
  [client: string]:
    | { status: 'active' | 'idle' | 'offline'; timestamp: number }
    | undefined;
}

export interface ZulipRealmPresence {
  [email: string]: ZulipUserPresence;
}

export interface ZulipStream {
  stream_id: number;
  name: string;
  description: string;
  invite_only: boolean;
  is_web_public: boolean;
  stream_post_policy: number;
  history_public_to_subscribers: boolean;
  date_created: number;
  rendered_description: string;
}

export interface ZulipSubscription extends ZulipStream {
  color: string;
  pin_to_top: boolean;
  is_muted: boolean;
  desktop_notifications: boolean | null;
  audible_notifications: boolean | null;
  push_notifications: boolean | null;
  email_notifications: boolean | null;
  in_home_view: boolean;
  unread_count?: number;
}

export interface ZulipTopic {
  name: string;
  max_id: number;
}

export interface ZulipMessage {
  id: number;
  sender_id: number;
  sender_email: string;
  sender_full_name: string;
  avatar_url: string;
  content: string;
  rendered_content: string;
  timestamp: number;
  subject: string; // topic name
  type: 'stream' | 'private';
  stream_id?: number;
  display_recipient: string | ZulipDisplayRecipient[];
  reactions: ZulipReaction[];
  flags: string[];
  content_type: string;
  is_me_message: boolean;
  // Set by Zulip when a message has been edited; used by the UI to show
  // an "(edited)" affordance.
  last_edit_timestamp?: number;
}

export interface ZulipDisplayRecipient {
  id: number;
  email: string;
  full_name: string;
}

export interface ZulipReaction {
  emoji_name: string;
  emoji_code: string;
  reaction_type: string;
  user_id: number;
  user: {
    user_id: number;
    email: string;
    full_name: string;
  };
}

/** Who a typing notification is about: a DM's other participants, or one topic. */
export type TypingTarget =
  | { type: 'direct'; to: number[] }
  | { type: 'stream'; streamId: number; topic: string };

export interface ZulipNarrow {
  operator: string;
  operand: string | number;
  negated?: boolean;
}

// API response types
export interface GetMessagesResponse {
  result: string;
  msg: string;
  messages: ZulipMessage[];
  found_anchor: boolean;
  found_oldest: boolean;
  found_newest: boolean;
}

export interface GetUsersResponse {
  result: string;
  msg: string;
  members: ZulipUser[];
}

export interface GetStreamsResponse {
  result: string;
  msg: string;
  streams: ZulipStream[];
}

export interface GetSubscriptionsResponse {
  result: string;
  msg: string;
  subscriptions: ZulipSubscription[];
}

export interface GetTopicsResponse {
  result: string;
  msg: string;
  topics: ZulipTopic[];
}

export interface SendMessageResponse {
  result: string;
  msg: string;
  id: number;
}

export interface UploadFileResponse {
  result: string;
  msg: string;
  /** Zulip < 10. Removed in favour of `url` in newer servers. */
  uri?: string;
  /** Zulip >= 4.15 / 10.x. Preferred. */
  url?: string;
}

export interface RegisterEventQueueResponse {
  result: string;
  msg: string;
  queue_id: string;
  last_event_id: number;
  /** Always present on /register; gates newer API features. */
  zulip_feature_level?: number;
  max_message_id: number;
  unread_msgs?: {
    count: number;
    pms: { sender_id: number; unread_message_ids: number[] }[];
    streams: { stream_id: number; topic: string; unread_message_ids: number[] }[];
    huddles: { user_ids_string: string; unread_message_ids: number[] }[];
    /** Ids of unread messages that mention you (directly or via a wildcard). */
    mentions?: number[];
  };
  /** From fetch_event_types 'user_status'. Keyed by user id. */
  user_status?: Record<string, ZulipUserStatus>;
  /** From fetch_event_types 'user_settings' (Zulip 5.0+). */
  user_settings?: { presence_enabled?: boolean };
  /** Pre-5.0 servers return this at the top level instead. */
  presence_enabled?: boolean;
  /** From fetch_event_types 'giphy'. Empty string when GIPHY isn't configured. */
  giphy_api_key?: string;
  /** From fetch_event_types 'realm': the organization's display name. */
  realm_name?: string;
  /** From 'realm': the org icon. 'U' = uploaded, 'G' = Gravatar fallback. */
  realm_icon_url?: string;
  realm_icon_source?: 'G' | 'U';
}

export interface ZulipUserStatus {
  status_text?: string;
  emoji_name?: string;
  emoji_code?: string;
  reaction_type?: string;
  away?: boolean;
}

export interface GetEventsResponse {
  result: string;
  msg: string;
  events: ZulipEvent[];
}

export interface ZulipEvent {
  type: string;
  id: number;
  [key: string]: unknown;
}

export interface MessageEvent extends ZulipEvent {
  type: 'message';
  message: ZulipMessage;
  flags: string[];
}

export interface PresenceEvent extends ZulipEvent {
  type: 'presence';
  user_id: number;
  email: string;
  // Per-client entries; some servers also include an `aggregated` roll-up.
  presence: ZulipPresence & { aggregated?: { status: 'active' | 'idle'; timestamp: number } };
  server_timestamp: number;
}

export interface UserStatusEvent extends ZulipEvent, ZulipUserStatus {
  type: 'user_status';
  user_id: number;
}

export interface ReactionEvent extends ZulipEvent {
  type: 'reaction';
  op: 'add' | 'remove';
  message_id: number;
  emoji_name: string;
  emoji_code: string;
  reaction_type: string;
  user_id: number;
  user: { user_id: number; email: string; full_name: string };
}

export interface TypingEvent extends ZulipEvent {
  type: 'typing';
  op: 'start' | 'stop';
  sender: { user_id: number; email: string };
  recipients: { user_id: number; email: string }[];
  message_type: 'private' | 'stream';
  stream_id?: number;
  topic?: string;
}

export interface UpdateMessageEvent extends ZulipEvent {
  type: 'update_message';
  message_id: number;
  /** Every message affected — a topic/stream move touches the whole thread. */
  message_ids?: number[];
  rendered_content?: string;
  content?: string;
  subject?: string;
  orig_subject?: string;
  stream_id?: number;
  new_stream_id?: number;
  edit_timestamp: number;
  /** True for server-side re-renders (link previews etc.), not user edits. */
  rendering_only?: boolean;
}

export interface UpdateMessageFlagsEvent extends ZulipEvent {
  type: 'update_message_flags';
  op: 'add' | 'remove';
  flag: string;
  messages: number[];
  all?: boolean;
  /** Present on op 'remove' for the read flag: where each message lives. */
  message_details?: Record<
    string,
    {
      type: 'stream' | 'private';
      stream_id?: number;
      topic?: string;
      user_ids?: number[];
      mentioned?: boolean;
    }
  >;
}

export interface DeleteMessageEvent extends ZulipEvent {
  type: 'delete_message';
  /** Sent when the client declares the bulk_message_deletion capability. */
  message_ids?: number[];
  /** Legacy single-message form. */
  message_id?: number;
  message_type: 'stream' | 'private';
  stream_id?: number;
  topic?: string;
}

export interface StreamEvent extends ZulipEvent {
  type: 'stream';
  op: 'create' | 'delete' | 'update';
  streams: ZulipStream[];
}

export interface SubscriptionEvent extends ZulipEvent {
  type: 'subscription';
  op: 'add' | 'remove' | 'update' | 'peer_add' | 'peer_remove';
  subscriptions?: ZulipSubscription[];
}

export interface UpdateMessageFlagsResponse {
  result: string;
  msg: string;
  messages: number[];
}

export interface GetPresenceResponse {
  result: string;
  msg: string;
  presences: ZulipRealmPresence;
}
