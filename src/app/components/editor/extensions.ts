// TipTap extensions that make the composer round-trip Zulip markdown
// faithfully. Both exist to override tiptap-markdown's default serialization,
// which is tuned for HTML-ish markdown rather than Zulip's dialect.

import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { Text as TiptapText } from '@tiptap/extension-text';
import { TextSelection } from '@tiptap/pm/state';
import type { MarkdownSerializerState } from 'prosemirror-markdown';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * Text nodes without HTML entity escaping.
 *
 * tiptap-markdown's stock text serializer rewrites `<` and `>` to `&lt;`/`&gt;`
 * in every text node. That's right for markdown destined for an HTML pipeline
 * that renders entities, but Zulip escapes the ampersand in turn, so typing
 * "PBS > Backups" arrives as the literal "PBS &gt; Backups". Markdown escaping
 * (`*`, `_`, `[`) is still applied — that part is correct, since a WYSIWYG
 * composer turns real emphasis into marks and anything left over is meant
 * literally.
 *
 * Register with `StarterKit.configure({ text: false })` so there's exactly one
 * text node in the schema.
 */
export const PlainText = TiptapText.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          state.text(node.text ?? '');
        },
        parse: {},
      },
    };
  },
});

export interface ZulipQuoteAttrs {
  /** Markdown emitted verbatim on send. */
  raw: string;
  /** Chip heading, e.g. "Quoting Alice". */
  label: string;
  /** Short excerpt shown under the heading. */
  preview: string;
}

/**
 * An opaque block holding pre-built Zulip markdown, emitted byte-for-byte.
 *
 * Quote blocks can't survive the normal editor round-trip: inserting them as
 * text gets every `*`, `_`, `[` and backtick escaped, and parsing them into
 * real nodes collapses a ````quote fence down to ``` — which breaks the moment
 * the quoted message contains a quote of its own. So the markdown is carried
 * as an attribute and written straight out, untouched by the serializer.
 *
 * The trade-off is that the quote isn't editable inline. It's an atom, so it
 * selects and deletes as a single unit.
 */
export const ZulipQuote = Node.create({
  name: 'zulipQuote',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      raw: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-raw') ?? '',
        renderHTML: (attributes) => ({ 'data-raw': attributes.raw }),
      },
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-label') ?? '',
        renderHTML: (attributes) => ({ 'data-label': attributes.label }),
      },
      preview: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-preview') ?? '',
        renderHTML: (attributes) => ({ 'data-preview': attributes.preview }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-zulip-quote]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-zulip-quote': '',
        class: 'zulip-quote-chip',
        contenteditable: 'false',
      }),
      ['div', { class: 'zulip-quote-chip-label' }, node.attrs.label || 'Quoted message'],
      ['div', { class: 'zulip-quote-chip-preview' }, node.attrs.preview || ''],
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          // `false` disables markdown escaping — the whole point of this node.
          state.text(node.attrs.raw, false);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

/**
 * Insert a quote block and leave the cursor in a fresh paragraph beneath it,
 * ready to type the reply.
 *
 * Uses a raw transaction rather than `insertContent`, which silently drops
 * atom nodes passed as JSON.
 */
export function insertQuoteNode(editor: Editor, attrs: ZulipQuoteAttrs): void {
  const { schema, tr } = editor.state;
  const quoteType = schema.nodes.zulipQuote;
  const paragraphType = schema.nodes.paragraph;
  if (!quoteType || !paragraphType) return;

  tr.replaceSelectionWith(quoteType.create(attrs));

  // Always follow the quote with an empty paragraph. Without it the atom can
  // be the last node in the document, leaving nowhere to put the cursor.
  const pos = tr.selection.to;
  tr.insert(pos, paragraphType.create());
  tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  tr.scrollIntoView();

  editor.view.dispatch(tr);
  editor.commands.focus();
}
