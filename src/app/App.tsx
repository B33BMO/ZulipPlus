import { useState, useCallback } from 'react';
import { Hash, User, MessageSquare, Loader2 } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { MessageList } from './components/MessageList';
import { RichComposer } from './components/RichComposer';
import { ProfileDropdown } from './components/ProfileDropdown';
import { SearchBar } from './components/SearchBar';
import { SignIn } from './components/SignIn';
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
  } = useZulip();

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<'channels' | 'users'>('channels');
  const [activeDM, setActiveDM] = useState<number | null>(null);
  const [activeTopic, setActiveTopic] = useState<{
    streamId: number;
    topicName: string;
  } | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isInvisible, setIsInvisible] = useState(false);

  const handleLogout = () => {
    logout();
    setActiveDM(null);
    setActiveTopic(null);
  };

  const handleSelectDM = useCallback(
    async (userId: number) => {
      setActiveDM(userId);
      setActiveTopic(null);
      const user = users.find((u) => u.user_id === userId);
      if (user) {
        await loadMessages([
          { operator: 'dm', operand: user.email },
        ]);
      }
    },
    [loadMessages, users]
  );

  const handleSelectTopic = useCallback(
    async (streamId: number, topicName: string) => {
      setActiveTopic({ streamId, topicName });
      setActiveDM(null);
      await loadMessages([
        { operator: 'stream', operand: streamId },
        { operator: 'topic', operand: topicName },
      ]);
    },
    [loadMessages]
  );

  const handleSendMessage = useCallback(
    async (content: string) => {
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
    },
    [activeDM, activeTopic, sendMessage, subscriptions]
  );

  const handleFileUpload = useCallback(
    async (file: File) => {
      return uploadFile(file);
    },
    [uploadFile]
  );

  // Show sign-in page if not authenticated
  if (!currentUser) {
    return <SignIn />;
  }

  // Get current header info
  const getHeaderContent = () => {
    if (activeDM) {
      const user = users.find((u) => u.user_id === activeDM);
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
      const user = users.find((u) => u.user_id === activeDM);
      return `Message ${user?.full_name || ''}`;
    }
    if (activeTopic) {
      return `Message #${subscriptions.find((s) => s.stream_id === activeTopic.streamId)?.name} > ${activeTopic.topicName}`;
    }
    return 'Type a message...';
  };

  return (
    <div
      className={`size-full flex ${theme === 'dark' ? 'bg-[#313338]' : 'bg-white'}`}
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
        <div className="h-12 border-b border-[#1e1f22] px-4 flex items-center justify-between bg-[#313338] flex-shrink-0">
          <div className="flex-1 flex items-center gap-3">
            {getHeaderContent()}
          </div>

          {/* Profile Dropdown */}
          <ProfileDropdown
            theme={theme}
            onThemeToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            isInvisible={isInvisible}
            onToggleInvisible={() => setIsInvisible(!isInvisible)}
            onLogout={handleLogout}
          />
        </div>

        {/* Search Bar */}
        <SearchBar />

        {/* Messages Area */}
        {activeDM || activeTopic ? (
          <>
            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="size-8 text-gray-400 animate-spin" />
              </div>
            ) : (
              <MessageList />
            )}
            {typingText && (
              <div className="px-4 py-1">
                <span className="text-xs text-gray-400 italic">
                  {typingText}
                </span>
              </div>
            )}
            <RichComposer
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
