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
  theme: 'dark' | 'light';
  onThemeToggle: () => void;
  isInvisible: boolean;
  onToggleInvisible: () => void;
  onLogout?: () => void;
}

export function ProfileDropdown({
  theme,
  onThemeToggle,
  isInvisible,
  onToggleInvisible,
  onLogout,
}: ProfileDropdownProps) {
  const { currentUser, getUserStatus, resolveUrl } = useZulip();

  const getStatusColor = () => {
    if (isInvisible || !currentUser) return 'bg-gray-500';
    const status = getUserStatus(currentUser.user_id);
    switch (status) {
      case 'online':
        return 'bg-green-500';
      case 'idle':
        return 'bg-yellow-500';
      case 'offline':
        return 'bg-gray-500';
    }
  };

  if (!currentUser) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative">
          <Avatar className="size-9 cursor-pointer hover:opacity-80 transition-opacity">
            <AvatarImage
              src={resolveUrl(currentUser.avatar_url)}
              alt={currentUser.full_name}
            />
            <AvatarFallback>{currentUser.full_name[0]}</AvatarFallback>
          </Avatar>
          <div
            className={`absolute bottom-0 right-0 size-3 rounded-full border-2 border-[#313338] ${getStatusColor()}`}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 bg-[#111214] border-[#1e1f22] text-gray-200"
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
              <div className="font-semibold text-white truncate">
                {currentUser.full_name}
              </div>
              <div className="text-xs text-gray-400 truncate">
                {currentUser.email}
              </div>
            </div>
          </div>
        </div>

        <DropdownMenuSeparator className="bg-[#1e1f22]" />

        <DropdownMenuItem className="focus:bg-[#5865f2] focus:text-white cursor-pointer">
          <User className="size-4 mr-2" />
          Edit Status
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={onToggleInvisible}
          className="focus:bg-[#5865f2] focus:text-white cursor-pointer"
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

        <DropdownMenuSeparator className="bg-[#1e1f22]" />

        <DropdownMenuItem
          onClick={onThemeToggle}
          className="focus:bg-[#5865f2] focus:text-white cursor-pointer"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="size-4 mr-2" />
              Light Mode
            </>
          ) : (
            <>
              <Moon className="size-4 mr-2" />
              Dark Mode
            </>
          )}
        </DropdownMenuItem>

        <DropdownMenuItem className="focus:bg-[#5865f2] focus:text-white cursor-pointer">
          <Settings className="size-4 mr-2" />
          Settings
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-[#1e1f22]" />

        <DropdownMenuItem
          onClick={onLogout}
          className="focus:bg-red-500 focus:text-white cursor-pointer text-red-400"
        >
          <LogOut className="size-4 mr-2" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
