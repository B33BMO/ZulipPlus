import { useState, useRef, useCallback } from 'react';
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
} from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';

interface MessageComposerProps {
  onSendMessage: (content: string) => Promise<void>;
  onFileUpload?: (file: File) => Promise<string>;
  placeholder?: string;
}

export function MessageComposer({
  onSendMessage,
  onFileUpload,
  placeholder = 'Type a message...',
}: MessageComposerProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      await onSendMessage(message);
      setMessage('');
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onFileUpload) return;

    setUploading(true);
    try {
      const uri = await onFileUpload(file);
      const markdown = file.type.startsWith('image/')
        ? `![${file.name}](${uri})`
        : `[${file.name}](${uri})`;
      setMessage((prev) => prev + (prev ? '\n' : '') + markdown);
    } catch (err) {
      console.error('Failed to upload file:', err);
    } finally {
      setUploading(false);
      // Reset input so same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const insertFormatting = useCallback(
    (before: string, after: string, cursorOffset: number) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = message.substring(start, end);

      const newText =
        message.substring(0, start) +
        before +
        selectedText +
        after +
        message.substring(end);
      setMessage(newText);

      setTimeout(() => {
        const newCursorPos = start + before.length + cursorOffset;
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    },
    [message]
  );

  return (
    <div className="px-4 pb-6 flex-shrink-0">
      <div className="bg-[#383a40] rounded-lg">
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="bg-transparent border-none text-gray-200 placeholder:text-gray-500 resize-none min-h-[44px] max-h-[200px] focus-visible:ring-0 focus-visible:ring-offset-0"
          rows={1}
          disabled={sending}
        />
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
                <TooltipContent>
                  <p>Attach file</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-gray-400 hover:text-gray-200 hover:bg-[#404249]"
                  >
                    <Smile className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Add emoji</p>
                </TooltipContent>
              </Tooltip>

              {/* Divider */}
              <div className="w-px h-6 bg-[#4e5058] mx-1" />

              {/* Formatting buttons */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => insertFormatting('**', '**', 2)}
                    variant="ghost"
                    size="icon"
                    className="size-8 text-gray-400 hover:text-gray-200 hover:bg-[#404249]"
                  >
                    <Bold className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Bold</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => insertFormatting('*', '*', 1)}
                    variant="ghost"
                    size="icon"
                    className="size-8 text-gray-400 hover:text-gray-200 hover:bg-[#404249]"
                  >
                    <Italic className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Italic</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => insertFormatting('~~', '~~', 2)}
                    variant="ghost"
                    size="icon"
                    className="size-8 text-gray-400 hover:text-gray-200 hover:bg-[#404249]"
                  >
                    <Strikethrough className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Strikethrough</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => insertFormatting('1. ', '', 3)}
                    variant="ghost"
                    size="icon"
                    className="size-8 text-gray-400 hover:text-gray-200 hover:bg-[#404249]"
                  >
                    <ListOrdered className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Numbered list</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => insertFormatting('- ', '', 2)}
                    variant="ghost"
                    size="icon"
                    className="size-8 text-gray-400 hover:text-gray-200 hover:bg-[#404249]"
                  >
                    <List className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Bulleted list</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() =>
                      insertFormatting('```quote\n', '\n```', 9)
                    }
                    variant="ghost"
                    size="icon"
                    className="size-8 text-gray-400 hover:text-gray-200 hover:bg-[#404249]"
                  >
                    <Quote className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Quote block</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() =>
                      insertFormatting('```spoiler Header\n', '\n```', 18)
                    }
                    variant="ghost"
                    size="icon"
                    className="size-8 text-gray-400 hover:text-gray-200 hover:bg-[#404249]"
                  >
                    <Eye className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Spoiler</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => insertFormatting('```\n', '\n```', 4)}
                    variant="ghost"
                    size="icon"
                    className="size-8 text-gray-400 hover:text-gray-200 hover:bg-[#404249]"
                  >
                    <Code className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Code block</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <Button
            onClick={handleSend}
            disabled={!message.trim() || sending}
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
