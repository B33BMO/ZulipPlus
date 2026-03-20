import { useState } from 'react';
import { Server, Mail, Key, LogIn } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useZulip } from '../context/ZulipContext';

export function SignIn() {
  const { login, loading: autoLogging } = useZulip();

  // Pre-fill from cached credentials if available
  const cached = localStorage.getItem('zulip_credentials');
  const defaults = cached ? JSON.parse(cached) : null;

  const [server, setServer] = useState(defaults?.server || 'https://zulip.cyburity.com');
  const [email, setEmail] = useState(defaults?.email || '');
  const [apiKey, setApiKey] = useState(defaults?.apiKey || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If auto-login is in progress, show a loading screen
  if (autoLogging) {
    return (
      <div className="size-full flex items-center justify-center bg-[#313338]">
        <div className="text-center">
          <div className="size-10 border-3 border-[#5865f2] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Signing in...</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !apiKey) {
      setError('Email and API key are required');
      return;
    }

    setLoading(true);
    try {
      await login(server, email, apiKey);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to sign in. Check your credentials.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="size-full flex items-center justify-center bg-[#313338]">
      <div className="w-full max-w-md p-8">
        <div className="bg-[#2b2d31] rounded-lg p-8 shadow-2xl">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white mb-2">
              Welcome to Zulip
            </h1>
            <p className="text-gray-400 text-sm">
              Sign in to your workspace
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Server URL */}
            <div className="space-y-2">
              <Label htmlFor="server" className="text-gray-300 text-xs uppercase font-semibold">
                Server URL
              </Label>
              <div className="relative">
                <Server className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-gray-500" />
                <Input
                  id="server"
                  type="text"
                  placeholder="https://yourorg.zulipchat.com"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  className="pl-11 bg-[#1e1f22] border-[#1e1f22] text-gray-200 placeholder:text-gray-500 focus-visible:ring-1 focus-visible:ring-[#5865f2] h-11"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-300 text-xs uppercase font-semibold">
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-gray-500" />
                <Input
                  id="email"
                  type="email"
                  placeholder="your.email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-11 bg-[#1e1f22] border-[#1e1f22] text-gray-200 placeholder:text-gray-500 focus-visible:ring-1 focus-visible:ring-[#5865f2] h-11"
                  disabled={loading}
                />
              </div>
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <Label htmlFor="apiKey" className="text-gray-300 text-xs uppercase font-semibold">
                API Key
              </Label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-gray-500" />
                <Input
                  id="apiKey"
                  type="password"
                  placeholder="Enter your API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="pl-11 bg-[#1e1f22] border-[#1e1f22] text-gray-200 placeholder:text-gray-500 focus-visible:ring-1 focus-visible:ring-[#5865f2] h-11"
                  disabled={loading}
                />
              </div>
              <p className="text-xs text-gray-500">
                You can find your API key in your Zulip account settings
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#5865f2] hover:bg-[#4752c4] text-white h-11 font-semibold"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="size-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <LogIn className="size-5" />
                  Sign In
                </span>
              )}
            </Button>
          </form>

          {/* Help Text */}
          <div className="mt-6 pt-6 border-t border-[#1e1f22]">
            <p className="text-xs text-gray-500 text-center">
              Don't have an API key?{' '}
              <a
                href="https://zulip.com/api/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#5865f2] hover:underline"
              >
                Learn how to get one
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
