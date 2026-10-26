// TipTap extensions that make the composer round-trip Zulip markdown
// faithfully. Both exist to override tiptap-markdown's default serialization,
// which is tuned for HTML-ish markdown rather than Zulip's dialect.

import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { Text as TiptapText } from '@tiptap/extension-text';
import { Table } from '@tiptap/extension-table';
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

/**
 * Tables, always sent as a GFM pipe table (which Zulip renders).
 *
 * Without a table node at all, pasting a table (e.g. one copied out of a
 * message) collapsed every cell into one run-on paragraph. tiptap-markdown's
 * stock serializer handles only the tidy case: a header row, no merged cells,
 * one paragraph per cell. Anything else came out as the literal text
 * "[table]". It also left `|` inside cells unescaped, which splits the cell.
 *
 * This one always produces a table, accepting some loss for shapes markdown
 * can't express: the first row is the header whatever it was, merged cells
 * keep their content with blanks padding the span, and multi-paragraph cells
 * are joined with spaces.
 */
export const ZulipTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          // Render a cell's inline content in place, then cut it back out of
          // the output buffer. Escaping has to happen after rendering:
          // prosemirror-markdown writes code spans verbatim, bypassing the
          // text serializer, and GFM needs `\|` even inside code spans.
          const st = state as unknown as { out: string };
          // Flush the blank line owed to the previous block *before* noting
          // buffer positions; otherwise cutting a rendered cell back out
          // removes that separator and glues the header row onto the line
          // above.
          state.write();
          const renderCell = (cell: ProseMirrorNode): string => {
            const parts: string[] = [];
            cell.forEach((block) => {
              if (!block.textContent.trim()) return;
              const start = st.out.length;
              state.renderInline(block);
              parts.push(st.out.slice(start));
              st.out = st.out.slice(0, start);
            });
            return parts
              .join(' ')
              .replace(/\\?\n/g, ' ') // hard breaks / newlines can't live in a cell
              // Every pipe, even one after a backslash: that backslash is
              // itself an escaped literal "\\", not an escape of the pipe.
              .replace(/\|/g, '\\|')
              .trim();
          };

          const rows: string[][] = [];
          node.forEach((row) => {
            const cells: string[] = [];
            row.forEach((cell) => {
              cells.push(renderCell(cell));
              const span = Number(cell.attrs.colspan) || 1;
              for (let i = 1; i < span; i++) cells.push('');
            });
            rows.push(cells);
          });
          if (rows.length === 0) return;

          const width = Math.max(...rows.map((r) => r.length));
          const line = (cells: string[]) => {
            const padded = [...cells, ...Array(width - cells.length).fill('')];
            return `| ${padded.join(' | ')} |`;
          };
          state.write(line(rows[0]));
          state.ensureNewLine();
          state.write(line(Array(width).fill('---')));
          state.ensureNewLine();
          for (const row of rows.slice(1)) {
            state.write(line(row));
            state.ensureNewLine();
          }
          state.closeBlock(node);
        },
        parse: {
          // markdown-it parses GFM tables into table HTML, which the node's
          // own parseHTML rules pick up.
        },
      },
    };
  },
});
