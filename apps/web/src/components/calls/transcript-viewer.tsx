'use client';

import { useState, useMemo } from 'react';
import { Search, User, Bot, Monitor, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTimestamp } from '@/lib/utils';
import type { TranscriptSegment } from '@outbound-call/shared';
import type { Speaker } from '@outbound-call/shared';

const speakerConfig: Record<Speaker, { label: string; color: string; icon: React.ReactNode }> = {
  ai_agent: {
    label: 'AI Agent',
    color: 'bg-blue-50 border-blue-200 text-blue-900',
    icon: <Bot className="h-4 w-4 text-blue-600" />,
  },
  insurance_representative: {
    label: 'Representative',
    color: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    icon: <User className="h-4 w-4 text-emerald-600" />,
  },
  automated_phone_system: {
    label: 'Phone System',
    color: 'bg-slate-50 border-slate-200 text-slate-900',
    icon: <Monitor className="h-4 w-4 text-slate-600" />,
  },
  unknown: {
    label: 'Unknown',
    color: 'bg-gray-50 border-gray-200 text-gray-900',
    icon: <HelpCircle className="h-4 w-4 text-gray-600" />,
  },
};

interface TranscriptViewerProps {
  segments: TranscriptSegment[];
  highlightedSegmentIds?: string[];
  className?: string;
}

export function TranscriptViewer({
  segments,
  highlightedSegmentIds = [],
  className,
}: TranscriptViewerProps) {
  const [search, setSearch] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState<Speaker | 'all'>('all');

  const filteredSegments = useMemo(() => {
    let filtered = segments.filter((s) => s.isFinal);

    if (speakerFilter !== 'all') {
      filtered = filtered.filter((s) => s.speaker === speakerFilter);
    }

    if (search.trim()) {
      const lower = search.toLowerCase();
      filtered = filtered.filter((s) =>
        s.text.toLowerCase().includes(lower),
      );
    }

    return filtered.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }, [segments, speakerFilter, search]);

  const activeSpeakers = useMemo(() => {
    const speakers = new Set(segments.map((s) => s.speaker));
    return Array.from(speakers) as Speaker[];
  }, [segments]);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search transcript..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-firm-accent"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setSpeakerFilter('all')}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              speakerFilter === 'all'
                ? 'bg-navy-700 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            All
          </button>
          {activeSpeakers.map((speaker) => (
            <button
              key={speaker}
              onClick={() => setSpeakerFilter(speaker)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                speakerFilter === speaker
                  ? 'bg-navy-700 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              {speakerConfig[speaker].label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 max-h-[600px] overflow-y-auto">
        {filteredSegments.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">
            No transcript segments found.
          </p>
        ) : (
          filteredSegments.map((segment) => {
            const config = speakerConfig[segment.speaker];
            const isHighlighted = highlightedSegmentIds.includes(segment.id);

            return (
              <div
                key={segment.id}
                className={cn(
                  'flex gap-3 rounded-lg border p-3 transition-colors',
                  config.color,
                  isHighlighted && 'ring-2 ring-amber-400 ring-offset-1',
                )}
              >
                <div className="shrink-0 mt-0.5">{config.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold">
                      {config.label}
                    </span>
                    <span className="text-xs opacity-60">
                      {formatTimestamp(segment.startTimeMs)}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed">{segment.text}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
