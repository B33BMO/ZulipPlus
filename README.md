# Zulip+

A modern, feature-rich desktop client for [Zulip](https://zulip.com) built with Electron, React, and TailwindCSS.

## Features

### Messaging
- **Rich text composer** with bold, italic, strikethrough, lists, code blocks, blockquotes, and spoilers
- **File & image uploads** via drag & drop, paste, or attachment button
- **GIF picker** powered by Tenor
- **Emoji picker** with full Unicode and custom realm emoji support
- **@mention autocomplete** for users in the composer
- **Quote messages** with one click — inserts Zulip-format quotes
- **Message reactions** — add/remove emoji reactions including custom server emoji

### Channels & DMs
- **Direct messages** with presence indicators (online/idle/offline)
- **Self-messaging** — send DMs to yourself
- **Channel muting** — right-click to mute noisy channels
- **Unread counts** with badges on channels, topics, and DMs
- **Mark as read** when opening a conversation
- **Auto-sorting** — newest conversations and topics bubble to the top

### Search
- **Global search** across all messages with highlighted results
- **Jump to conversation** — click a result to navigate directly

### Appearance
- **5 built-in themes** — Dark, Light, Midnight, Nord, and Dracula
- **Accent color picker** — customize the highlight color
- **Collapsible sidebar** — shows avatars and channel icons when collapsed

### Desktop Integration
- **Windows notifications** for direct messages
- **External links** open in your default browser
- **Image lightbox** — click images to view full-size with scroll-to-zoom and click-to-pan
- **Custom app icon** — Zulip+ branding on taskbar and title bar

### Profile & Status
- **Edit status** with emoji and preset options (In a meeting, Out sick, Vacationing, etc.)
- **Go invisible** — appear offline to others while staying connected
- **Settings modal** with theme and notification preferences

## Tech Stack

- **Electron** — cross-platform desktop shell
- **React 18** + **TypeScript**
- **Vite** — fast dev server and bundler
- **TailwindCSS** — utility-first styling
- **Radix UI** — accessible headless components
- **TipTap** — rich text editor (ProseMirror-based)
- **Lucide** — icon library
- **Framer Motion** — animations
- **date-fns** — date formatting

## Getting Started

### Prerequisites
- Node.js 18+
- npm

### Install

```bash
git clone https://github.com/B33BMO/ZulipPlus.git
cd ZulipPlus
npm install
```

### Development

```bash
# Web only (hot reload)
npm run dev

# Electron + web (hot reload)
npm run electron:dev
```

### Build

```bash
# Build Windows installer
npm run electron:build
```

The installer will be output to `release/`.

## Connecting to a Zulip Server

1. Launch the app
2. Enter your Zulip server URL (e.g. `https://your-org.zulipchat.com`)
3. Enter your email and [API key](https://zulip.com/api/api-keys)
4. Click Sign In

## License

MIT
