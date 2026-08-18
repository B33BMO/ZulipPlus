import { useCallback, useRef, useState, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
import { useZulip } from '../context/ZulipContext';
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
  insertContent: (markdown: string) => void;
  insertRawText: (text: string) => void;
  clearContent: () => void;
}

interface RichComposerProps {
  onSendMessage: (content: string) => Promise<void>;
  onFileUpload?: (file: File) => Promise<string>;
  placeholder?: string;
  // User IDs that should receive typing notifications. Null/empty means
  // don't emit typing events (Zulip's typing API only supports DMs, not
  // stream/topic conversations).
  typingRecipients?: number[] | null;
}

export const RichComposer = forwardRef<RichComposerHandle, RichComposerProps>(function RichComposer({
  onSendMessage,
  onFileUpload,
  placeholder = 'Type a message...',
  typingRecipients = null,
}, ref) {
  const { users, currentUser, sendTyping } = useZulip();
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
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
  const composerRef = useRef<HTMLDivElement>(null);
  const fileUploadRef = useRef<((file: File) => Promise<void>) | null>(null);

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
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-brand underline' },
      }),
      Underline,
      Image.configure({
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
          'prose prose-invert prose-sm max-w-none px-3 py-2 min-h-[44px] max-h-[200px] overflow-y-auto outline-none text-gray-200 text-sm',
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
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.type.startsWith('image/') || item.type.startsWith('video/') || item.type.startsWith('application/')) {
            const file = item.getAsFile();
            if (file && fileUploadRef.current) {
              event.preventDefault();
              fileUploadRef.current(file);
              return true;
            }
          }
        }
        return false;
      },
    },
    content: '',
  });

  // Expose insertContent, insertRawText, and clearContent to parent via ref
  useImperativeHandle(ref, () => ({
    insertContent: (markdown: string) => {
      if (!editor) return;
      editor.chain().focus().insertContent(markdown).run();
    },
    insertRawText: (text: string) => {
      if (!editor) return;
      editor.chain().focus().insertContent({ type: 'text', text }).run();
    },
    clearContent: () => {
      if (!editor) return;
      editor.commands.clearContent();
    },
  }), [editor]);

  // Upload a file and insert into editor
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileUploadInternal = useCallback(async (file: File) => {
    if (!onFileUpload || !editor) return;
    setUploading(true);
    setUploadError(null);
    try {
      const uri = await onFileUpload(file);
      // Zulip auto-previews user_uploads links; use plain link syntax (no bang)
      // so the server renders an inline preview instead of literal markdown.
      editor.chain().focus().insertContent(`[${file.name}](${uri}) `).run();
    } catch (err) {
      console.error('Failed to upload file:', err);
      setUploadError(`Failed to upload ${file.name}`);
      setTimeout(() => setUploadError(null), 4000);
    } finally {
      setUploading(false);
    }
  }, [editor, onFileUpload]);

  // Keep ref in sync so paste handler always has the latest upload function
  useEffect(() => {
    fileUploadRef.current = handleFileUploadInternal;
  }, [handleFileUploadInternal]);

  // Drag & drop file upload — validate file types like paste handler
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      for (const file of Array.from(files)) {
        if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('application/')) {
          handleFileUploadInternal(file);
        }
      }
    }
  }, [handleFileUploadInternal]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmojiPicker, showGifPicker]);

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
        const to = typingRecipientsRef.current;
        typingActiveRef.current = false;
        if (typingTimerRef.current) {
          clearTimeout(typingTimerRef.current);
          typingTimerRef.current = null;
        }
        if (to && to.length > 0) sendTyping(to, 'stop').catch(() => {});
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

  // Emit Zulip typing notifications while the user is typing in a DM.
  // Pattern: send 'start' on first non-empty edit, debounce a 'stop' after
  // 5s of no further edits (Zulip clients re-send 'start' on activity, so
  // a peer's "X is typing" indicator won't expire on the other side as
  // long as we keep sending). Stream/topic conversations don't get typing
  // notifications — typingRecipients will be null.
  const typingActiveRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingRecipientsRef = useRef<number[] | null>(typingRecipients);
  useEffect(() => { typingRecipientsRef.current = typingRecipients; }, [typingRecipients]);

  useEffect(() => {
    if (!editor) return;
    const stopTyping = () => {
      const to = typingRecipientsRef.current;
      typingActiveRef.current = false;
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      if (to && to.length > 0) sendTyping(to, 'stop').catch(() => {});
    };
    const onTyping = () => {
      const to = typingRecipientsRef.current;
      if (!to || to.length === 0) return;
      if (editor.isEmpty) {
        if (typingActiveRef.current) stopTyping();
        return;
      }
      if (!typingActiveRef.current) {
        typingActiveRef.current = true;
        sendTyping(to, 'start').catch(() => {});
      }
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(stopTyping, 5000);
    };
    editor.on('update', onTyping);
    return () => {
      editor.off('update', onTyping);
      // On unmount (or conversation switch — composer is keyed by it) tell
      // the previous recipient set we've stopped typing.
      if (typingActiveRef.current) stopTyping();
    };
  }, [editor, sendTyping]);

  // Insert a mention and close the popup
  const insertMention = useCallback((userName: string) => {
    if (!editor || mentionStartRef.current === null) return;
    const from = mentionStartRef.current;
    const to = editor.state.selection.from;
    // Delete the @query text and insert the Zulip mention syntax
    editor.chain().focus()
      .deleteRange({ from, to })
      .insertContent(`@**${userName}** `)
      .run();
    setMentionQuery(null);
    setMentionPos(null);
    mentionStartRef.current = null;
  }, [editor]);

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
          insertMention(mentionUsers[mentionIndex].full_name);
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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Reset the input up-front so picking the same file twice in a row still
    // fires a change event.
    if (fileInputRef.current) fileInputRef.current.value = '';
    for (const file of files) {
      await handleFileUploadInternal(file);
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(emoji).run();
    setShowEmojiPicker(false);
  };

  const handleGifSelect = (gifUrl: string, altText: string) => {
    if (!editor) return;
    // Insert as markdown image link for Zulip
    editor.chain().focus().insertContent(`![${altText}](${gifUrl})`).run();
    setShowGifPicker(false);
  };

  if (!editor) return null;

  const isActive = (type: string, attrs?: Record<string, unknown>) =>
    editor.isActive(type, attrs);

  return (
    <div
      ref={composerRef}
      className="px-4 pb-6 flex-shrink-0"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className={`bg-surface-composer rounded-lg transition-colors ${dragOver ? 'ring-2 ring-brand bg-brand/10' : ''}`}>
        {/* Drag overlay */}
        {dragOver && (
          <div className="flex items-center justify-center py-4 text-sm text-brand font-medium">
            Drop files to upload
          </div>
        )}
        {/* Upload error banner */}
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
                    insertMention(user.full_name);
                  }}
                  onMouseEnter={() => setMentionIndex(i)}
                >
                  <Avatar className="size-6">
                    <AvatarImage src={user.avatar_url} alt={user.full_name} />
                    <AvatarFallback className="text-[10px]">{(user.full_name || '?')[0]}</AvatarFallback>
                  </Avatar>
                  <span className="truncate">{user.full_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 pb-2">
          <div className="flex items-center gap-0.5">
            <TooltipProvider>
              {/* File upload */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-gray-400 hover:text-gray-200 hover:bg-surface-hover"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <Loader2 className="size-5 animate-spin" />
                    ) : (
                      <Paperclip className="size-5" />
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
                      className={`size-8 hover:text-gray-200 hover:bg-surface-hover ${
                        showEmojiPicker ? 'text-gray-200 bg-surface-hover' : 'text-gray-400'
                      }`}
                      onClick={() => {
                        setShowEmojiPicker(!showEmojiPicker);
                        setShowGifPicker(false);
                      }}
                    >
                      <Smile className="size-5" />
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
                      className={`size-8 hover:text-gray-200 hover:bg-surface-hover ${
                        showGifPicker ? 'text-gray-200 bg-surface-hover' : 'text-gray-400'
                      }`}
                      onClick={() => {
                        setShowGifPicker(!showGifPicker);
                        setShowEmojiPicker(false);
                      }}
                    >
                      <ImageIcon className="size-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p>GIF</p></TooltipContent>
                </Tooltip>
              </div>

              {/* Divider */}
              <div className="w-px h-6 bg-[#4e5058] mx-1" />

              {/* Formatting buttons */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    variant="ghost"
                    size="icon"
                    className={`size-8 hover:text-gray-200 hover:bg-surface-hover ${
                      isActive('bold') ? 'text-white bg-surface-hover' : 'text-gray-400'
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
                    className={`size-8 hover:text-gray-200 hover:bg-surface-hover ${
                      isActive('italic') ? 'text-white bg-surface-hover' : 'text-gray-400'
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
                    className={`size-8 hover:text-gray-200 hover:bg-surface-hover ${
                      isActive('strike') ? 'text-white bg-surface-hover' : 'text-gray-400'
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
                    className={`size-8 hover:text-gray-200 hover:bg-surface-hover ${
                      isActive('orderedList') ? 'text-white bg-surface-hover' : 'text-gray-400'
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
                    className={`size-8 hover:text-gray-200 hover:bg-surface-hover ${
                      isActive('bulletList') ? 'text-white bg-surface-hover' : 'text-gray-400'
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
                    className={`size-8 hover:text-gray-200 hover:bg-surface-hover ${
                      isActive('blockquote') ? 'text-white bg-surface-hover' : 'text-gray-400'
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
                    className={`size-8 hover:text-gray-200 hover:bg-surface-hover ${
                      isActive('code') || isActive('codeBlock')
                        ? 'text-white bg-surface-hover'
                        : 'text-gray-400'
                    }`}
                  >
                    <Code className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Code</p></TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => {
                      // Insert a Zulip spoiler block as a code block with the
                      // "spoiler Header" infostring. tiptap-markdown serializes
                      // this back to ```spoiler Header on send. Critically:
                      // does NOT round-trip through clearContent/insertContent
                      // (which strips formatting and inserts literal backticks).
                      editor
                        .chain()
                        .focus()
                        .insertContent({
                          type: 'codeBlock',
                          attrs: { language: 'spoiler Header' },
                        })
                        .run();
                    }}
                    variant="ghost"
                    size="icon"
                    className="size-8 text-gray-400 hover:text-gray-200 hover:bg-surface-hover"
                  >
                    <Eye className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Spoiler</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <Button
            onClick={handleSend}
            disabled={sending}
            size="icon"
            className="size-8 bg-brand hover:bg-brand-hover disabled:bg-[#4e5058] disabled:text-gray-600"
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
