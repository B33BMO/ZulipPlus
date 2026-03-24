import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Button } from './ui/button';
import { useZulip } from '../context/ZulipContext';
import { Moon, Sun, Palette, User, LogOut, Check } from 'lucide-react';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
  accentColor: string;
  onAccentChange: (color: string) => void;
  onLogout: () => void;
}

const ACCENT_PRESETS = [
  { color: '#5865f2', name: 'Blurple' },
  { color: '#57f287', name: 'Green' },
  { color: '#fee75c', name: 'Yellow' },
  { color: '#ed4245', name: 'Red' },
  { color: '#eb459e', name: 'Pink' },
  { color: '#9b59b6', name: 'Purple' },
  { color: '#e67e22', name: 'Orange' },
  { color: '#1abc9c', name: 'Teal' },
];

type Section = 'appearance' | 'account';

export function SettingsModal({
  open,
  onOpenChange,
  theme,
  onThemeChange,
  accentColor,
  onAccentChange,
  onLogout,
}: SettingsModalProps) {
  const { currentUser, resolveUrl } = useZulip();
  const [activeSection, setActiveSection] = useState<Section>('appearance');
  const [customHex, setCustomHex] = useState(accentColor);

  const handleCustomHex = (hex: string) => {
    setCustomHex(hex);
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      onAccentChange(hex);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 bg-surface-secondary border-surface-tertiary text-text-primary overflow-hidden">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <div className="flex h-[480px]">
          {/* Left sidebar nav */}
          <div className="w-48 bg-surface-tertiary p-3 flex flex-col gap-1 shrink-0">
            <h2 className="text-xs font-semibold text-text-muted uppercase px-2 mb-2">Settings</h2>

            <button
              onClick={() => setActiveSection('appearance')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                activeSection === 'appearance'
                  ? 'bg-surface-hover text-text-primary'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              }`}
            >
              <Palette className="size-4" />
              Appearance
            </button>

            <button
              onClick={() => setActiveSection('account')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                activeSection === 'account'
                  ? 'bg-surface-hover text-text-primary'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              }`}
            >
              <User className="size-4" />
              Account
            </button>
          </div>

          {/* Right content area */}
          <div className="flex-1 p-6 overflow-y-auto">
            {activeSection === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-1">Appearance</h3>
                  <p className="text-sm text-text-muted">Customize how ZulipPlus looks</p>
                </div>

                {/* Theme selection */}
                <div>
                  <label className="text-sm font-medium text-text-secondary mb-3 block">Theme</label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => onThemeChange('dark')}
                      className={`flex-1 p-4 rounded-lg border-2 transition-colors ${
                        theme === 'dark'
                          ? 'border-brand bg-brand/10'
                          : 'border-surface-hover hover:border-text-muted'
                      }`}
                    >
                      <Moon className={`size-6 mx-auto mb-2 ${theme === 'dark' ? 'text-brand' : 'text-text-muted'}`} />
                      <span className={`text-sm block text-center ${theme === 'dark' ? 'text-brand font-medium' : 'text-text-secondary'}`}>
                        Dark
                      </span>
                    </button>

                    <button
                      onClick={() => onThemeChange('light')}
                      className={`flex-1 p-4 rounded-lg border-2 transition-colors ${
                        theme === 'light'
                          ? 'border-brand bg-brand/10'
                          : 'border-surface-hover hover:border-text-muted'
                      }`}
                    >
                      <Sun className={`size-6 mx-auto mb-2 ${theme === 'light' ? 'text-brand' : 'text-text-muted'}`} />
                      <span className={`text-sm block text-center ${theme === 'light' ? 'text-brand font-medium' : 'text-text-secondary'}`}>
                        Light
                      </span>
                    </button>
                  </div>
                </div>

                {/* Accent color */}
                <div>
                  <label className="text-sm font-medium text-text-secondary mb-3 block">Accent Color</label>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {ACCENT_PRESETS.map((preset) => (
                      <button
                        key={preset.color}
                        onClick={() => {
                          onAccentChange(preset.color);
                          setCustomHex(preset.color);
                        }}
                        className="group relative size-10 rounded-full transition-transform hover:scale-110"
                        style={{ backgroundColor: preset.color }}
                        title={preset.name}
                      >
                        {accentColor === preset.color && (
                          <Check className="size-5 text-white absolute inset-0 m-auto drop-shadow-md" />
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Custom hex input */}
                  <div className="flex items-center gap-2">
                    <div
                      className="size-8 rounded-md border border-surface-hover shrink-0"
                      style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(customHex) ? customHex : accentColor }}
                    />
                    <input
                      type="text"
                      value={customHex}
                      onChange={(e) => handleCustomHex(e.target.value)}
                      placeholder="#5865f2"
                      className="h-8 px-3 rounded-md bg-surface-tertiary border border-surface-hover text-text-primary text-sm outline-none focus:ring-1 focus:ring-brand w-28 font-mono"
                    />
                    <span className="text-xs text-text-muted">Custom hex</span>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'account' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-1">Account</h3>
                  <p className="text-sm text-text-muted">Your account information</p>
                </div>

                {currentUser && (
                  <div className="flex items-center gap-4 p-4 bg-surface-tertiary rounded-lg">
                    <Avatar className="size-16">
                      <AvatarImage src={resolveUrl(currentUser.avatar_url)} alt={currentUser.full_name} />
                      <AvatarFallback className="text-xl">{currentUser.full_name[0]}</AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="text-lg font-semibold text-text-primary">{currentUser.full_name}</div>
                      <div className="text-sm text-text-secondary">{currentUser.email}</div>
                      {currentUser.is_admin && (
                        <span className="text-xs bg-brand/20 text-brand px-2 py-0.5 rounded-full mt-1 inline-block">
                          Admin
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-text-secondary">Server</span>
                    <span className="text-sm text-text-primary font-mono">
                      {localStorage.getItem('zulip_credentials') ?
                        JSON.parse(localStorage.getItem('zulip_credentials') || '{}').server || 'Unknown'
                        : 'Unknown'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-text-secondary">Role</span>
                    <span className="text-sm text-text-primary">
                      {currentUser?.is_admin ? 'Administrator' : 'Member'}
                    </span>
                  </div>
                </div>

                <div className="pt-4 border-t border-surface-hover">
                  <Button
                    variant="destructive"
                    onClick={() => {
                      onLogout();
                      onOpenChange(false);
                    }}
                    className="w-full"
                  >
                    <LogOut className="size-4 mr-2" />
                    Log Out
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
