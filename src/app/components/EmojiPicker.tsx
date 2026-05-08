import { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from './ui/input';
import { useZulip } from '../context/ZulipContext';

export interface EmojiReaction {
  emojiName: string;
  emojiCode: string;
  reactionType: 'unicode_emoji' | 'realm_emoji';
}

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  /** When provided, called instead of onSelect with reaction-compatible data */
  onReact?: (reaction: EmojiReaction) => void;
}

interface CustomEmoji {
  id: string;
  name: string;
  source_url: string;
  deactivated: boolean;
}

// Emoji entry: [character, zulip_name]
type EmojiEntry = [string, string];

// Common emoji categories with unicode emojis and their Zulip names
const EMOJI_CATEGORIES: { name: string; emojis: EmojiEntry[] }[] = [
  {
    name: 'Smileys',
    emojis: [
      ['😀','grinning'],['😃','smiley'],['😄','smile'],['😁','grin'],['😆','laughing'],
      ['😅','sweat_smile'],['🤣','rofl'],['😂','joy'],['🙂','slightly_smiling_face'],['🙃','upside_down_face'],
      ['😉','wink'],['😊','blush'],['😇','innocent'],['🥰','smiling_face_with_three_hearts'],['😍','heart_eyes'],
      ['🤩','star_struck'],['😘','kissing_heart'],['😗','kissing'],['😚','kissing_closed_eyes'],['😙','kissing_smiling_eyes'],
      ['🥲','smiling_face_with_tear'],['😋','yum'],['😛','stuck_out_tongue'],['😜','stuck_out_tongue_winking_eye'],['🤪','zany_face'],
      ['😝','stuck_out_tongue_closed_eyes'],['🤑','money_mouth_face'],['🤗','hugs'],['🤭','hand_over_mouth'],['🫢','face_with_open_eyes_and_hand_over_mouth'],
      ['🤫','shushing_face'],['🤔','thinking'],['🫡','saluting_face'],['🤐','zipper_mouth_face'],['🤨','raised_eyebrow'],
      ['😐','neutral_face'],['😑','expressionless'],['😶','no_mouth'],['🫥','dotted_line_face'],['😏','smirk'],
      ['😒','unamused'],['🙄','roll_eyes'],['😬','grimacing'],['🤥','lying_face'],['😌','relieved'],
      ['😔','pensive'],['😪','sleepy'],['🤤','drooling_face'],['😴','sleeping'],['😷','mask'],
      ['🤒','face_with_thermometer'],['🤕','head_bandage'],['🤢','nauseated_face'],['🤮','vomiting_face'],['🥴','woozy_face'],
      ['😵','dizzy_face'],['🤯','exploding_head'],['🤠','cowboy_hat_face'],['🥳','partying_face'],['🥸','disguised_face'],
      ['😎','sunglasses'],['🤓','nerd_face'],['🧐','monocle_face'],['😕','confused'],['🫤','face_with_diagonal_mouth'],
      ['😟','worried'],['🙁','slightly_frowning_face'],['😮','open_mouth'],['😯','hushed'],['😲','astonished'],
      ['😳','flushed'],['🥺','pleading_face'],['🥹','face_holding_back_tears'],['😦','frowning'],['😧','anguished'],
      ['😨','fearful'],['😰','cold_sweat'],['😥','disappointed_relieved'],['😢','cry'],['😭','sob'],
      ['😱','scream'],['😖','confounded'],['😣','persevere'],['😞','disappointed'],['😓','sweat'],
      ['😩','weary'],['😫','tired_face'],['🥱','yawning_face'],['😤','triumph'],['😡','rage'],
      ['😠','angry'],['🤬','cursing_face'],['😈','smiling_imp'],['👿','imp'],['💀','skull'],
      ['☠️','skull_and_crossbones'],['💩','poop'],['🤡','clown_face'],['👹','japanese_ogre'],['👺','japanese_goblin'],
    ],
  },
  {
    name: 'Gestures',
    emojis: [
      ['👋','wave'],['🤚','raised_back_of_hand'],['🖐️','raised_hand_with_fingers_splayed'],['✋','raised_hand'],['🖖','vulcan_salute'],
      ['🫱','rightwards_hand'],['🫲','leftwards_hand'],['🫳','palm_down_hand'],['🫴','palm_up_hand'],['👌','ok_hand'],
      ['🤌','pinched_fingers'],['🤏','pinching_hand'],['✌️','v'],['🤞','crossed_fingers'],['🫰','hand_with_index_finger_and_thumb_crossed'],
      ['🤟','love_you_gesture'],['🤘','metal'],['🤙','call_me_hand'],['👈','point_left'],['👉','point_right'],
      ['👆','point_up_2'],['🖕','middle_finger'],['👇','point_down'],['☝️','point_up'],['🫵','index_pointing_at_the_viewer'],
      ['👍','+1'],['👎','-1'],['✊','fist'],['👊','facepunch'],['🤛','fist_left'],
      ['🤜','fist_right'],['👏','clap'],['🙌','raised_hands'],['🫶','heart_hands'],['👐','open_hands'],
      ['🤲','palms_up_together'],['🤝','handshake'],['🙏','pray'],['✍️','writing_hand'],['💪','muscle'],
    ],
  },
  {
    name: 'Hearts',
    emojis: [
      ['❤️','heart'],['🧡','orange_heart'],['💛','yellow_heart'],['💚','green_heart'],['💙','blue_heart'],
      ['💜','purple_heart'],['🖤','black_heart'],['🤍','white_heart'],['🤎','brown_heart'],['💔','broken_heart'],
      ['❤️‍🔥','heart_on_fire'],['❤️‍🩹','mending_heart'],['❣️','heavy_heart_exclamation'],['💕','two_hearts'],['💞','revolving_hearts'],
      ['💓','heartbeat'],['💗','heartpulse'],['💖','sparkling_heart'],['💘','cupid'],['💝','gift_heart'],
      ['💟','heart_decoration'],['♥️','hearts'],['🫶','heart_hands'],['💑','couple_with_heart'],['💏','couplekiss'],
      ['👫','couple'],['👬','two_men_holding_hands'],['👭','two_women_holding_hands'],
    ],
  },
  {
    name: 'Objects',
    emojis: [
      ['🔥','fire'],['⭐','star'],['🌟','star2'],['✨','sparkles'],['⚡','zap'],
      ['💥','boom'],['🎉','tada'],['🎊','confetti_ball'],['🎯','dart'],['🏆','trophy'],
      ['🎮','video_game'],['🎲','game_die'],['🎵','musical_note'],['🎶','notes'],['🎤','microphone'],
      ['🎧','headphones'],['📱','iphone'],['💻','laptop'],['⌨️','keyboard'],['🖥️','desktop_computer'],
      ['📸','camera_flash'],['📷','camera'],['🔔','bell'],['🔕','no_bell'],['📣','mega'],
      ['📢','loudspeaker'],['💡','bulb'],['🔦','flashlight'],['🏮','izakaya_lantern'],['📝','memo'],
      ['📌','pushpin'],['📎','paperclip'],['🔗','link'],['🔒','lock'],['🔓','unlock'],
      ['🛡️','shield'],['⚙️','gear'],['🔧','wrench'],['🔨','hammer'],['💣','bomb'],
    ],
  },
  {
    name: 'Symbols',
    emojis: [
      ['✅','white_check_mark'],['❌','x'],['⚠️','warning'],['🚫','no_entry_sign'],['💯','100'],
      ['🔴','red_circle'],['🟠','orange_circle'],['🟡','yellow_circle'],['🟢','green_circle'],['🔵','blue_circle'],
      ['🟣','purple_circle'],['⚫','black_circle'],['⚪','white_circle'],['🟤','brown_circle'],['▶️','arrow_forward'],
      ['⏸️','pause_button'],['⏹️','stop_button'],['⏺️','record_button'],['⏭️','next_track_button'],['⏮️','previous_track_button'],
      ['🔀','twisted_rightwards_arrows'],['🔁','repeat'],['🔂','repeat_one'],['➕','heavy_plus_sign'],['➖','heavy_minus_sign'],
      ['➗','heavy_division_sign'],['✖️','heavy_multiplication_x'],['♾️','infinity'],['❓','question'],['❗','exclamation'],
      ['‼️','bangbang'],['⁉️','interrobang'],['💲','heavy_dollar_sign'],['🔅','low_brightness'],['🔆','high_brightness'],
      ['☑️','ballot_box_with_check'],['🔘','radio_button'],['🔳','white_square_button'],['🔲','black_square_button'],['⬛','black_large_square'],['⬜','white_large_square'],
    ],
  },
];

/** Convert a unicode emoji to its codepoint string (e.g. "👍" → "1f44d") */
function emojiToCodepoint(emoji: string): string {
  return [...emoji]
    .map((c) => c.codePointAt(0)!.toString(16))
    .filter((cp) => cp !== 'fe0f') // strip variation selector
    .join('-');
}

export function EmojiPicker({ onSelect, onReact }: EmojiPickerProps) {
  const { resolveUrl, realmEmoji } = useZulip();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Smileys');

  // Custom server emoji is fetched once at login and stored on the
  // context — no per-mount network call needed. Project the
  // {id → {name, source_url}} map back into the local CustomEmoji shape.
  const customEmojis = useMemo<CustomEmoji[]>(
    () => Object.entries(realmEmoji).map(([id, info]) => ({
      id,
      name: info.name,
      source_url: info.source_url,
      deactivated: false,
    })),
    [realmEmoji]
  );

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return EMOJI_CATEGORIES;
    const q = search.toLowerCase();
    return EMOJI_CATEGORIES.map((cat) => ({
      ...cat,
      emojis: cat.emojis.filter(([, name]) => name.toLowerCase().includes(q)),
    })).filter((cat) => cat.emojis.length > 0);
  }, [search]);

  const filteredCustom = useMemo(() => {
    if (!search.trim()) return customEmojis;
    const q = search.toLowerCase();
    return customEmojis.filter((e) => e.name.toLowerCase().includes(q));
  }, [search, customEmojis]);

  return (
    <div className="w-80 h-96 bg-surface-secondary border border-surface-tertiary rounded-lg shadow-xl flex flex-col overflow-hidden">
      {/* Search */}
      <div className="p-2 border-b border-surface-tertiary">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-gray-500" />
          <Input
            type="text"
            placeholder="Search emoji..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-8 h-8 bg-surface-tertiary border-surface-tertiary text-gray-200 text-sm placeholder:text-gray-500"
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
      <div className="flex gap-1 px-2 py-1 border-b border-surface-tertiary overflow-x-auto flex-shrink-0">
        {customEmojis.length > 0 && (
          <button
            onClick={() => setActiveCategory('Custom')}
            className={`px-2 py-1 rounded text-xs whitespace-nowrap ${
              activeCategory === 'Custom'
                ? 'bg-brand text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-surface-hover'
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
                ? 'bg-brand text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-surface-hover'
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
                  onClick={() => {
                    if (onReact) {
                      onReact({ emojiName: emoji.name, emojiCode: emoji.id, reactionType: 'realm_emoji' });
                    } else {
                      onSelect(`:${emoji.name}:`);
                    }
                  }}
                  className="size-9 flex items-center justify-center rounded hover:bg-surface-hover cursor-pointer"
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
                {cat.emojis.map(([char, name], i) => (
                  <button
                    key={`${cat.name}-${i}`}
                    onClick={() => {
                      if (onReact) {
                        const code = emojiToCodepoint(char);
                        onReact({ emojiName: name, emojiCode: code, reactionType: 'unicode_emoji' });
                      } else {
                        onSelect(char);
                      }
                    }}
                    className="size-9 flex items-center justify-center rounded hover:bg-surface-hover cursor-pointer text-xl"
                    title={`:${name}:`}
                  >
                    {char}
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
