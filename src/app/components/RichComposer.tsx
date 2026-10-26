import { useCallback, useRef, useState, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { PlainText, ZulipImage, ZulipQuote, ZulipTable, insertQuoteNode, type ZulipQuoteAttrs } from './editor/extensions';
import { useZulip } from '../context/ZulipContext';
import type { TypingTarget } from '../api/types';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import {
  Send,
  Smile,
  Paperclip,
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code,
  Eye,
  Loader2,
  Image as ImageIcon,
} from 'lucide-react';
import { Button } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';
import { EmojiPicker } from './EmojiPicker';
import { GifPicker } from './GifPicker';

export interface RichComposerHandle {
  /** Insert a pre-built Zulip markdown block that must survive verbatim. */
  insertQuote: (attrs: ZulipQuoteAttrs) => void;
  clearContent: () => void;
}

interface RichComposerProps {
  onSendMessage: (content: string) => Promise<void>;
  onFileUpload?: (file: File) => Promise<string>;
  placeholder?: string;
  // Who gets "is typing" notifications: the DM's other participants, or the
  // open topic. Null means don't emit any.
  typingTarget?: TypingTarget | null;
}

// Usable typing target, or null for an empty DM recipient list.
function validTarget(t: TypingTarget | null): TypingTarget | null {
  if (!t) return null;
  if (t.type === 'direct' && t.to.length === 0) return null;
  return t;
}

// Files on a paste. `files` covers both screenshots and files copied in a
// file manager; `items` is the fallback for engines that only fill that.
function clipboardFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  if (data.files && data.files.length > 0) return Array.from(data.files);
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

export const RichComposer = forwardRef<RichComposerHandle, RichComposerProps>(function RichComposer({
  onSendMessage,
  onFileUpload,
  placeholder = 'Type a message...',
  typingTarget = null,
}, ref) {
  const { users, currentUser, sendTyping, resolveUrl } = useZulip();
  const [sending, setSending] = useState(false);
  // Files finished / queued in the current upload run; null when idle.
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const uploading = uploadProgress !== null;
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showSpoilerInput, setShowSpoilerInput] = useState(false);
  const [spoilerHeader, setSpoilerHeader] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionPos, setMentionPos] = useState<{ top: number; left: number } | null>(null);
  const mentionStartRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiBtnRef = useRef<HTMLDivElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const gifBtnRef = useRef<HTMLDivElement>(null);
  const gifRef = useRef<HTMLDivElement>(null);
  const spoilerBtnRef = useRef<HTMLDivElement>(null);
  const spoilerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const fileUploadRef = useRef<((files: File[]) => void) | null>(null);

  // Filter users for mention autocomplete
  const mentionUsers = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const allUsers = currentUser ? [currentUser, ...users.filter(u => u.user_id !== currentUser.user_id)] : users;
    return allUsers
      .filter((u) => u.is_active && !u.is_bot && u.full_name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [mentionQuery, users, currentUser]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: {
          HTMLAttributes: { class: 'zulip-code-block' },
        },
        // Replaced by PlainText below, which drops tiptap-markdown's HTML
        // entity escaping. Two text nodes in one schema is an error.
        text: false,
        // StarterKit v3 bundles Link and Underline. Configure them here:
        // registering them again separately duplicated both, and the
        // bundled Link's default openOnClick won out.
        link: {
          openOnClick: false,
          HTMLAttributes: { class: 'text-brand underline' },
        },
      }),
      PlainText,
      ZulipQuote,
      // Pasted tables (e.g. copied out of a message) stay tables and are
      // sent as GFM pipe tables; see ZulipTable.
      ZulipTable,
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder }),
      ZulipImage.configure({
        inline: true,
        HTMLAttributes: { class: 'max-w-full max-h-48 rounded inline' },
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    editorProps: {
      attributes: {
        class:
          'max-w-none px-3 pt-2.5 pb-1 min-h-[40px] max-h-[240px] overflow-y-auto outline-none text-text-primary text-[13px] leading-5',
      },
      handleKeyDown: (_view, event) => {
        // `isComposing` (and the legacy keyCode 229) mean an IME is still
        // resolving a candidate — Enter there commits the candidate, it does
        // not mean "send". Without this guard, typing in Japanese/Chinese/
        // Korean fires off half-finished messages.
        if (event.isComposing || event.keyCode === 229) return false;
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          handleSendRef.current();
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        // Every pasted file uploads (Zulip takes any type). This used to
        // return after the first file, so pasting several files copied in
        // Explorer only ever sent one. Plain-text pastes carry no files and
        // fall through to the editor.
        const files = clipboardFiles(event.clipboardData);
        if (files.length === 0 || !fileUploadRef.current) return false;
        event.preventDefault();
        fileUploadRef.current(files);
        return true;
      },
    },
    content: '',
  });

  // Expose the imperative API used by App.
  useImperativeHandle(ref, () => ({
    insertQuote: (attrs: ZulipQuoteAttrs) => {
      if (!editor) return;
      insertQuoteNode(editor, attrs);
    },
    clearContent: () => {
      if (!editor) return;
      editor.commands.clearContent();
    },
  }), [editor]);

  // Upload a file and insert into editor
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Uploads run one at a time through a single queue, so links land in the
  // order the files were given, even across back-to-back pastes and drops.
  // Firing them all at once (as drops used to) inserted links in whatever
  // order the server answered, and the first finisher cleared the spinner
  // while the rest were still going.
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const uploadCountsRef = useRef({ done: 0, total: 0 });

  const uploadFiles = useCallback((files: File[]) => {
    if (!onFileUpload || !editor || files.length === 0) return;
    const counts = uploadCountsRef.current;
    counts.total += files.length;
    setUploadProgress({ ...counts });
    setUploadError(null);
    uploadQueueRef.current = uploadQueueRef.current.then(async () => {
      const failed: string[] = [];
      for (const file of files) {
        try {
          const uri = await onFileUpload(file);
          if (!editor.isDestroyed) {
            // Inserted as a link-marked text node, not a markdown string:
            // markdown gets parsed into a fresh paragraph that leaves the
            // cursor before it, so each later upload landed ahead of the
            // last. The serializer escapes the name on send. Plain link
            // (no bang) — Zulip previews user_uploads links by itself.
            editor
              .chain()
              .focus()
              .insertContent([
                { type: 'text', text: file.name, marks: [{ type: 'link', attrs: { href: uri } }] },
                { type: 'text', text: ' ' },
              ])
              .run();
          }
        } catch (err) {
          console.error('Failed to upload file:', err);
          failed.push(file.name);
        }
        counts.done++;
        setUploadProgress({ ...counts });
      }
      if (failed.length > 0) {
        setUploadError(
          failed.length === 1
            ? `Failed to upload ${failed[0]}`
            : `Failed to upload ${failed.length} files: ${failed.join(', ')}`
        );
        setTimeout(() => setUploadError(null), 6000);
      }
      // Another batch may have been queued meanwhile; only go idle once
      // everything is through.
      if (counts.done >= counts.total) {
        uploadCountsRef.current = { done: 0, total: 0 };
        setUploadProgress(null);
      }
    });
  }, [editor, onFileUpload]);

  // Keep ref in sync so paste handler always has the latest upload function
  useEffect(() => {
    fileUploadRef.current = uploadFiles;
  }, [uploadFiles]);

  // Drag & drop file upload. Every dropped file is uploaded: filtering on
  // MIME type silently dropped text files, logs and anything the OS
  // reports with an empty type.
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    uploadFiles(Array.from(e.dataTransfer.files));
  }, [uploadFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // dragleave also fires when moving onto a child element; only clear the
    // highlight once the pointer has actually left the composer.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  }, []);

  // Close pickers on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        showEmojiPicker &&
        emojiRef.current && !emojiRef.current.contains(target) &&
        emojiBtnRef.current && !emojiBtnRef.current.contains(target)
      ) {
        setShowEmojiPicker(false);
      }
      if (
        showGifPicker &&
        gifRef.current && !gifRef.current.contains(target) &&
        gifBtnRef.current && !gifBtnRef.current.contains(target)
      ) {
        setShowGifPicker(false);
      }
      if (
        showSpoilerInput &&
        spoilerRef.current && !spoilerRef.current.contains(target) &&
        spoilerBtnRef.current && !spoilerBtnRef.current.contains(target)
      ) {
        setShowSpoilerInput(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmojiPicker, showGifPicker, showSpoilerInput]);

  const handleSend = useCallback(async () => {
    if (!editor || sending) return;

    // Get markdown content from editor
    // tiptap-markdown augments `editor.storage` at runtime but ships no
    // type augmentation for it.
    const markdown = (
      editor.storage as unknown as { markdown: { getMarkdown: () => string } }
    ).markdown.getMarkdown();
    if (!markdown.trim()) return;

    setSending(true);
    try {
      await onSendMessage(markdown);
      editor.commands.clearContent();
      // Send the typing-stop event so the peer's "X is typing" indicator
      // disappears immediately on send rather than after the 5s debounce.
      if (typingActiveRef.current) {
        const target = validTarget(typingTargetRef.current);
        typingActiveRef.current = false;
        if (typingTimerRef.current) {
          clearTimeout(typingTimerRef.current);
          typingTimerRef.current = null;
        }
        if (target) sendTyping(target, 'stop').catch(() => {});
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  }, [editor, sending, onSendMessage, sendTyping]);

  // Use a ref so the Enter key handler always calls the latest handleSend
  // without needing to re-register the handler on every state change
  const handleSendRef = useRef(handleSend);
  useEffect(() => { handleSendRef.current = handleSend; }, [handleSend]);

  // Detect @mention trigger on every editor update
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      const { from } = editor.state.selection;
      const textBefore = editor.state.doc.textBetween(Math.max(0, from - 50), from, '\n');
      // Trigger only at a word boundary (so `user@example.com` doesn't open
      // the popup), allow any letter/mark plus the punctuation real names
      // contain, and cap at two words so a stray "@" doesn't keep the popup
      // latched open for the rest of the sentence.
      const match = textBefore.match(/(?:^|[\s(])@([\p{L}\p{M}\d._'-]*(?:[ ][\p{L}\p{M}\d._'-]+)?)$/u);
      if (match) {
        // match[0] can include the boundary character before '@' — anchor the
        // replacement range at the '@' so we don't eat the preceding space.
        mentionStartRef.current = from - match[0].length + match[0].indexOf('@');
        setMentionQuery(match[1]);
        setMentionIndex(0);
        try {
          const coords = editor.view.coordsAtPos(from);
          const editorRect = editor.view.dom.getBoundingClientRect();
          setMentionPos({
            left: coords.left - editorRect.left,
            top: coords.top - editorRect.top - 4,
          });
        } catch {
          setMentionPos({ left: 0, top: 0 });
        }
      } else {
        setMentionQuery(null);
        setMentionPos(null);
        mentionStartRef.current = null;
      }
    };
    editor.on('update', onUpdate);
    editor.on('selectionUpdate', onUpdate);
    return () => {
      editor.off('update', onUpdate);
      editor.off('selectionUpdate', onUpdate);
    };
  }, [editor]);

  // Emit Zulip typing notifications while the user types, in DMs and in
  // topics. Pattern: send 'start' on the first non-empty edit, debounce a
  // 'stop' after 5s of no further edits. Receivers expire an indicator ~15s
  // after the last 'start', so during a long stretch of typing 'start' is
  // re-sent every 10s, as Zulip's own clients do.
  const TYPING_RESEND_MS = 10_000;
  const typingActiveRef = useRef(false);
  const lastTypingStartRef = useRef(0);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTargetRef = useRef<TypingTarget | null>(typingTarget);
  useEffect(() => { typingTargetRef.current = typingTarget; }, [typingTarget]);

  useEffect(() => {
    if (!editor) return;
    const stopTyping = () => {
      const target = validTarget(typingTargetRef.current);
      typingActiveRef.current = false;
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      if (target) sendTyping(target, 'stop').catch(() => {});
    };
    const onTyping = () => {
      const target = validTarget(typingTargetRef.current);
      if (!target) return;
      if (editor.isEmpty) {
        if (typingActiveRef.current) stopTyping();
        return;
      }
      const now = Date.now();
      if (!typingActiveRef.current || now - lastTypingStartRef.current > TYPING_RESEND_MS) {
        typingActiveRef.current = true;
        lastTypingStartRef.current = now;
        sendTyping(target, 'start').catch(() => {});
      }
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(stopTyping, 5000);
    };
    editor.on('update', onTyping);
    return () => {
      editor.off('update', onTyping);
      // On unmount (or conversation switch — composer is keyed by it) tell
      // the previous conversation we've stopped typing.
      if (typingActiveRef.current) stopTyping();
    };
  }, [editor, sendTyping]);

  // Insert a mention and close the popup
  const insertMention = useCallback((userName: string, userId?: number) => {
    if (!editor || mentionStartRef.current === null) return;
    const from = mentionStartRef.current;
    const to = editor.state.selection.from;
    // Zulip resolves @**Name** by display name, which is ambiguous when two
    // people share one. Fall back to the explicit @**Name|id** form only when
    // needed, matching what Zulip's own composer does.
    const ambiguous =
      userId !== undefined &&
      users.filter((u) => u.is_active && u.full_name === userName).length > 1;
    const mention = ambiguous ? `@**${userName}|${userId}** ` : `@**${userName}** `;
    editor.chain().focus()
      .deleteRange({ from, to })
      .insertContent(mention)
      .run();
    setMentionQuery(null);
    setMentionPos(null);
    mentionStartRef.current = null;
  }, [editor, users]);

  // Handle keyboard navigation in mention popup
  useEffect(() => {
    if (mentionQuery === null || !editor) return;
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionUsers.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (mentionUsers.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          insertMention(
            mentionUsers[mentionIndex].full_name,
            mentionUsers[mentionIndex].user_id
          );
        }
      } else if (e.key === 'Escape') {
        setMentionQuery(null);
        setMentionPos(null);
        mentionStartRef.current = null;
      }
    };
    // Capture phase to intercept before TipTap's Enter handler
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [mentionQuery, mentionUsers, mentionIndex, insertMention, editor]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Reset the input up-front so picking the same file twice in a row still
    // fires a change event.
    if (fileInputRef.current) fileInputRef.current.value = '';
    uploadFiles(files);
  };

  const handleEmojiSelect = (emoji: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(emoji).run();
    setShowEmojiPicker(false);
  };

  // Zulip's spoiler syntax carries its header in the fence info string:
  //   ```spoiler Click to reveal
  // Bare ```spoiler falls back to the server's default "Spoiler" label.
  // The header lives in the code block's `language` attribute, which isn't
  // editable once inserted — hence asking for it up front rather than
  // dropping in a literal "Header" the user then can't change.
  const insertSpoiler = useCallback((header: string) => {
    if (!editor) return;
    const label = header.trim();
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'codeBlock',
        attrs: { language: label ? `spoiler ${label}` : 'spoiler' },
      })
      .run();
    setShowSpoilerInput(false);
    setSpoilerHeader('');
  }, [editor]);

  const handleGifSelect = (gifUrl: string, altText: string) => {
    if (!editor) return;
    // A real image node (previewed in the composer), sent as Zulip's
    // `[](url)` by ZulipImage. A space after keeps typing off the image.
    editor
      .chain()
      .focus()
      .insertContent([
        { type: 'image', attrs: { src: gifUrl, alt: altText, title: altText } },
        { type: 'text', text: ' ' },
      ])
      .run();
    setShowGifPicker(false);
  };

  if (!editor) return null;

  const isActive = (type: string, attrs?: Record<string, unknown>) =>
    editor.isActive(type, attrs);

  return (
    <div
      ref={composerRef}
      className="px-6 pb-4 flex-shrink-0"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className={`bg-surface-composer border rounded-lg transition-colors ${dragOver ? 'border-brand ring-2 ring-brand/30' : 'border-line focus-within:border-text-muted/60'}`}>
        {/* Drag overlay */}
        {dragOver && (
          <div className="flex items-center justify-center py-4 text-sm text-brand font-medium">
            Drop files to upload
          </div>
        )}
        {/* Upload error banner */}
        {uploadProgress && uploadProgress.total > 1 && (
          <div className="flex items-center justify-center gap-1.5 py-1.5 text-xs text-text-secondary">
            <Loader2 className="size-3 animate-spin" />
            Uploading {Math.min(uploadProgress.done + 1, uploadProgress.total)} of {uploadProgress.total}…
          </div>
        )}
        {uploadError && (
          <div className="flex items-center justify-center py-1.5 text-xs text-red-400 bg-red-500/10 rounded-t-lg">
            {uploadError}
          </div>
        )}
        {/* Editor Area */}
        <div className="relative">
          <EditorContent editor={editor} />

          {/* @mention autocomplete popup */}
          {mentionQuery !== null && mentionUsers.length > 0 && mentionPos && (
            <div
              className="absolute z-50 bg-surface-secondary border border-surface-tertiary rounded-lg shadow-xl py-1 max-h-64 overflow-y-auto w-64"
              style={{ bottom: '100%', left: mentionPos.left, marginBottom: 4 }}
            >
              {mentionUsers.map((user, i) => (
                <button
                  key={user.user_id}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                    i === mentionIndex ? 'bg-brand text-white' : 'text-text-primary hover:bg-surface-hover'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault(); // Prevent editor blur
                    insertMention(user.full_name, user.user_id);
                  }}
                  onMouseEnter={() => setMentionIndex(i)}
                >
                  <Avatar className="size-6">
                    <AvatarImage src={resolveUrl(user.avatar_url)} alt={user.full_name} />
                    <AvatarFallback className="text-[10px]">{(user.full_name || '?')[0]}</AvatarFallback>
                  </Avatar>
                  <span className="truncate">{user.full_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center px-1.5 pb-1.5">
          <div className="flex items-center gap-0.5">
            <TooltipProvider>
              {/* File upload */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-text-secondary hover:text-text-primary hover:bg-surface-hover"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Paperclip className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Attach file</p></TooltipContent>
              </Tooltip>

              {/* Emoji picker */}
              <div ref={emojiBtnRef}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`size-7 hover:text-text-primary hover:bg-surface-hover ${
                        showEmojiPicker ? 'text-text-primary bg-surface-hover' : 'text-text-secondary'
                      }`}
                      onClick={() => {
                        setShowEmojiPicker(!showEmojiPicker);
                        setShowGifPicker(false);
                      }}
                    >
                      <Smile className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p>Emoji</p></TooltipContent>
                </Tooltip>
              </div>

              {/* GIF picker */}
              <div ref={gifBtnRef}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`size-7 hover:text-text-primary hover:bg-surface-hover ${
                        showGifPicker ? 'text-text-primary bg-surface-hover' : 'text-text-secondary'
                      }`}
                      onClick={() => {
                        setShowGifPicker(!showGifPicker);
                        setShowEmojiPicker(false);
                      }}
                    >
                      <ImageIcon className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p>GIF</p></TooltipContent>
                </Tooltip>
              </div>

              {/* Divider */}
              <div className="w-px h-4 bg-line mx-1" />

              {/* Formatting buttons */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    variant="ghost"
                    size="icon"
                    className={`size-7 hover:text-text-primary hover:bg-surface-hover ${
                      isActive('bold') ? 'text-text-primary bg-surface-hover' : 'text-text-secondary'
                    }`}
                  >
                    <Bold className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Bold (Ctrl+B)</p></TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                    variant="ghost"
                    size="icon"
                    className={`size-7 hover:text-text-primary hover:bg-surface-hover ${
                      isActive('italic') ? 'text-text-primary bg-surface-hover' : 'text-text-secondary'
                    }`}
                  >
                    <Italic className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Italic (Ctrl+I)</p></TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => editor.chain().focus().toggleStrike().run()}
                    variant="ghost"
                    size="icon"
                    className={`size-7 hover:text-text-primary hover:bg-surface-hover ${
                      isActive('strike') ? 'text-text-primary bg-surface-hover' : 'text-text-secondary'
                    }`}
                  >
                    <Strikethrough className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Strikethrough</p></TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => editor.chain().focus().toggleOrderedList().run()}
                    variant="ghost"
                    size="icon"
                    className={`size-7 hover:text-text-primary hover:bg-surface-hover ${
                      isActive('orderedList') ? 'text-text-primary bg-surface-hover' : 'text-text-secondary'
                    }`}
                  >
                    <ListOrdered className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Numbered list</p></TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => editor.chain().focus().toggleBulletList().run()}
                    variant="ghost"
                    size="icon"
                    className={`size-7 hover:text-text-primary hover:bg-surface-hover ${
                      isActive('bulletList') ? 'text-text-primary bg-surface-hover' : 'text-text-secondary'
                    }`}
                  >
                    <List className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Bulleted list</p></TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => editor.chain().focus().toggleBlockquote().run()}
                    variant="ghost"
                    size="icon"
                    className={`size-7 hover:text-text-primary hover:bg-surface-hover ${
                      isActive('blockquote') ? 'text-text-primary bg-surface-hover' : 'text-text-secondary'
                    }`}
                  >
                    <Quote className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Quote</p></TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => {
                      if (editor.isActive('codeBlock')) {
                        editor.chain().focus().toggleCodeBlock().run();
                      } else if (editor.state.selection.empty) {
                        editor.chain().focus().toggleCodeBlock().run();
                      } else {
                        editor.chain().focus().toggleCode().run();
                      }
                    }}
                    variant="ghost"
                    size="icon"
                    className={`size-7 hover:text-text-primary hover:bg-surface-hover ${
                      isActive('code') || isActive('codeBlock')
                        ? 'text-text-primary bg-surface-hover'
                        : 'text-text-secondary'
                    }`}
                  >
                    <Code className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Code</p></TooltipContent>
              </Tooltip>

              <div ref={spoilerBtnRef} className="relative">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={() => {
                        setShowSpoilerInput((v) => !v);
                        setShowEmojiPicker(false);
                        setShowGifPicker(false);
                      }}
                      variant="ghost"
                      size="icon"
                      className={`size-7 hover:text-text-primary hover:bg-surface-hover ${
                        showSpoilerInput ? 'text-text-primary bg-surface-hover' : 'text-text-secondary'
                      }`}
                    >
                      <Eye className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p>Spoiler</p></TooltipContent>
                </Tooltip>

                {showSpoilerInput && (
                  <div
                    ref={spoilerRef}
                    className="absolute bottom-full left-0 mb-2 z-[100] w-64 rounded-lg border border-surface-tertiary bg-surface-secondary p-2 shadow-xl"
                  >
                    <label className="mb-1 block text-[11px] font-medium text-text-secondary">
                      Spoiler heading
                    </label>
                    <input
                      autoFocus
                      type="text"
                      value={spoilerHeader}
                      onChange={(e) => setSpoilerHeader(e.target.value)}
                      onKeyDown={(e) => {
                        // Stop these reaching the editor's Enter-to-send handler.
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          insertSpoiler(spoilerHeader);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setShowSpoilerInput(false);
                          setSpoilerHeader('');
                        }
                      }}
                      placeholder="Spoiler"
                      className="w-full rounded border border-surface-tertiary bg-surface-tertiary px-2 py-1 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-brand"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-text-muted">
                        Leave blank for &ldquo;Spoiler&rdquo;
                      </span>
                      <Button
                        size="sm"
                        className="h-6 bg-brand px-2 text-xs hover:bg-brand-hover"
                        onClick={() => insertSpoiler(spoilerHeader)}
                      >
                        Insert
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </TooltipProvider>
          </div>

          <span className="ml-auto mr-2 hidden md:inline text-[11px] text-text-muted whitespace-nowrap">
            <kbd className="font-mono text-[10px] border border-line border-b-2 rounded px-1">Enter</kbd> send ·{' '}
            <kbd className="font-mono text-[10px] border border-line border-b-2 rounded px-1">Shift Enter</kbd> new line
          </span>
          <Button
            onClick={handleSend}
            disabled={sending}
            size="icon"
            aria-label="Send"
            className="size-7 rounded-md bg-brand hover:bg-brand-hover text-white disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Emoji picker - rendered as fixed overlay above composer */}
      {showEmojiPicker && (
        <div
          ref={emojiRef}
          className="fixed z-[100]"
          style={{
            bottom: (() => {
              const btn = emojiBtnRef.current;
              if (!btn) return 80;
              return window.innerHeight - btn.getBoundingClientRect().top + 8;
            })(),
            left: (() => {
              const btn = emojiBtnRef.current;
              if (!btn) return 260;
              return btn.getBoundingClientRect().left;
            })(),
          }}
        >
          <EmojiPicker onSelect={handleEmojiSelect} />
        </div>
      )}

      {/* GIF picker - rendered as fixed overlay above composer */}
      {showGifPicker && (
        <div
          ref={gifRef}
          className="fixed z-[100]"
          style={{
            bottom: (() => {
              const btn = gifBtnRef.current;
              if (!btn) return 80;
              return window.innerHeight - btn.getBoundingClientRect().top + 8;
            })(),
            left: (() => {
              const btn = gifBtnRef.current;
              if (!btn) return 260;
              return btn.getBoundingClientRect().left;
            })(),
          }}
        >
          <GifPicker onSelect={handleGifSelect} />
        </div>
      )}
    </div>
  );
});
