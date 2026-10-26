import { Moon, Sun, Settings, LogOut, User, Eye, EyeOff } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useZulip } from '../context/ZulipContext';

interface ProfileDropdownProps {
  theme: string;
  onThemeToggle: () => void;
  isInvisible: boolean;
  onToggleInvisible: () => void;
  onEditStatus?: () => void;
  onOpenSettings?: () => void;
  onLogout?: () => void;
}

export function ProfileDropdown({
  theme,
  onThemeToggle,
  isInvisible,
  onToggleInvisible,
  onEditStatus,
  onOpenSettings,
  onLogout,
}: ProfileDropdownProps) {
  const { currentUser, getUserStatus, resolveUrl, userStatusText, userStatusEmoji, realmEmoji } = useZulip();

  const getStatusColor = () => {
    if (isInvisible || !currentUser) return 'bg-text-muted';
    const status = getUserStatus(currentUser.user_id);
    switch (status) {
      case 'online':
        return 'bg-[#3fb47c]';
      case 'idle':
        return 'bg-[#d9a23a]';
      case 'offline':
        return 'bg-text-muted';
    }
  };

  if (!currentUser) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="w-full flex items-center gap-2 rounded-md p-1.5 text-left hover:bg-surface-hover outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          aria-label="Account menu"
        >
          <span className="relative shrink-0">
            <Avatar className="size-7 rounded-md">
              <AvatarImage
                src={resolveUrl(currentUser.avatar_url)}
                alt=""
              />
              <AvatarFallback className="rounded-md text-xs">{currentUser.full_name[0]}</AvatarFallback>
            </Avatar>
            <span
              className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-surface-sidebar ${getStatusColor()}`}
            />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-medium text-text-primary truncate leading-4">
              {currentUser.full_name}
            </span>
            <span className="block text-[11px] text-text-muted truncate leading-4">
              {isInvisible ? 'Invisible' : userStatusText || 'Set a status'}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        className="w-60 bg-surface-overlay border-line text-text-primary"
      >
        <div className="px-2 py-3 mb-1">
          <div className="flex items-center gap-2">
            <Avatar className="size-12">
              <AvatarImage
                src={resolveUrl(currentUser.avatar_url)}
                alt={currentUser.full_name}
              />
              <AvatarFallback>{currentUser.full_name[0]}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-text-primary truncate">
                {currentUser.full_name}
              </div>
              <div className="text-xs text-text-secondary truncate">
                {currentUser.email}
              </div>
              {userStatusText && (
                <div className="text-xs text-text-secondary truncate mt-0.5 flex items-center gap-1">
                  {userStatusEmoji && (() => {
                    if (userStatusEmoji.type === 'realm_emoji') {
                      const custom = realmEmoji[userStatusEmoji.code];
                      if (custom) return <img src={resolveUrl(custom.source_url)} alt="" className="size-3.5 inline" />;
                    }
                    try {
                      const cps = userStatusEmoji.code.split('-').map(c => parseInt(c, 16));
                      return <span>{String.fromCodePoint(...cps)}</span>;
                    } catch { return null; }
                  })()}
                  {userStatusText}
                </div>
              )}
            </div>
          </div>
        </div>

        <DropdownMenuSeparator className="bg-line" />

        <DropdownMenuItem onClick={onEditStatus} className="focus:bg-surface-hover focus:text-text-primary cursor-pointer text-[13px]">
          <User className="size-4 mr-2" />
          Edit Status
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={onToggleInvisible}
          className="focus:bg-surface-hover focus:text-text-primary cursor-pointer text-[13px]"
        >
          {isInvisible ? (
            <>
              <Eye className="size-4 mr-2" />
              Go Visible
            </>
          ) : (
            <>
              <EyeOff className="size-4 mr-2" />
              Go Invisible
            </>
          )}
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-line" />

        <DropdownMenuItem
          onClick={onThemeToggle}
          className="focus:bg-surface-hover focus:text-text-primary cursor-pointer text-[13px]"
        >
          {theme === 'light' || theme === 'paper' || theme === 'solarized-light' ? (
            <>
              <Moon className="size-4 mr-2" />
              Dark Mode
            </>
          ) : (
            <>
              <Sun className="size-4 mr-2" />
              Light Mode
            </>
          )}
        </DropdownMenuItem>

        <DropdownMenuItem onClick={onOpenSettings} className="focus:bg-surface-hover focus:text-text-primary cursor-pointer text-[13px]">
          <Settings className="size-4 mr-2" />
          Settings
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-line" />

        <DropdownMenuItem
          onClick={onLogout}
          className="focus:bg-surface-hover focus:text-red-400 cursor-pointer text-red-400 text-[13px]"
        >
          <LogOut className="size-4 mr-2" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
