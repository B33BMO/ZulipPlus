// Mock data for the Zulip client

export interface User {
  id: string;
  name: string;
  status: 'online' | 'idle' | 'busy' | 'offline';
  avatar: string;
  statusMessage?: string;
}

export interface Message {
  id: string;
  userId: string;
  content: string;
  timestamp: Date;
  reactions?: { emoji: string; count: number; users: string[] }[];
}

export interface Topic {
  id: string;
  name: string;
  unreadCount: number;
  messages: Message[];
}

export interface Channel {
  id: string;
  name: string;
  description: string;
  topics: Topic[];
  unreadCount: number;
}

export interface DirectMessage {
  id: string;
  userId: string;
  unreadCount: number;
  messages: Message[];
}

export const currentUser: User = {
  id: 'user-1',
  name: 'You',
  status: 'online',
  avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop',
  statusMessage: 'Building something cool'
};

export const users: User[] = [
  currentUser,
  {
    id: 'user-2',
    name: 'Alice Johnson',
    status: 'online',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop'
  },
  {
    id: 'user-3',
    name: 'Bob Smith',
    status: 'idle',
    avatar: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=100&h=100&fit=crop'
  },
  {
    id: 'user-4',
    name: 'Carol Williams',
    status: 'busy',
    avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop'
  },
  {
    id: 'user-5',
    name: 'David Brown',
    status: 'offline',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop'
  }
];

export const directMessages: DirectMessage[] = [
  {
    id: 'dm-1',
    userId: 'user-2',
    unreadCount: 3,
    messages: [
      {
        id: 'msg-1',
        userId: 'user-2',
        content: 'Hey! Did you see the latest design mockups?',
        timestamp: new Date(Date.now() - 1000 * 60 * 5)
      },
      {
        id: 'msg-2',
        userId: 'user-1',
        content: 'Yes! They look great. I especially like the new color scheme.',
        timestamp: new Date(Date.now() - 1000 * 60 * 3)
      },
      {
        id: 'msg-3',
        userId: 'user-2',
        content: 'Same here. Should we discuss implementation details in the next standup?',
        timestamp: new Date(Date.now() - 1000 * 60 * 1)
      }
    ]
  },
  {
    id: 'dm-2',
    userId: 'user-3',
    unreadCount: 0,
    messages: [
      {
        id: 'msg-4',
        userId: 'user-3',
        content: 'Can you review my PR when you get a chance?',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2)
      },
      {
        id: 'msg-5',
        userId: 'user-1',
        content: 'Sure, I\'ll take a look this afternoon!',
        timestamp: new Date(Date.now() - 1000 * 60 * 60)
      }
    ]
  },
  {
    id: 'dm-3',
    userId: 'user-4',
    unreadCount: 1,
    messages: [
      {
        id: 'msg-6',
        userId: 'user-4',
        content: 'Quick question about the deployment process...',
        timestamp: new Date(Date.now() - 1000 * 60 * 30)
      }
    ]
  }
];

export const channels: Channel[] = [
  {
    id: 'channel-1',
    name: 'general',
    description: 'General discussion',
    unreadCount: 5,
    topics: [
      {
        id: 'topic-1',
        name: 'Welcome!',
        unreadCount: 2,
        messages: [
          {
            id: 'msg-7',
            userId: 'user-2',
            content: 'Welcome to the team! 👋',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
            reactions: [{ emoji: '👋', count: 4, users: ['user-1', 'user-3', 'user-4', 'user-5'] }]
          }
        ]
      },
      {
        id: 'topic-2',
        name: 'Announcements',
        unreadCount: 3,
        messages: [
          {
            id: 'msg-8',
            userId: 'user-4',
            content: 'Team meeting scheduled for tomorrow at 2 PM',
            timestamp: new Date(Date.now() - 1000 * 60 * 120)
          },
          {
            id: 'msg-9',
            userId: 'user-3',
            content: 'Thanks for the heads up!',
            timestamp: new Date(Date.now() - 1000 * 60 * 100)
          }
        ]
      }
    ]
  },
  {
    id: 'channel-2',
    name: 'development',
    description: 'Development discussions',
    unreadCount: 12,
    topics: [
      {
        id: 'topic-3',
        name: 'Code Review',
        unreadCount: 7,
        messages: [
          {
            id: 'msg-10',
            userId: 'user-3',
            content: 'I\'ve refactored the authentication module. Please review!',
            timestamp: new Date(Date.now() - 1000 * 60 * 45)
          },
          {
            id: 'msg-11',
            userId: 'user-2',
            content: 'Looking good! Just left a few minor comments.',
            timestamp: new Date(Date.now() - 1000 * 60 * 30)
          }
        ]
      },
      {
        id: 'topic-4',
        name: 'Bug Reports',
        unreadCount: 5,
        messages: [
          {
            id: 'msg-12',
            userId: 'user-5',
            content: 'Found a bug in the search functionality',
            timestamp: new Date(Date.now() - 1000 * 60 * 20)
          }
        ]
      }
    ]
  },
  {
    id: 'channel-3',
    name: 'design',
    description: 'Design discussions',
    unreadCount: 0,
    topics: [
      {
        id: 'topic-5',
        name: 'UI Mockups',
        unreadCount: 0,
        messages: [
          {
            id: 'msg-13',
            userId: 'user-4',
            content: 'Here are the latest mockups for the dashboard',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3)
          }
        ]
      }
    ]
  }
];
