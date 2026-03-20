import { useCallback, useRef, useState, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
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

interface RichComposerProps {
  onSendMessage: (content: string) => Promise<void>;
  onFileUpload?: (file: File) => Promise<string>;
  placeholder?: string;
}

export function RichComposer({
  onSendMessage,
  onFileUpload,
  placeholder = 'Type a message...',
}: RichComposerProps) {
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const gifRef = useRef<HTMLDivElement>(null);

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
        HTMLAttributes: { class: 'text-[#5865f2] underline' },
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
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          handleSend();
          return true;
        }
        return false;
      },
    },
    content: '',
  });

  // Close pickers on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
      if (gifRef.current && !gifRef.current.contains(e.target as Node)) {
        setShowGifPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSend = useCallback(async () => {
    if (!editor || sending) return;

    // Get markdown content from editor
    const markdown = editor.storage.markdown.getMarkdown();
    if (!markdown.trim()) return;

    setSending(true);
    try {
      await onSendMessage(markdown);
      editor.commands.clearContent();
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  }, [editor, sending, onSendMessage]);

  // Update handleKeyDown when handleSend changes
  useEffect(() => {
    if (!editor) return;
    // Re-register the key handler by updating editor props
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        handleKeyDown: (_view, event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleSend();
            return true;
          }
          return false;
        },
      },
    });
  }, [editor, handleSend]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onFileUpload || !editor) return;

    setUploading(true);
    try {
      const uri = await onFileUpload(file);
      if (file.type.startsWith('image/')) {
        editor.chain().focus().setImage({ src: uri, alt: file.name }).run();
      } else {
        editor
          .chain()
          .focus()
          .insertContent(`[${file.name}](${uri})`)
          .run();
      }
    } catch (err) {
      console.error('Failed to upload file:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
    <div className="px-4 pb-6 flex-shrink-0">
      <div className="bg-[#383a40] rounded-lg">
        {/* Editor Area */}
        <EditorContent editor={editor} />

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
                    className="size-8 text-gray-400 hover:text-gray-200 hover:bg-[#404249]"
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
              <div ref={emojiRef} className="relative">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`size-8 hover:text-gray-200 hover:bg-[#404249] ${
                        showEmojiPicker ? 'text-gray-200 bg-[#404249]' : 'text-gray-400'
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
                {showEmojiPicker && (
                  <div className="absolute bottom-10 left-0 z-50">
                    <EmojiPicker onSelect={handleEmojiSelect} />
                  </div>
                )}
              </div>

              {/* GIF picker */}
              <div ref={gifRef} className="relative">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`size-8 hover:text-gray-200 hover:bg-[#404249] ${
                        showGifPicker ? 'text-gray-200 bg-[#404249]' : 'text-gray-400'
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
                {showGifPicker && (
                  <div className="absolute bottom-10 left-0 z-50">
                    <GifPicker onSelect={handleGifSelect} />
                  </div>
                )}
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
                    className={`size-8 hover:text-gray-200 hover:bg-[#404249] ${
                      isActive('bold') ? 'text-white bg-[#404249]' : 'text-gray-400'
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
                    className={`size-8 hover:text-gray-200 hover:bg-[#404249] ${
                      isActive('italic') ? 'text-white bg-[#404249]' : 'text-gray-400'
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
                    className={`size-8 hover:text-gray-200 hover:bg-[#404249] ${
                      isActive('strike') ? 'text-white bg-[#404249]' : 'text-gray-400'
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
                    className={`size-8 hover:text-gray-200 hover:bg-[#404249] ${
                      isActive('orderedList') ? 'text-white bg-[#404249]' : 'text-gray-400'
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
                    className={`size-8 hover:text-gray-200 hover:bg-[#404249] ${
                      isActive('bulletList') ? 'text-white bg-[#404249]' : 'text-gray-400'
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
                    className={`size-8 hover:text-gray-200 hover:bg-[#404249] ${
                      isActive('blockquote') ? 'text-white bg-[#404249]' : 'text-gray-400'
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
                    className={`size-8 hover:text-gray-200 hover:bg-[#404249] ${
                      isActive('code') || isActive('codeBlock')
                        ? 'text-white bg-[#404249]'
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
                      // Insert spoiler as markdown (Zulip-specific)
                      const markdown = editor.storage.markdown.getMarkdown();
                      editor.commands.clearContent();
                      editor.commands.insertContent(
                        markdown + '\n```spoiler Header\n\n```'
                      );
                    }}
                    variant="ghost"
                    size="icon"
                    className="size-8 text-gray-400 hover:text-gray-200 hover:bg-[#404249]"
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
            className="size-8 bg-[#5865f2] hover:bg-[#4752c4] disabled:bg-[#4e5058] disabled:text-gray-600"
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
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}
