import { useState, useCallback, useRef, useEffect } from 'react';
import { AtSign, Check, ChevronRight, Hash, Loader2, Lock, Search, Star, Undo2, UserPlus, Users } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { Sidebar, type SpecialView } from './components/Sidebar';
import { MessageList } from './components/MessageList';
import { RichComposer, type RichComposerHandle } from './components/RichComposer';
import { ProfileDropdown } from './components/ProfileDropdown';
import { SearchPalette } from './components/SearchPalette';
import { InboxView } from './components/InboxView';
import { NewDmDialog } from './components/NewDmDialog';
import { SignIn } from './components/SignIn';
import { EditStatusModal } from './components/EditStatusModal';
import { SettingsModal, type Density } from './components/SettingsModal';
import { UpdateBanner } from './components/UpdateBanner';
import { ZulipProvider, useZulip, dmKey } from './context/ZulipContext';
import type { ZulipMessage } from './api/types';
import { buildQuote, excerptFromHtml, messagePermalink } from './lib/zulipMarkdown';

// Themes that render light-on-dark. These get the `.dark` class so Tailwind's
// dark: variants keep working, and they decide the toast palette.
const DARK_THEMES = new Set([
  'dark', 'ink', 'dracula', 'catppuccin', 'gruvbox',
  'solarized-dark', 'nord', 'tokyo-night', 'one-dark',
]);

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
    getMessageRaw,
    serverUrl,
    presenceEnabled,
    setInvisible,
    unreadCounts,
    hasNewerMessages,
    jumpToPresent,
    setMessageOpener,
    clearNarrow,
    loadTopics,
    messages,
    renameTopic,
    connectionError,
  } = useZulip();

  // Named so the quote handler's dependency list reads clearly.
  const composerQuoteSource = useCallback(
    (message: ZulipMessage) => getMessageRaw(message.id),
    [getMessageRaw]
  );

  const composerRef = useRef<RichComposerHandle>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  // Inbox / Mentions / Starred. Exclusive with activeDM and activeTopic;
  // the app opens on the Inbox.
  const [activeSpecial, setActiveSpecial] = useState<SpecialView | null>('inbox');
  const [searchOpen, setSearchOpen] = useState(false);
  // New DM / group picker, optionally seeded with people (Add people).
  const [newDm, setNewDm] = useState<{ open: boolean; seed: number[] }>({ open: false, seed: [] });
  const [density, setDensity] = useState<Density>(() =>
    localStorage.getItem('zulipplus_density') === 'comfortable' ? 'comfortable' : 'compact'
  );
  const [resolving, setResolving] = useState(false);
  // Only surface a connection problem that lasts: a single failed poll that
  // recovers on the next try isn't worth flashing a banner for.
  const [showConnectionError, setShowConnectionError] = useState(false);
  useEffect(() => {
    if (!connectionError) {
      setShowConnectionError(false);
      return;
    }
    const t = setTimeout(() => setShowConnectionError(true), 4000);
    return () => clearTimeout(t);
  }, [connectionError]);
  // Sorted user IDs of all participants in the active DM/huddle (includes self).
  const [activeDM, setActiveDM] = useState<number[] | null>(null);
  const [activeTopic, setActiveTopic] = useState<{
    streamId: number;
    topicName: string;
  } | null>(null);
  const [theme, setTheme] = useState<string>(
    () => localStorage.getItem('zulipplus_theme') || 'dark'
  );
  const [accentColor, setAccentColor] = useState<string>(() => {
    const saved = localStorage.getItem('zulipplus_accent');
    // The old Discord-blurple default moves to the new default with the
    // redesign; a colour the user actually picked is kept.
    return !saved || saved.toLowerCase() === '#5865f2' ? '#5e6ad2' : saved;
  });
  const [editStatusOpen, setEditStatusOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Apply theme to document root + persist. Light-on-dark themes get the `.dark`
  // class (so Tailwind dark: variants still work); all other themes also set a
  // `data-theme` attribute that CSS in theme.css picks up to override tokens.
  useEffect(() => {
    const root = document.documentElement;
    if (DARK_THEMES.has(theme)) {
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

  // Unread total in the window title, so it shows on the taskbar entry even
  // when the window is buried. Muted channels don't count, matching the
  // sidebar badges.
  useEffect(() => {
    const muted = new Set(subscriptions.filter((s) => s.is_muted).map((s) => s.stream_id));
    let total = 0;
    for (const [key, n] of Object.entries(unreadCounts.streams)) {
      if (!muted.has(Number(key.split(':', 1)[0]))) total += n;
    }
    for (const n of Object.values(unreadCounts.pms)) total += n;
    document.title = total > 0 ? `(${total}) Zulip+` : 'Zulip+';
  }, [unreadCounts, subscriptions]);

  useEffect(() => {
    localStorage.setItem('zulipplus_density', density);
  }, [density]);

  // Ctrl/Cmd+K opens search from anywhere, including from inside the composer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleLogout = () => {
    logout();
    setActiveDM(null);
    setActiveTopic(null);
    setActiveSpecial('inbox');
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

  // `anchor` opens the conversation centred on that message instead of at
  // the newest one (search results, /near/ links, notification clicks).
  const handleSelectDM = useCallback(
    async (userIds: number[], anchor?: number) => {
      if (!currentUser || userIds.length === 0) return;
      const navId = ++navIdRef.current;
      const sorted = userIds.slice().sort((a, b) => a - b);
      setActiveDM(sorted);
      setActiveTopic(null);
      setActiveSpecial(null);
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
        await loadMessages([{ operator: 'dm', operand }], anchor);
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
    async (streamId: number, topicName: string, anchor?: number) => {
      const navId = ++navIdRef.current;
      setActiveTopic({ streamId, topicName });
      setActiveDM(null);
      setActiveSpecial(null);
      try {
        await loadMessages(
          [
            { operator: 'stream', operand: streamId },
            { operator: 'topic', operand: topicName },
          ],
          anchor
        );
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

  // Inbox shows no messages; Mentions and Starred are message lists drawn
  // from every conversation.
  const handleSelectSpecial = useCallback(
    async (view: SpecialView) => {
      const navId = ++navIdRef.current;
      setActiveSpecial(view);
      setActiveDM(null);
      setActiveTopic(null);
      if (view === 'inbox') {
        clearNarrow();
        return;
      }
      try {
        await loadMessages([
          { operator: 'is', operand: view === 'mentions' ? 'mentioned' : 'starred' },
        ]);
      } catch (err) {
        if (navIdRef.current === navId) {
          toast.error('Couldn’t load messages', {
            description: err instanceof Error ? err.message : undefined,
          });
        }
      }
    },
    [clearNarrow, loadMessages]
  );

  // A channel picked from search: open its most recently active topic.
  const handleOpenChannel = useCallback(
    async (streamId: number) => {
      try {
        const list = await loadTopics(streamId);
        if (list.length > 0) {
          handleSelectTopic(streamId, list[0].name);
        } else {
          toast('That channel has no topics yet');
        }
      } catch (err) {
        toast.error('Couldn’t load that channel', {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [loadTopics, handleSelectTopic]
  );

  // Zulip resolves a topic by renaming it with a "✔ " prefix (and unresolves
  // by removing it). The rename moves every message, so follow it.
  const RESOLVED_PREFIX = '✔ ';
  const handleToggleResolved = useCallback(async () => {
    if (!activeTopic || messages.length === 0) return;
    const { streamId, topicName } = activeTopic;
    const resolved = topicName.startsWith(RESOLVED_PREFIX);
    const next = resolved ? topicName.slice(RESOLVED_PREFIX.length) : RESOLVED_PREFIX + topicName;
    setResolving(true);
    try {
      await renameTopic(messages[messages.length - 1].id, next);
      loadTopics(streamId).catch(() => {});
      await handleSelectTopic(streamId, next);
    } catch (err) {
      toast.error(resolved ? 'Couldn’t unresolve topic' : 'Couldn’t resolve topic', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setResolving(false);
    }
  }, [activeTopic, messages, renameTopic, loadTopics, handleSelectTopic]);

  // Open the conversation a message belongs to, scrolled to that message.
  const openMessage = useCallback(
    (message: ZulipMessage) => {
      if (message.type === 'stream') {
        if (typeof message.stream_id === 'number') {
          handleSelectTopic(message.stream_id, message.subject, message.id);
        }
      } else if (Array.isArray(message.display_recipient) && currentUser) {
        const ids = message.display_recipient.map((r) => r.id);
        if (!ids.includes(currentUser.user_id)) ids.push(currentUser.user_id);
        handleSelectDM(ids, message.id);
      }
    },
    [handleSelectTopic, handleSelectDM, currentUser]
  );

  // Notification clicks land here via the context.
  useEffect(() => {
    setMessageOpener(openMessage);
    return () => setMessageOpener(null);
  }, [setMessageOpener, openMessage]);

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
      // Reading an older stretch of the conversation: the sent message lands
      // at the present, so go there to see it.
      if (hasNewerMessages) jumpToPresent().catch(() => {});
    },
    [activeDM, activeTopic, sendMessage, subscriptions, currentUser, hasNewerMessages, jumpToPresent]
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

  const handleQuote = useCallback(
    async (message: ZulipMessage) => {
      if (!composerRef.current) return;

      // Quote the SOURCE markdown, not the rendered HTML. Scraping text lost
      // mentions, images and nested quotes, and flattened them into prose.
      let raw = '';
      try {
        raw = await composerQuoteSource(message);
      } catch (err) {
        console.error('Failed to fetch raw message for quote:', err);
      }
      if (!raw) {
        // Server refused or returned nothing — a plain-text quote still beats
        // no quote, so degrade rather than dropping the interaction.
        raw = excerptFromHtml(message.content, 2000);
        toast.warning('Quoted as plain text', {
          description: "Couldn't load the original message's formatting.",
        });
      }

      const streamName =
        message.type === 'stream'
          ? subscriptions.find((s) => s.stream_id === message.stream_id)?.name
          : undefined;

      composerRef.current.insertQuote({
        raw: buildQuote({
          rawContent: raw,
          senderName: message.sender_full_name,
          senderId: message.sender_id,
          permalink: messagePermalink(serverUrl, message, streamName) ?? undefined,
        }),
        label: `Quoting ${message.sender_full_name}`,
        preview: excerptFromHtml(message.content),
      });
    },
    [composerQuoteSource, subscriptions, serverUrl]
  );

  // Show sign-in page if not authenticated
  if (!currentUser) {
    return (
      <div className="size-full flex flex-col bg-surface-primary">
        <UpdateBanner />
        <div className="flex-1 min-h-0">
          <SignIn />
        </div>
      </div>
    );
  }

  // Names of the OTHER participants in a DM/huddle (in user_id order).
  const dmOtherNames = (userIds: number[]): string[] => {
    if (!currentUser) return [];
    return userIds
      .filter((id) => id !== currentUser.user_id)
      .map((id) => findUser(id)?.full_name)
      .filter(Boolean) as string[];
  };

  // Compact label for the header / placeholder. Self-DM: "<your name>
  // (you)". Solo: "Alice". Small group (≤3): full list. Large group (4+):
  // "Alice, Bob +N more".
  const dmShortLabel = (userIds: number[]): string => {
    if (!currentUser) return 'Direct message';
    const others = dmOtherNames(userIds);
    if (others.length === 0) return `${currentUser.full_name} (you)`;
    if (others.length <= 3) return others.join(', ');
    return `${others.slice(0, 2).join(', ')} +${others.length - 2} more`;
  };

  const activeStream = activeTopic
    ? subscriptions.find((s) => s.stream_id === activeTopic.streamId)
    : undefined;

  const headerButton =
    'flex items-center gap-1.5 h-7 px-2 rounded-md text-[13px] text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50';

  const renderHeader = () => {
    if (activeDM) {
      const others = activeDM.filter((id) => id !== currentUser.user_id);
      return (
        <>
          {others.length > 1 && <Users className="size-4 text-text-muted shrink-0" />}
          <h1 className="m-0 text-[13px] font-semibold text-text-primary truncate" title={dmOtherNames(activeDM).join(', ')}>
            {dmShortLabel(activeDM)}
          </h1>
          {others.length > 1 && (
            <span className="text-[12px] text-text-muted shrink-0">{others.length + 1} people</span>
          )}
          <div className="ml-auto flex items-center gap-0.5 shrink-0">
            {/* Adding someone makes a new group conversation, as in Zulip:
                a DM's participant set is what identifies it. */}
            <button
              onClick={() => setNewDm({ open: true, seed: others })}
              className={headerButton}
              title="Start a group with these people plus others"
            >
              <UserPlus className="size-3.5" />
              Add people
            </button>
          </div>
        </>
      );
    }
    if (activeTopic) {
      const resolved = activeTopic.topicName.startsWith(RESOLVED_PREFIX);
      return (
        <>
          {activeStream?.invite_only ? (
            <Lock className="size-3.5 shrink-0" style={{ color: activeStream?.color }} />
          ) : (
            <Hash className="size-3.5 shrink-0" style={{ color: activeStream?.color }} />
          )}
          <span className="text-[13px] text-text-secondary shrink-0">{activeStream?.name ?? 'Unknown channel'}</span>
          <ChevronRight className="size-3 text-text-muted shrink-0" />
          <h1 className="m-0 text-[13px] font-semibold text-text-primary truncate">{activeTopic.topicName}</h1>
          <div className="ml-auto flex items-center gap-0.5 shrink-0">
            <button
              onClick={handleToggleResolved}
              disabled={resolving || messages.length === 0}
              className={headerButton}
            >
              {resolving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : resolved ? (
                <Undo2 className="size-3.5" />
              ) : (
                <Check className="size-3.5" />
              )}
              {resolved ? 'Unresolve' : 'Resolve'}
            </button>
          </div>
        </>
      );
    }
    if (activeSpecial === 'mentions') {
      return (
        <>
          <AtSign className="size-4 text-text-muted" />
          <h1 className="m-0 text-[13px] font-semibold text-text-primary">Mentions</h1>
        </>
      );
    }
    if (activeSpecial === 'starred') {
      return (
        <>
          <Star className="size-4 text-text-muted" />
          <h1 className="m-0 text-[13px] font-semibold text-text-primary">Starred</h1>
        </>
      );
    }
    return null;
  };

  // "X is typing…" for the open conversation only.
  const typingText = (() => {
    const expectedKey = activeDM
      ? `dm:${dmKey(activeDM)}`
      : activeTopic
      ? `stream:${activeTopic.streamId}:${activeTopic.topicName}`
      : null;
    if (!expectedKey) return null;
    const names = typingUsers
      .filter((t) => t.conversationKey === expectedKey)
      .map((t) => users.find((u) => u.user_id === t.userId)?.full_name)
      .filter(Boolean) as string[];
    if (names.length === 0) return null;
    return names.length === 1 ? `${names[0]} is typing…` : `${names.join(', ')} are typing…`;
  })();

  const placeholder = activeDM
    ? `Message ${dmShortLabel(activeDM)}`
    : activeTopic
    ? `Message #${activeStream?.name ?? ''} › ${activeTopic.topicName}`
    : '';

  const isConversation = !!(activeDM || activeTopic);
  const isMessageView = isConversation || activeSpecial === 'mentions' || activeSpecial === 'starred';

  return (
    <div className="size-full flex flex-col bg-surface-primary text-text-primary">
      <UpdateBanner />
      <div className="flex-1 flex min-h-0">
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onSelectDM={handleSelectDM}
        onSelectTopic={handleSelectTopic}
        onSelectSpecial={handleSelectSpecial}
        onOpenSearch={() => setSearchOpen(true)}
        onNewDm={() => setNewDm({ open: true, seed: [] })}
        activeDM={activeDM}
        activeTopic={activeTopic}
        activeSpecial={activeSpecial}
        footer={
          <ProfileDropdown
            theme={theme}
            onThemeToggle={() => {
              const lightThemes = new Set(['light', 'paper', 'solarized-light']);
              setTheme(lightThemes.has(theme) ? 'dark' : 'light');
            }}
            isInvisible={!presenceEnabled}
            onToggleInvisible={() => {
              setInvisible(presenceEnabled).catch((err) => {
                toast.error('Couldn’t change visibility', {
                  description: err instanceof Error ? err.message : undefined,
                });
              });
            }}
            onEditStatus={() => setEditStatusOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onLogout={handleLogout}
          />
        }
      />

      <main className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        {showConnectionError && connectionError && (
          <div
            role="status"
            className="shrink-0 flex items-center gap-2 px-6 py-1.5 text-[12px] border-b border-line bg-[color-mix(in_srgb,#d9a23a_14%,transparent)] text-text-primary"
          >
            <Loader2 className="size-3.5 animate-spin text-[#d9a23a]" />
            <span className="font-medium">Can’t reach the server, retrying.</span>
            <span className="text-text-muted truncate">New messages and unread counts won’t update until this clears. ({connectionError})</span>
          </div>
        )}
        {activeSpecial === 'inbox' ? (
          <InboxView onOpenTopic={handleSelectTopic} onOpenDm={handleSelectDM} />
        ) : isMessageView ? (
          <>
            <header className="h-12 shrink-0 border-b border-line pl-6 pr-3 flex items-center gap-2 min-w-0">
              {renderHeader()}
              {!activeTopic && !activeDM && (
                <button
                  onClick={() => setSearchOpen(true)}
                  aria-label="Search"
                  className="ml-auto size-7 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                >
                  <Search className="size-4" />
                </button>
              )}
            </header>

            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="size-6 text-text-muted animate-spin" />
              </div>
            ) : (
              <MessageList
                density={density}
                showRecipients={!isConversation}
                onOpenMessage={openMessage}
                onQuote={isConversation ? handleQuote : undefined}
                onNavigateToTopic={handleSelectTopic}
                onNavigateToDm={handleSelectDM}
              />
            )}

            {isConversation && (
              <>
                <div className="h-[18px] px-7 text-[11px] text-text-muted truncate" aria-live="polite">
                  {typingText}
                </div>
                <RichComposer
                  key={`composer-${activeDM ? dmKey(activeDM) : ''}-${activeTopic?.streamId || ''}-${activeTopic?.topicName || ''}`}
                  ref={composerRef}
                  onSendMessage={handleSendMessage}
                  onFileUpload={handleFileUpload}
                  placeholder={placeholder}
                  typingTarget={
                    activeDM
                      ? { type: 'direct', to: activeDM.filter((id) => id !== currentUser.user_id) }
                      : activeTopic
                      ? { type: 'stream', streamId: activeTopic.streamId, topic: activeTopic.topicName }
                      : null
                  }
                />
              </>
            )}
          </>
        ) : null}
      </main>

      <SearchPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onOpenMessage={openMessage}
        onOpenDm={handleSelectDM}
        onOpenChannel={handleOpenChannel}
      />
      <NewDmDialog
        open={newDm.open}
        onOpenChange={(open) => setNewDm((s) => ({ ...s, open }))}
        initialUserIds={newDm.seed}
        onStart={handleSelectDM}
      />
      <EditStatusModal open={editStatusOpen} onOpenChange={setEditStatusOpen} />
      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        theme={theme}
        onThemeChange={setTheme}
        accentColor={accentColor}
        onAccentChange={setAccentColor}
        density={density}
        onDensityChange={setDensity}
        onLogout={handleLogout}
      />
      <Toaster
        theme={DARK_THEMES.has(theme) ? 'dark' : 'light'}
        position="bottom-right"
        richColors
        closeButton
      />
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
