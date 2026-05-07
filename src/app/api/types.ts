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

export interface ZulipRealmPresence {
  [email: string]: {
    aggregated: {
      status: 'active' | 'idle' | 'offline';
      timestamp: number;
    };
    [client: string]: {
      status: 'active' | 'idle';
      timestamp: number;
    };
  };
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
  uri: string;
}

export interface RegisterEventQueueResponse {
  result: string;
  msg: string;
  queue_id: string;
  last_event_id: number;
  max_message_id: number;
  unread_msgs?: {
    count: number;
    pms: { sender_id: number; unread_message_ids: number[] }[];
    streams: { stream_id: number; topic: string; unread_message_ids: number[] }[];
    huddles: { user_ids_string: string; unread_message_ids: number[] }[];
  };
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
  presence: ZulipPresence;
  server_timestamp: number;
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
  rendered_content?: string;
  content?: string;
  subject?: string;
  edit_timestamp: number;
}

export interface DeleteMessageEvent extends ZulipEvent {
  type: 'delete_message';
  message_ids: number[];
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
