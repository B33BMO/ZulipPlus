import { useState, useCallback, useRef, useEffect } from 'react';
import { Hash, User, Users, MessageSquare, Loader2 } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { Sidebar } from './components/Sidebar';
import { MessageList } from './components/MessageList';
import { RichComposer, type RichComposerHandle } from './components/RichComposer';
import { ProfileDropdown } from './components/ProfileDropdown';
import { SearchBar } from './components/SearchBar';
import { SignIn } from './components/SignIn';
import { EditStatusModal } from './components/EditStatusModal';
import { SettingsModal } from './components/SettingsModal';
import { ZulipProvider, useZulip, dmKey } from './context/ZulipContext';

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
  // Sorted user IDs of all participants in the active DM/huddle (includes self).
  const [activeDM, setActiveDM] = useState<number[] | null>(null);
  const [activeTopic, setActiveTopic] = useState<{
    streamId: number;
    topicName: string;
  } | null>(null);
  const [theme, setTheme] = useState<string>(
    () => localStorage.getItem('zulipplus_theme') || 'dark'
  );
  const [accentColor, setAccentColor] = useState<string>(
    () => localStorage.getItem('zulipplus_accent') || '#5865f2'
  );
  const [isInvisible, setIsInvisible] = useState(false);
  const [editStatusOpen, setEditStatusOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Apply theme to document root + persist. Light-on-dark themes get the `.dark`
  // class (so Tailwind dark: variants still work); all other themes also set a
  // `data-theme` attribute that CSS in theme.css picks up to override tokens.
  useEffect(() => {
    const root = document.documentElement;
    const darkThemes = new Set([
      'dark', 'ink', 'dracula', 'catppuccin', 'gruvbox',
      'solarized-dark', 'nord', 'tokyo-night', 'one-dark',
    ]);
    if (darkThemes.has(theme)) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    if (theme === 'dark' || theme === 'light') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
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
    async (userIds: number[]) => {
      if (!currentUser || userIds.length === 0) return;
      const navId = ++navIdRef.current;
      const sorted = userIds.slice().sort((a, b) => a - b);
      setActiveDM(sorted);
      setActiveTopic(null);
      // Narrow operand: comma-separated emails of OTHER participants.
      // Self-DM is the special case where the only participant is current user.
      const others = sorted.filter((id) => id !== currentUser.user_id);
      const operand = others.length === 0
        ? currentUser.email
        : others
            .map((id) => findUser(id)?.email)
            .filter((e): e is string => !!e)
            .join(',');
      try {
        await loadMessages([{ operator: 'dm', operand }]);
      } catch (err) {
        if (navIdRef.current === navId) {
          console.error('Failed to load DM messages:', err);
          toast.error('Couldn’t load messages', {
            description: err instanceof Error ? err.message : undefined,
          });
        }
      }
    },
    [loadMessages, findUser, currentUser]
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
          toast.error('Couldn’t load messages', {
            description: err instanceof Error ? err.message : undefined,
          });
        }
      }
    },
    [loadMessages]
  );

  const handleSendMessage = useCallback(
    async (content: string) => {
      try {
        if (activeDM && currentUser) {
          // Self-DM: address to self. Otherwise, address to the OTHER participants.
          const others = activeDM.filter((id) => id !== currentUser.user_id);
          const to = others.length === 0 ? [currentUser.user_id] : others;
          await sendMessage({
            type: 'direct',
            to,
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
        toast.error('Message failed to send', {
          description: err instanceof Error ? err.message : undefined,
        });
        throw err;
      }
    },
    [activeDM, activeTopic, sendMessage, subscriptions, currentUser]
  );

  const handleFileUpload = useCallback(
    async (file: File) => {
      try {
        return await uploadFile(file);
      } catch (err) {
        console.error('Upload failed:', err);
        toast.error('Upload failed', {
          description: err instanceof Error ? err.message : undefined,
        });
        throw err;
      }
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

  // Names of the OTHER participants in a DM/huddle (in user_id order).
  const dmOtherNames = (userIds: number[]): string[] => {
    if (!currentUser) return [];
    return userIds
      .filter((id) => id !== currentUser.user_id)
      .map((id) => findUser(id)?.full_name)
      .filter(Boolean) as string[];
  };

  // Compact label for the header / placeholder. Caps at 2 names for groups.
  // Self-DM: "<your name> (you)". Solo: "Alice". Small group (≤3): full list.
  // Large group (4+): "Alice, Bob +N others".
  const dmShortLabel = (userIds: number[]): string => {
    if (!currentUser) return 'Direct Message';
    const others = dmOtherNames(userIds);
    if (others.length === 0) return `${currentUser.full_name} (you)`;
    if (others.length <= 3) return others.join(', ');
    const head = others.slice(0, 2).join(', ');
    return `${head} +${others.length - 2} others`;
  };

  // Full participant list, used as a hover tooltip for groups.
  const dmFullLabel = (userIds: number[]): string => {
    const others = dmOtherNames(userIds);
    if (others.length === 0) return '';
    return others.join(', ');
  };

  // Used internally for placeholder; same as dmShortLabel but inline-ready.
  const dmTitle = dmShortLabel;

  // Get current header info
  const getHeaderContent = () => {
    if (activeDM) {
      const others = currentUser
        ? activeDM.filter((id) => id !== currentUser.user_id)
        : activeDM;
      const isGroup = others.length > 1;
      const fullList = isGroup ? dmFullLabel(activeDM) : undefined;
      return (
        <>
          {isGroup ? (
            <Users className="size-5 text-text-secondary shrink-0" />
          ) : (
            <User className="size-5 text-text-secondary shrink-0" />
          )}
          <h2
            className="font-semibold text-text-primary truncate min-w-0"
            title={fullList}
          >
            {dmShortLabel(activeDM)}
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
          <Hash className="size-5 shrink-0" style={{ color: stream?.color || '#888' }} />
          <h2 className="font-semibold text-text-primary truncate min-w-0">
            {stream?.name}{' '}
            <span className="text-text-secondary font-normal">
              / {activeTopic.topicName}
            </span>
          </h2>
        </>
      );
    }
    return <h2 className="font-semibold text-text-primary">Welcome to Zulip</h2>;
  };

  // Get typing indicator text — only for the conversation currently open.
  const getTypingIndicator = () => {
    if (!activeDM && !activeTopic) return null;
    const expectedKey = activeDM
      ? `dm:${dmKey(activeDM)}`
      : activeTopic
      ? `stream:${activeTopic.streamId}:${activeTopic.topicName}`
      : null;
    if (!expectedKey) return null;
    const typing = typingUsers
      .filter((t) => t.conversationKey === expectedKey)
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
      return `Message ${dmTitle(activeDM)}`;
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
        <div className="h-12 border-b border-surface-tertiary px-4 flex items-center justify-between bg-surface-primary flex-shrink-0 gap-3">
          <div className="flex-1 min-w-0 flex items-center gap-3">
            {getHeaderContent()}
          </div>

          {/* Profile Dropdown */}
          <ProfileDropdown
            theme={theme}
            onThemeToggle={() => {
              const lightThemes = new Set(['light', 'paper', 'solarized-light']);
              setTheme(lightThemes.has(theme) ? 'dark' : 'light');
            }}
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
                <Loader2 className="size-8 text-text-secondary animate-spin" />
              </div>
            ) : (
              <MessageList onQuote={handleQuote} />
            )}
            {typingText && (
              <div className="px-4 py-1">
                <span className="text-xs text-text-secondary italic">
                  {typingText}
                </span>
              </div>
            )}
            <RichComposer
              key={`composer-${activeDM ? dmKey(activeDM) : ''}-${activeTopic?.streamId || ''}-${activeTopic?.topicName || ''}`}
              ref={composerRef}
              onSendMessage={handleSendMessage}
              onFileUpload={handleFileUpload}
              placeholder={getPlaceholder()}
              typingRecipients={
                activeDM && currentUser
                  ? activeDM.filter((id) => id !== currentUser.user_id)
                  : null
              }
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="size-16 text-text-muted mx-auto mb-4" />
              <h3 className="text-2xl font-semibold text-text-primary mb-2">
                Welcome to Zulip
              </h3>
              <p className="text-text-secondary">
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
      <Toaster
        theme={theme}
        position="bottom-right"
        richColors
        closeButton
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
