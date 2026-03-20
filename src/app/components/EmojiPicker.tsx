import { useState, useEffect, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from './ui/input';
import { useZulip } from '../context/ZulipContext';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

interface CustomEmoji {
  id: string;
  name: string;
  source_url: string;
  deactivated: boolean;
}

// Common emoji categories with unicode emojis
const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    emojis: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃',
      '😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
      '🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢',
      '🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏',
      '😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷',
      '🤒','🤕','🤢','🤮','🥴','😵','🤯','🤠','🥳','🥸',
      '😎','🤓','🧐','😕','🫤','😟','🙁','😮','😯','😲',
      '😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭',
      '😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡',
      '😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺',
    ],
  },
  {
    name: 'Gestures',
    emojis: [
      '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌',
      '🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉',
      '👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛',
      '🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💪',
    ],
  },
  {
    name: 'Hearts',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
      '❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝',
      '💟','♥️','🫶','💑','💏','👫','👬','👭',
    ],
  },
  {
    name: 'Objects',
    emojis: [
      '🔥','⭐','🌟','✨','⚡','💥','🎉','🎊','🎯','🏆',
      '🎮','🎲','🎵','🎶','🎤','🎧','📱','💻','⌨️','🖥️',
      '📸','📷','🔔','🔕','📣','📢','💡','🔦','🏮','📝',
      '📌','📎','🔗','🔒','🔓','🛡️','⚙️','🔧','🔨','💣',
    ],
  },
  {
    name: 'Symbols',
    emojis: [
      '✅','❌','⚠️','🚫','💯','🔴','🟠','🟡','🟢','🔵',
      '🟣','⚫','⚪','🟤','▶️','⏸️','⏹️','⏺️','⏭️','⏮️',
      '🔀','🔁','🔂','➕','➖','➗','✖️','♾️','❓','❗',
      '‼️','⁉️','💲','🔅','🔆','☑️','🔘','🔳','🔲','⬛','⬜',
    ],
  },
];

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const { api, resolveUrl } = useZulip();
  const [search, setSearch] = useState('');
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [activeCategory, setActiveCategory] = useState('Smileys');

  // Fetch custom server emojis
  useEffect(() => {
    if (!api) return;
    (async () => {
      try {
        const res = await (api as any).request<{
          result: string;
          emoji: Record<string, CustomEmoji>;
        }>('/realm/emoji');
        const emojis = Object.values(res.emoji).filter((e) => !e.deactivated);
        setCustomEmojis(emojis);
      } catch {
        // Custom emojis not available
      }
    })();
  }, [api]);

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return EMOJI_CATEGORIES;
    // For search, flatten all emojis and filter (basic search by position — not ideal but simple)
    return EMOJI_CATEGORIES.map((cat) => ({
      ...cat,
      emojis: cat.emojis, // Can't search unicode by name without a mapping, so just show all
    }));
  }, [search]);

  const filteredCustom = useMemo(() => {
    if (!search.trim()) return customEmojis;
    const q = search.toLowerCase();
    return customEmojis.filter((e) => e.name.toLowerCase().includes(q));
  }, [search, customEmojis]);

  return (
    <div className="w-80 h-96 bg-[#2b2d31] border border-[#1e1f22] rounded-lg shadow-xl flex flex-col overflow-hidden">
      {/* Search */}
      <div className="p-2 border-b border-[#1e1f22]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-gray-500" />
          <Input
            type="text"
            placeholder="Search emoji..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-8 h-8 bg-[#1e1f22] border-[#1e1f22] text-gray-200 text-sm placeholder:text-gray-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 px-2 py-1 border-b border-[#1e1f22] overflow-x-auto flex-shrink-0">
        {customEmojis.length > 0 && (
          <button
            onClick={() => setActiveCategory('Custom')}
            className={`px-2 py-1 rounded text-xs whitespace-nowrap ${
              activeCategory === 'Custom'
                ? 'bg-[#5865f2] text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-[#404249]'
            }`}
          >
            Custom
          </button>
        )}
        {EMOJI_CATEGORIES.map((cat) => (
          <button
            key={cat.name}
            onClick={() => setActiveCategory(cat.name)}
            className={`px-2 py-1 rounded text-xs whitespace-nowrap ${
              activeCategory === cat.name
                ? 'bg-[#5865f2] text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-[#404249]'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Emoji grid */}
      <div className="flex-1 overflow-y-auto p-2">
        {activeCategory === 'Custom' && filteredCustom.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 uppercase font-semibold mb-1 px-1">
              Custom
            </p>
            <div className="grid grid-cols-8 gap-0.5">
              {filteredCustom.map((emoji) => (
                <button
                  key={emoji.id}
                  onClick={() => onSelect(`:${emoji.name}:`)}
                  className="size-9 flex items-center justify-center rounded hover:bg-[#404249] cursor-pointer"
                  title={`:${emoji.name}:`}
                >
                  <img
                    src={resolveUrl(emoji.source_url)}
                    alt={emoji.name}
                    className="size-6 object-contain"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {filteredCategories
          .filter((cat) => activeCategory === cat.name || search.trim())
          .map((cat) => (
            <div key={cat.name}>
              {search.trim() && (
                <p className="text-xs text-gray-500 uppercase font-semibold mb-1 px-1">
                  {cat.name}
                </p>
              )}
              <div className="grid grid-cols-8 gap-0.5">
                {cat.emojis.map((emoji, i) => (
                  <button
                    key={`${cat.name}-${i}`}
                    onClick={() => onSelect(emoji)}
                    className="size-9 flex items-center justify-center rounded hover:bg-[#404249] cursor-pointer text-xl"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
