// Helpers for producing Zulip-flavoured markdown.
//
// These build *source* markdown, the text that goes into a message. Nothing
// here touches rendered HTML — see MessageList's processContent for that
// direction.

import type { ZulipMessage } from '../api/types';

/**
 * Zulip's hash-component encoding (mirrors `hash_util.encode_hash_component`
 * in the upstream web client): percent-encode, then swap `%` for `.` so the
 * URL fragment stays readable. `.` is pre-escaped so the swap is reversible.
 */
export function encodeHashComponent(value: string): string {
  return encodeURIComponent(value).replace(/\./g, '%2E').replace(/%/g, '.');
}

/** `8-Customers` — the `{id}-{name}` form Zulip uses in narrow URLs. */
export function streamSlug(streamId: number, streamName: string): string {
  return `${streamId}-${encodeHashComponent(streamName.replace(/ /g, '-'))}`;
}

/**
 * Permalink to a single message, in the `#narrow/.../near/{id}` form Zulip's
 * own "said" links use. Returns null when we can't build a trustworthy one —
 * callers fall back to unlinked attribution rather than emitting a dead link.
 */
export function messagePermalink(
  serverUrl: string,
  message: ZulipMessage,
  streamName?: string
): string | null {
  const base = serverUrl.replace(/\/+$/, '');
  if (!base) return null;

  if (message.type === 'stream') {
    // display_recipient carries the stream name for stream messages.
    const name =
      streamName ??
      (typeof message.display_recipient === 'string' ? message.display_recipient : undefined);
    if (typeof message.stream_id !== 'number' || !name) return null;
    return (
      `${base}/#narrow/channel/${streamSlug(message.stream_id, name)}` +
      `/topic/${encodeHashComponent(message.subject)}/near/${message.id}`
    );
  }

  if (Array.isArray(message.display_recipient)) {
    const ids = message.display_recipient.map((r) => r.id).sort((a, b) => a - b);
    if (ids.length === 0) return null;
    return `${base}/#narrow/dm/${ids.join(',')}-group/near/${message.id}`;
  }

  return null;
}

/**
 * The opening/closing fence for a ```quote block wrapping `content`.
 *
 * Must be longer than any fence already inside the content, or the first
 * nested fence terminates our block early and the rest of the quote leaks out
 * as body text. Quoting a message that itself quotes something is the common
 * case, so this is load-bearing rather than defensive.
 */
export function quoteFence(content: string): string {
  let longest = 2;
  // Only fences at the start of a line can close a block, so inline code
  // spans don't need to widen it.
  for (const match of content.matchAll(/^ {0,3}(`{3,})/gm)) {
    longest = Math.max(longest, match[1].length);
  }
  return '`'.repeat(longest + 1);
}

export interface QuoteParams {
  /** Raw markdown source of the quoted message — NOT rendered HTML. */
  rawContent: string;
  senderName: string;
  /** Enables the `|id` form, which disambiguates duplicate display names. */
  senderId?: number;
  permalink?: string;
}

/**
 * Zulip's quote-and-reply block, matching what the upstream client produces:
 *
 *     @_**Alice|10** [said](https://…/near/123):
 *     ```quote
 *     original message
 *     ```
 *
 * The `@_` prefix is a *silent* mention — it renders as a mention without
 * notifying the person again for a message they already wrote.
 */
export function buildQuote({ rawContent, senderName, senderId, permalink }: QuoteParams): string {
  const mention =
    typeof senderId === 'number'
      ? `@_**${senderName}|${senderId}**`
      : `@_**${senderName}**`;
  const said = permalink ? `[said](${permalink})` : 'said';
  const body = rawContent.replace(/\s+$/, '');
  const fence = quoteFence(body);
  return `${mention} ${said}:\n${fence}quote\n${body}\n${fence}`;
}

/**
 * Plain text of rendered message HTML.
 *
 * Parsed with DOMParser rather than `div.innerHTML = …`: assigning innerHTML
 * on an element of the live document starts loading `<img>`s and runs their
 * inline `onerror` handlers even though the element is never attached, so a
 * hostile message body could execute script just by arriving.
 */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Emoji: Zulip renders unicode emoji as <span class="emoji emoji-1f7e2">
  // whose text is the ":name:" code, and custom emoji as <img alt=":name:">.
  // Swap in the real character (or the alt text) so previews don't read
  // ":white_circle: #308342…".
  doc.body.querySelectorAll('span.emoji').forEach((el) => {
    const m = /\bemoji-([0-9a-f]+(?:-[0-9a-f]+)*)\b/i.exec(el.className);
    if (!m) return;
    try {
      el.textContent = String.fromCodePoint(...m[1].split('-').map((cp) => parseInt(cp, 16)));
    } catch {
      // leave the :code: text
    }
  });
  doc.body.querySelectorAll('img.emoji').forEach((el) => {
    el.replaceWith(doc.createTextNode(el.getAttribute('alt') ?? ''));
  });
  return doc.body.textContent ?? '';
}

/** Short plain-text excerpt of rendered HTML, for composer previews. */
export function excerptFromHtml(html: string, maxLength = 140): string {
  const text = htmlToText(html).replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/**
 * A stable colour for someone's name, so people are easy to pick out in a
 * busy thread (especially in compact mode, which has no avatars).
 *
 * The hue comes from the user id (Knuth multiplicative hash onto 12 hues 30°
 * apart). Lightness and chroma come from the theme (`--name-l`, `--name-c` in
 * theme.css), and OKLCH keeps lightness perceptually even, so every hue has
 * the same contrast against the background.
 */
export function nameColor(userId: number): string {
  const hue = 15 + (((Math.imul(userId, 2654435761) >>> 0) % 12) * 30);
  return `oklch(var(--name-l) var(--name-c) ${hue})`;
}
