import { useState } from 'react';
import { format } from 'date-fns';
import { Clock, RotateCcw } from 'lucide-react';

import { useGetEvents } from '@/api/events.api';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

const SOURCE_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Scan', value: 'scan' },
  { label: 'Manual', value: 'manual' },
];

const EVENT_TYPE_LABELS = {
  creation: 'Creation',
  receiving: 'Receiving',
  transformation: 'Transformation',
  shipping: 'Shipping',
};

const formatEventTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'MMM d, h:mm a');
};

const formatQuantity = (quantity, uom) => {
  if (quantity === null || quantity === undefined || quantity === '') return '';
  return `${Number(quantity).toLocaleString()} ${uom ?? ''}`.trim();
};

export default function HistoryPage() {
  const [cursorStack, setCursorStack] = useState([]);
  const [source, setSource] = useState('');
  const cursor = cursorStack[cursorStack.length - 1];

  const params = { limit: 20, ...(cursor ? { cursor } : {}), ...(source ? { source } : {}) };
  const { data, isLoading, isError, refetch, isFetching } = useGetEvents(params);

  const events = data?.data ?? [];
  const pagination = data?.pagination;

  const changeSource = (value) => {
    setSource(value);
    setCursorStack([]);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Clock className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Recent Events</h2>
      </div>

      <div className="flex gap-2">
        {SOURCE_FILTERS.map((filter) => (
          <button
            key={filter.value || 'all'}
            type="button"
            onClick={() => changeSource(filter.value)}
            className={[
              'min-h-[44px] flex-1 rounded-full border px-3 text-sm font-medium transition-colors',
              source === filter.value
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground border-border',
            ].join(' ')}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Spinner className="size-5" />
          Loading events…
        </div>
      )}

      {isError && !isLoading && (
        <div className="flex flex-col items-center gap-3 py-16">
          <p className="text-sm font-medium text-destructive">Failed to load events</p>
          <p className="text-xs text-muted-foreground text-center">Check your connection and try again.</p>
          <Button onClick={() => refetch()} className="min-h-[44px]">
            <RotateCcw data-icon="inline-start" />
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && events.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm font-medium">No events yet</p>
          <p className="text-xs text-muted-foreground">
            Scanned and manually entered events appear here.
          </p>
        </div>
      )}

      {!isLoading && !isError && events.length > 0 && (
        <ul className="flex flex-col gap-3">
          {events.map((event) => (
            <li key={event.id} className="rounded-lg border bg-background p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatEventTime(event.event_datetime)}
                    {event.location_name ? ` · ${event.location_name}` : ''}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                    {event.source}
                  </span>
                  {event.status !== 'active' && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium capitalize text-amber-800">
                      {event.status}
                    </span>
                  )}
                </div>
              </div>

              <ul className="mt-2 flex flex-col gap-1">
                {(event.lot_links ?? []).map((link) => (
                  <li key={`${event.id}-${link.id}-${link.direction}`} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono break-all">{link.traceabilityLotCode}</span>
                    <span className="text-muted-foreground whitespace-nowrap">
                      {formatQuantity(link.quantity, link.uom)}
                    </span>
                  </li>
                ))}
              </ul>

              {event.recorded_by_name && (
                <p className="mt-2 text-[11px] text-muted-foreground">Recorded by {event.recorded_by_name}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {pagination && (events.length > 0 || cursorStack.length > 0) && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            variant="outline"
            className="min-h-[44px]"
            onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
            disabled={cursorStack.length === 0 || isFetching}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {cursorStack.length + 1}
          </span>
          <Button
            variant="outline"
            className="min-h-[44px]"
            onClick={() => {
              if (pagination.nextCursor) {
                setCursorStack((stack) => [...stack, pagination.nextCursor]);
              }
            }}
            disabled={!pagination.hasNextPage || isFetching}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
