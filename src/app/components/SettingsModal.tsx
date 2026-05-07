import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Button } from './ui/button';
import { useZulip } from '../context/ZulipContext';
import { Palette, User, LogOut, Check } from 'lucide-react';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: string;
  onThemeChange: (theme: string) => void;
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

// Each theme has a small preview swatch: [background, surface, text, accent].
// These mirror the values in /src/styles/theme.css so the cards look accurate
// regardless of which theme is currently active.
const THEME_PRESETS: {
  id: string;
  name: string;
  swatch: { bg: string; surface: string; text: string; accent: string };
}[] = [
  { id: 'dark',            name: 'Dark',            swatch: { bg: '#313338', surface: '#2b2d31', text: '#f2f3f5', accent: '#5865f2' } },
  { id: 'light',           name: 'Light',           swatch: { bg: '#ffffff', surface: '#f2f3f5', text: '#060607', accent: '#5865f2' } },
  { id: 'paper',           name: 'Paper',           swatch: { bg: '#ffffff', surface: '#f5f5f5', text: '#000000', accent: '#0050d8' } },
  { id: 'ink',             name: 'Ink',             swatch: { bg: '#000000', surface: '#0a0a0a', text: '#ffffff', accent: '#7cc5ff' } },
  { id: 'dracula',         name: 'Dracula',         swatch: { bg: '#282a36', surface: '#21222c', text: '#f8f8f2', accent: '#bd93f9' } },
  { id: 'catppuccin',      name: 'Catppuccin',      swatch: { bg: '#1e1e2e', surface: '#181825', text: '#cdd6f4', accent: '#cba6f7' } },
  { id: 'gruvbox',         name: 'Gruvbox',         swatch: { bg: '#282828', surface: '#1d2021', text: '#ebdbb2', accent: '#fe8019' } },
  { id: 'solarized-dark',  name: 'Solarized Dark',  swatch: { bg: '#002b36', surface: '#073642', text: '#eee8d5', accent: '#2aa198' } },
  { id: 'solarized-light', name: 'Solarized Light', swatch: { bg: '#fdf6e3', surface: '#eee8d5', text: '#073642', accent: '#2aa198' } },
  { id: 'nord',            name: 'Nord',            swatch: { bg: '#2e3440', surface: '#272c36', text: '#eceff4', accent: '#88c0d0' } },
  { id: 'tokyo-night',     name: 'Tokyo Night',     swatch: { bg: '#1a1b26', surface: '#16161e', text: '#c0caf5', accent: '#bb9af7' } },
  { id: 'one-dark',        name: 'One Dark',        swatch: { bg: '#282c34', surface: '#21252b', text: '#abb2bf', accent: '#c678dd' } },
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
  const { currentUser, resolveUrl, serverUrl } = useZulip();
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
                  <div className="grid grid-cols-3 gap-2">
                    {THEME_PRESETS.map((t) => {
                      const active = theme === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => onThemeChange(t.id)}
                          className={`p-2 rounded-lg border-2 transition-colors text-left ${
                            active ? 'border-brand' : 'border-surface-hover hover:border-text-muted'
                          }`}
                          title={t.name}
                        >
                          {/* Preview */}
                          <div
                            className="h-14 rounded-md mb-2 flex overflow-hidden border border-black/20"
                            style={{ backgroundColor: t.swatch.bg }}
                          >
                            <div className="w-1/3 h-full" style={{ backgroundColor: t.swatch.surface }} />
                            <div className="flex-1 flex flex-col justify-center gap-1 px-2">
                              <div
                                className="h-1.5 rounded-full w-4/5"
                                style={{ backgroundColor: t.swatch.text, opacity: 0.85 }}
                              />
                              <div
                                className="h-1.5 rounded-full w-2/3"
                                style={{ backgroundColor: t.swatch.text, opacity: 0.5 }}
                              />
                              <div
                                className="h-1.5 rounded-full w-1/2"
                                style={{ backgroundColor: t.swatch.accent }}
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-xs font-medium ${
                                active ? 'text-brand' : 'text-text-secondary'
                              }`}
                            >
                              {t.name}
                            </span>
                            {active && <Check className="size-3.5 text-brand" />}
                          </div>
                        </button>
                      );
                    })}
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
                      {serverUrl || 'Unknown'}
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
