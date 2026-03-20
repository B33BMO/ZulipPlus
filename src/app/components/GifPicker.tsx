import { useState, useEffect } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';

interface GifPickerProps {
  onSelectGif: (gifUrl: string) => void;
}

interface GifData {
  id: string;
  images: {
    fixed_height_small: {
      url: string;
      width: string;
      height: string;
    };
  };
}

export function GifPicker({ onSelectGif }: GifPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [gifs, setGifs] = useState<GifData[]>([]);
  const [loading, setLoading] = useState(false);

  // Mock GIF data - in a real app, you would use the Giphy API
  // API Key would be: YOUR_GIPHY_API_KEY
  const mockGifs: GifData[] = [
    {
      id: '1',
      images: {
        fixed_height_small: {
          url: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=200&h=150&fit=crop',
          width: '200',
          height: '150'
        }
      }
    },
    {
      id: '2',
      images: {
        fixed_height_small: {
          url: 'https://images.unsplash.com/photo-1574158622682-e40e69881006?w=200&h=150&fit=crop',
          width: '200',
          height: '150'
        }
      }
    },
    {
      id: '3',
      images: {
        fixed_height_small: {
          url: 'https://images.unsplash.com/photo-1573865526739-10c1dd91e18c?w=200&h=150&fit=crop',
          width: '200',
          height: '150'
        }
      }
    },
    {
      id: '4',
      images: {
        fixed_height_small: {
          url: 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=200&h=150&fit=crop',
          width: '200',
          height: '150'
        }
      }
    },
    {
      id: '5',
      images: {
        fixed_height_small: {
          url: 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=200&h=150&fit=crop',
          width: '200',
          height: '150'
        }
      }
    },
    {
      id: '6',
      images: {
        fixed_height_small: {
          url: 'https://images.unsplash.com/photo-1615789591457-74a63395c990?w=200&h=150&fit=crop',
          width: '200',
          height: '150'
        }
      }
    }
  ];

  useEffect(() => {
    // Simulate loading trending gifs on mount
    setLoading(true);
    setTimeout(() => {
      setGifs(mockGifs);
      setLoading(false);
    }, 500);
  }, []);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      setLoading(true);
      // In a real app, you would call:
      // fetch(`https://api.giphy.com/v1/gifs/search?api_key=YOUR_API_KEY&q=${query}&limit=20`)
      setTimeout(() => {
        setGifs(mockGifs);
        setLoading(false);
      }, 500);
    } else {
      setGifs(mockGifs);
    }
  };

  return (
    <div className="w-80 h-96 bg-[#2b2d31] rounded-lg border border-[#1e1f22] flex flex-col">
      <div className="p-3 border-b border-[#1e1f22]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-500" />
          <Input
            type="text"
            placeholder="Search for GIFs"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10 bg-[#1e1f22] border-[#1e1f22] text-gray-200 placeholder:text-gray-500 focus-visible:ring-1 focus-visible:ring-[#5865f2]"
          />
        </div>
      </div>
      
      <ScrollArea className="flex-1 p-2">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-8 text-gray-400 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {gifs.map((gif) => (
              <button
                key={gif.id}
                onClick={() => onSelectGif(gif.images.fixed_height_small.url)}
                className="relative aspect-video rounded overflow-hidden hover:opacity-80 transition-opacity bg-[#1e1f22]"
              >
                <img
                  src={gif.images.fixed_height_small.url}
                  alt="GIF"
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
      
      <div className="p-2 border-t border-[#1e1f22]">
        <p className="text-xs text-gray-500 text-center">
          Powered by GIPHY
        </p>
      </div>
    </div>
  );
}
