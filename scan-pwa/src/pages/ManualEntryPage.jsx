import { useState } from 'react';
import { toast } from 'sonner';
import { Keyboard, Search, ListPlus, RotateCcw, CheckCircle } from 'lucide-react';

import { findLotByCode } from '@/api/lots.api';
import { resolveScannedLotCode } from '@/lib/recordEventPayload';
import { CreateLotForm } from '@/features/lots/CreateLotForm';
import { QuickEventForm } from '@/features/events/QuickEventForm';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

const MANUAL_STATES = {
  ENTRY:      'entry',
  LOOKING_UP: 'looking_up',
  NOT_FOUND:  'not_found',
  CREATE_LOT: 'create_lot',
  EVENT_FORM: 'event_form',
  ERROR:      'error',
};

export default function ManualEntryPage() {
  const [manualState, setManualState] = useState(MANUAL_STATES.ENTRY);
  const [code, setCode]               = useState('');
  const [lotCode, setLotCode]         = useState('');
  const [items, setItems]             = useState([]);
  const isOnline = useOnlineStatus();

  const toScannedItem = (lot) => ({
    lotId: lot.id,
    tlc: lot.traceabilityLotCode,
    uom: lot.uom,
    quantity: Number(lot.quantity),
  });

  const handleLookup = async (event) => {
    event.preventDefault();
    const resolvedCode = resolveScannedLotCode(code);
    if (!resolvedCode) {
      toast.error('Enter a lot code');
      return;
    }

    setLotCode(resolvedCode);
    setManualState(MANUAL_STATES.LOOKING_UP);
    try {
      const lot = await findLotByCode(resolvedCode);
      if (lot) {
        setItems([toScannedItem(lot)]);
        setManualState(MANUAL_STATES.EVENT_FORM);
      } else {
        setManualState(MANUAL_STATES.NOT_FOUND);
      }
    } catch (err) {
      console.error('Manual lot lookup failed:', err);
      setManualState(MANUAL_STATES.ERROR);
    }
  };

  const resetToEntry = () => {
    setItems([]);
    setLotCode('');
    setCode('');
    setManualState(MANUAL_STATES.ENTRY);
  };

  const handleCreatedLot = (lot) => {
    setItems([toScannedItem(lot)]);
    setManualState(MANUAL_STATES.EVENT_FORM);
  };

  const handleSubmitted = () => {
    resetToEntry();
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      {!isOnline && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          You're offline. Reconnect to record events.
        </div>
      )}

      {manualState === MANUAL_STATES.ENTRY && (
        <form onSubmit={handleLookup} className="flex flex-col gap-4" noValidate>
          <div className="flex items-center gap-2">
            <Keyboard className="size-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Enter Lot Code</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Use this when the barcode is damaged. The code must match exactly.
          </p>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Lot code"
            autoComplete="off"
            autoCapitalize="characters"
            className="min-h-[44px] text-base font-mono"
            disabled={!isOnline}
          />
          <Button type="submit" className="w-full min-h-[44px]" disabled={!isOnline || !code.trim()}>
            <Search data-icon="inline-start" />
            Find Lot
          </Button>
        </form>
      )}

      {manualState === MANUAL_STATES.LOOKING_UP && (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <Spinner className="size-8" />
          <p className="text-sm text-muted-foreground">Looking up lot…</p>
        </div>
      )}

      {manualState === MANUAL_STATES.NOT_FOUND && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h3 className="font-semibold text-amber-900">Unknown Lot Code</h3>
            <p className="font-mono text-sm mt-1 text-amber-800 break-all">{lotCode}</p>
            <p className="text-sm text-amber-700 mt-2">This lot doesn't exist in your system yet.</p>
          </div>
          <Button
            className="w-full min-h-[44px]"
            onClick={() => setManualState(MANUAL_STATES.CREATE_LOT)}
            disabled={!isOnline}
          >
            <ListPlus data-icon="inline-start" />
            Create New Lot
          </Button>
          <Button variant="outline" className="w-full min-h-[44px]" onClick={resetToEntry}>
            <RotateCcw data-icon="inline-start" />
            Try Another Code
          </Button>
        </div>
      )}

      {manualState === MANUAL_STATES.CREATE_LOT && (
        <CreateLotForm
          lotCode={lotCode}
          disabled={!isOnline}
          onCreated={handleCreatedLot}
          onCancel={resetToEntry}
        />
      )}

      {manualState === MANUAL_STATES.EVENT_FORM && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center gap-2 text-emerald-800 font-medium mb-1">
              <CheckCircle className="size-5 text-emerald-600" />
              Lot Found
            </div>
            <p className="text-sm text-emerald-700 font-mono break-all ml-7">
              {items[0]?.tlc}
            </p>
          </div>
          <QuickEventForm
            items={items}
            source="manual"
            disabled={!isOnline}
            onSubmitted={handleSubmitted}
            onCancel={resetToEntry}
          />
        </div>
      )}

      {manualState === MANUAL_STATES.ERROR && (
        <div className="flex flex-col items-center justify-center gap-4 py-16">
          <p className="text-sm font-medium text-destructive">Lookup failed</p>
          <p className="text-xs text-muted-foreground text-center">Check your connection and try again.</p>
          <Button onClick={resetToEntry} className="min-h-[44px]">
            <RotateCcw data-icon="inline-start" />
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}
