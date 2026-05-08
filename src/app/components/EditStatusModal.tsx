import { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { X, Smile } from 'lucide-react';
import { useZulip } from '../context/ZulipContext';
import { EmojiPicker, type EmojiReaction } from './EmojiPicker';

interface EditStatusModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditStatusModal({ open, onOpenChange }: EditStatusModalProps) {
  const { userStatusText, userStatusEmoji, updateUserStatus, resolveUrl, realmEmoji } = useZulip();
  const [text, setText] = useState(userStatusText);
  const [emoji, setEmoji] = useState(userStatusEmoji);
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);

  // Sync state when modal opens
  useEffect(() => {
    if (open) {
      setText(userStatusText);
      setEmoji(userStatusEmoji);
      setShowPicker(false);
    }
  }, [open, userStatusText, userStatusEmoji]);

  // Close picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        showPicker &&
        pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
        emojiBtnRef.current && !emojiBtnRef.current.contains(e.target as Node)
      ) {
        setShowPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPicker]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Zulip's POST /users/me/status rejects reaction_type='' (must be
      // 'unicode_emoji' or 'realm_emoji'). When the user wants to clear
      // the emoji we send empty emoji_name + emoji_code and OMIT
      // reaction_type — encodeParams drops undefined fields. When an
      // emoji is set we send all three together.
      await updateUserStatus(
        emoji
          ? {
              status_text: text,
              emoji_name: emoji.name,
              emoji_code: emoji.code,
              reaction_type: emoji.type,
            }
          : {
              status_text: text,
              emoji_name: '',
              emoji_code: '',
              reaction_type: undefined,
            }
      );
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to update status:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      // Same reasoning as handleSave: omit reaction_type when clearing,
      // since Zulip rejects an empty value for it.
      await updateUserStatus({
        status_text: '',
        emoji_name: '',
        emoji_code: '',
        reaction_type: undefined,
      });
      setText('');
      setEmoji(null);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleEmojiReact = (reaction: EmojiReaction) => {
    setEmoji({ name: reaction.emojiName, code: reaction.emojiCode, type: reaction.reactionType });
    setShowPicker(false);
  };

  const renderEmojiDisplay = () => {
    if (!emoji) return <Smile className="size-5 text-gray-400" />;
    if (emoji.type === 'realm_emoji') {
      const custom = realmEmoji[emoji.code];
      if (custom) {
        return <img src={resolveUrl(custom.source_url)} alt={emoji.name} className="size-5 object-contain" />;
      }
    }
    try {
      const codePoints = emoji.code.split('-').map((cp) => parseInt(cp, 16));
      return <span className="text-lg">{String.fromCodePoint(...codePoints)}</span>;
    } catch {
      return <span className="text-sm">:{emoji.name}:</span>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-surface-secondary border-surface-tertiary text-text-primary">
        <DialogHeader>
          <DialogTitle className="text-text-primary">Set a status</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Status input with emoji button */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                ref={emojiBtnRef}
                onClick={() => setShowPicker(!showPicker)}
                className="size-10 flex items-center justify-center rounded-md bg-surface-tertiary hover:bg-surface-hover transition-colors"
              >
                {renderEmojiDisplay()}
              </button>

              {showPicker && (
                <div ref={pickerRef} className="absolute top-full left-0 mt-2 z-50">
                  <EmojiPicker
                    onSelect={() => {}}
                    onReact={handleEmojiReact}
                  />
                </div>
              )}
            </div>

            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What's your status?"
              className="flex-1 h-10 px-3 rounded-md bg-surface-tertiary border border-surface-tertiary text-text-primary placeholder:text-text-muted text-sm outline-none focus:ring-1 focus:ring-brand"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
            />

            {(text || emoji) && (
              <button
                onClick={() => { setText(''); setEmoji(null); }}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-between">
            <Button
              variant="outline"
              onClick={handleClear}
              disabled={saving}
              className="border-surface-hover text-text-secondary hover:bg-surface-hover"
            >
              Clear status
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-brand hover:bg-brand-hover text-white"
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
