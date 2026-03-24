import { useState, useCallback, useRef, useEffect } from 'react';
import { Hash, User, MessageSquare, Loader2 } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { MessageList } from './components/MessageList';
import { RichComposer, type RichComposerHandle } from './components/RichComposer';
import { ProfileDropdown } from './components/ProfileDropdown';
import { SearchBar } from './components/SearchBar';
import { SignIn } from './components/SignIn';
import { EditStatusModal } from './components/EditStatusModal';
import { SettingsModal } from './components/SettingsModal';
import { ZulipProvider, useZulip } from './context/ZulipContext';

function AppContent() {
  const {
    currentUser,
    users,
    subscriptions,
    loadMessages,
    sendMessage,
    uploadFile,
    logout,
    loading,
    typingUsers,
    updateUserStatus,
  } = useZulip();

  const composerRef = useRef<RichComposerHandle>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<'channels' | 'users'>('channels');
  const [activeDM, setActiveDM] = useState<number | null>(null);
  const [activeTopic, setActiveTopic] = useState<{
    streamId: number;
    topicName: string;
  } | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('zulipplus_theme') as 'dark' | 'light') || 'dark'
  );
  const [accentColor, setAccentColor] = useState<string>(
    () => localStorage.getItem('zulipplus_accent') || '#5865f2'
  );
  const [isInvisible, setIsInvisible] = useState(false);
  const [editStatusOpen, setEditStatusOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Apply theme class to document root + persist
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('zulipplus_theme', theme);
  }, [theme]);

  // Apply accent color as CSS variable + persist
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand', accentColor);
    // Compute a darker hover variant
    const darken = (hex: string, amount: number) => {
      const num = parseInt(hex.replace('#', ''), 16);
      const r = Math.max(0, (num >> 16) - amount);
      const g = Math.max(0, ((num >> 8) & 0xff) - amount);
      const b = Math.max(0, (num & 0xff) - amount);
      return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
    };
    root.style.setProperty('--brand-hover', darken(accentColor, 30));
    root.style.setProperty('--brand-muted', `${accentColor}33`);
    localStorage.setItem('zulipplus_accent', accentColor);
  }, [accentColor]);

  const handleLogout = () => {
    logout();
    setActiveDM(null);
    setActiveTopic(null);
  };

  const findUser = useCallback(
    (userId: number) => {
      if (currentUser && userId === currentUser.user_id) return currentUser;
      return users.find((u) => u.user_id === userId);
    },
    [users, currentUser]
  );

  // Track the current navigation to prevent race conditions on rapid switching
  const navIdRef = useRef(0);

  const handleSelectDM = useCallback(
    async (userId: number) => {
      const navId = ++navIdRef.current;
      setActiveDM(userId);
      setActiveTopic(null);
      const user = findUser(userId);
      if (user) {
        try {
          await loadMessages([
            { operator: 'dm', operand: user.email },
          ]);
        } catch (err) {
          // Only log if this is still the active navigation
          if (navIdRef.current === navId) {
            console.error('Failed to load DM messages:', err);
          }
        }
      }
    },
    [loadMessages, findUser]
  );

  const handleSelectTopic = useCallback(
    async (streamId: number, topicName: string) => {
      const navId = ++navIdRef.current;
      setActiveTopic({ streamId, topicName });
      setActiveDM(null);
      try {
        await loadMessages([
          { operator: 'stream', operand: streamId },
          { operator: 'topic', operand: topicName },
        ]);
      } catch (err) {
        if (navIdRef.current === navId) {
          console.error('Failed to load topic messages:', err);
        }
      }
    },
    [loadMessages]
  );

  const handleSendMessage = useCallback(
    async (content: string) => {
      try {
        if (activeDM) {
          await sendMessage({
            type: 'direct',
            to: [activeDM],
            content,
          });
        } else if (activeTopic) {
          const stream = subscriptions.find(
            (s) => s.stream_id === activeTopic.streamId
          );
          if (stream) {
            await sendMessage({
              type: 'stream',
              to: stream.name,
              topic: activeTopic.topicName,
              content,
            });
          }
        }
      } catch (err) {
        console.error('Failed to send message:', err);
      }
    },
    [activeDM, activeTopic, sendMessage, subscriptions]
  );

  const handleFileUpload = useCallback(
    async (file: File) => {
      return uploadFile(file);
    },
    [uploadFile]
  );

  const handleQuote = useCallback((senderName: string, content: string) => {
    if (!composerRef.current) return;
    // Format as Zulip quote and insert as raw text so TipTap doesn't parse @**name** as bold
    const quoted = `@**${senderName}** said:\n\`\`\`quote\n${content}\n\`\`\`\n`;
    composerRef.current.insertRawText(quoted);
  }, []);

  // Show sign-in page if not authenticated
  if (!currentUser) {
    return <SignIn />;
  }

  // Get current header info
  const getHeaderContent = () => {
    if (activeDM) {
      const user = findUser(activeDM);
      return (
        <>
          <User className="size-5 text-gray-400" />
          <h2 className="font-semibold text-white">
            {user?.full_name || 'Direct Message'}
          </h2>
        </>
      );
    }
    if (activeTopic) {
      const stream = subscriptions.find(
        (s) => s.stream_id === activeTopic.streamId
      );
      return (
        <>
          <Hash className="size-5" style={{ color: stream?.color || '#888' }} />
          <h2 className="font-semibold text-white">
            {stream?.name}{' '}
            <span className="text-gray-400 font-normal">
              / {activeTopic.topicName}
            </span>
          </h2>
        </>
      );
    }
    return <h2 className="font-semibold text-white">Welcome to Zulip</h2>;
  };

  // Get typing indicator text
  const getTypingIndicator = () => {
    if (!activeDM && !activeTopic) return null;
    const typing = typingUsers
      .map((t) => users.find((u) => u.user_id === t.userId))
      .filter(Boolean);
    if (typing.length === 0) return null;
    const names = typing.map((u) => u!.full_name);
    if (names.length === 1) return `${names[0]} is typing...`;
    return `${names.join(', ')} are typing...`;
  };

  const typingText = getTypingIndicator();

  const getPlaceholder = () => {
    if (activeDM) {
      const user = findUser(activeDM);
      return `Message ${user?.full_name || ''}`;
    }
    if (activeTopic) {
      return `Message #${subscriptions.find((s) => s.stream_id === activeTopic.streamId)?.name} > ${activeTopic.topicName}`;
    }
    return 'Type a message...';
  };

  return (
    <div
      className="size-full flex bg-surface-primary"
    >
      {/* Sidebar */}
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        activeView={activeView}
        onViewChange={setActiveView}
        onSelectDM={handleSelectDM}
        onSelectTopic={handleSelectTopic}
        activeDM={activeDM}
        activeTopic={activeTopic}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Top Bar */}
        <div className="h-12 border-b border-surface-tertiary px-4 flex items-center justify-between bg-surface-primary flex-shrink-0">
          <div className="flex-1 flex items-center gap-3">
            {getHeaderContent()}
          </div>

          {/* Profile Dropdown */}
          <ProfileDropdown
            theme={theme}
            onThemeToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            isInvisible={isInvisible}
            onToggleInvisible={async () => {
              const newState = !isInvisible;
              setIsInvisible(newState);
              await updateUserStatus({ away: newState });
            }}
            onEditStatus={() => setEditStatusOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onLogout={handleLogout}
          />
        </div>

        {/* Search Bar */}
        <SearchBar
          onNavigateToStream={handleSelectTopic}
          onNavigateToDm={handleSelectDM}
        />

        {/* Messages Area */}
        {activeDM || activeTopic ? (
          <>
            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="size-8 text-gray-400 animate-spin" />
              </div>
            ) : (
              <MessageList onQuote={handleQuote} />
            )}
            {typingText && (
              <div className="px-4 py-1">
                <span className="text-xs text-gray-400 italic">
                  {typingText}
                </span>
              </div>
            )}
            <RichComposer
              key={`composer-${activeDM || ''}-${activeTopic?.streamId || ''}-${activeTopic?.topicName || ''}`}
              ref={composerRef}
              onSendMessage={handleSendMessage}
              onFileUpload={handleFileUpload}
              placeholder={getPlaceholder()}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="size-16 text-gray-600 mx-auto mb-4" />
              <h3 className="text-2xl font-semibold text-white mb-2">
                Welcome to Zulip
              </h3>
              <p className="text-gray-400">
                Select a channel or user from the sidebar to start chatting
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <EditStatusModal open={editStatusOpen} onOpenChange={setEditStatusOpen} />
      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        theme={theme}
        onThemeChange={setTheme}
        accentColor={accentColor}
        onAccentChange={setAccentColor}
        onLogout={handleLogout}
      />
    </div>
  );
}

export default function App() {
  return (
    <ZulipProvider>
      <AppContent />
    </ZulipProvider>
  );
}
