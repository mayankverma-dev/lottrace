import { useState, useRef } from 'react';
import { Scanner } from '@/features/scanner/Scanner';
import { parseGS1 } from '@/utils/gs1Parser';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import { useGetLocations } from '@/api/locations.api';
import { useCreateEvent } from '@/api/events.api';
import { newIdempotencyKey } from '@/lib/idempotency';
import { toast } from 'sonner';
import { CheckCircle, Send, ListPlus, ScanLine, RotateCcw } from 'lucide-react';

const SCAN_STATES = {
  IDLE:       'idle',
  SCANNING:   'scanning',
  LOOKING_UP: 'looking_up',
  LOT_FOUND:  'lot_found',
  NOT_FOUND:  'not_found',
  EVENT_FORM: 'event_form',
  SUCCESS:    'success',
  ERROR:      'error',
};

export default function ScanPage() {
  const [scanState, setScanState]         = useState(SCAN_STATES.SCANNING);
  const [scannedLot, setScannedLot]       = useState(null);
  const [isBulkMode, setIsBulkMode]       = useState(false);
  const [scannedItems, setScannedItems]   = useState([]);
  const [showSuccess, setShowSuccess]     = useState(false);
  const [isSubmitting, setIsSubmitting]   = useState(false);

  const { data: locationsData } = useGetLocations({ limit: 100 });
  const { mutateAsync: createEvent } = useCreateEvent();
  const idempotencyRef = useRef({ signature: null, key: null });

  const [eventData, setEventData] = useState({
    locationId: '',
    eventType: 'receiving',
  });

  const showSuccessFeedback = () => {
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    setShowSuccess(true);
    setTimeout(() => {
      setShowSuccess(false);
      setScanState(SCAN_STATES.SCANNING);
    }, 1500);
  };

  const handleScan = async (code) => {
    if (!code || !code.trim()) return;
    
    if (navigator.vibrate) navigator.vibrate(50);
    const parsed = parseGS1(code);
    const lotCode = parsed.lotCode || parsed.raw;

    if (!lotCode || !lotCode.trim()) return;

    if (isBulkMode) {
      // Deduplicate
      if (scannedItems.find((i) => i.tlc === lotCode)) {
        toast.warning(`${lotCode} already scanned`);
        return;
      }
      try {
        const response = await api.get('/lots', {
          params: { traceabilityLotCode: lotCode, limit: 1 },
        });
        const lot = response.data?.data?.[0];
        if (lot) {
          setScannedItems((prev) => [
            ...prev,
            { tlc: lotCode, parsed, lotId: lot.id, uom: lot.uom },
          ]);
          if (navigator.vibrate) navigator.vibrate(100);
        } else {
          toast.error(`Lot "${lotCode}" not found in system`);
        }
      } catch (err) {
        console.error(err);
        toast.error('Failed to look up lot. Check your connection.');
      }
      return;
    }

    setScanState(SCAN_STATES.LOOKING_UP);
    try {
      const response = await api.get('/lots', {
        params: { traceabilityLotCode: lotCode, limit: 1 },
      });
      const lot = response.data?.data?.[0];
      if (lot) {
        setScannedLot({ tlc: lotCode, lotId: lot.id, uom: lot.uom });
        setScanState(SCAN_STATES.LOT_FOUND);
      } else {
        setScannedLot({ tlc: lotCode });
        setScanState(SCAN_STATES.NOT_FOUND);
      }
    } catch (err) {
      console.error('Scan lookup failed:', err);
      setScanState(SCAN_STATES.ERROR);
    }
  };

  const handleEventSubmit = async () => {
    if (!eventData.locationId) {
      toast.error('Select a location before saving');
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = {
        eventType: eventData.eventType,
        locationId: eventData.locationId,
        eventDatetime: new Date().toISOString(),
        source: 'scan',
        inputs: isBulkMode
          ? scannedItems.map((item) => ({
              lotId: item.lotId,
              quantity: 1,
              uom: item.uom,
            }))
          : [{ lotId: scannedLot.lotId, quantity: 1, uom: scannedLot.uom }],
        outputs: [],
      };

      // Reuse one key for retries of the same logical submit. A changed
      // payload is a new operation and gets a new key.
      const signature = JSON.stringify(payload);
      if (idempotencyRef.current.signature !== signature) {
        idempotencyRef.current = { signature, key: newIdempotencyKey() };
      }

      await createEvent({
        payload,
        idempotencyKey: idempotencyRef.current.key,
      });
      idempotencyRef.current = { signature: null, key: null };
      setScannedItems([]);
      setScannedLot(null);
      setEventData({ locationId: '', eventType: 'receiving' });
      showSuccessFeedback();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to save event. Try again.');
      setScanState(SCAN_STATES.ERROR);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBulkSubmit = () => {
    if (scannedItems.length === 0) return;
    setScanState(SCAN_STATES.EVENT_FORM);
  };

  const resetToScan = () => {
    setScannedLot(null);
    setEventData({ locationId: '', eventType: 'receiving' });
    setScanState(SCAN_STATES.SCANNING);
  };

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex-1 p-4 flex flex-col">

        {/* SCANNING */}
        {scanState === SCAN_STATES.SCANNING && (
          <div className="flex flex-col gap-4 flex-1">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Scan Barcode</h2>
              <button
                className={[
                  'text-sm px-3 py-1 rounded-full border font-medium transition-colors',
                  isBulkMode
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'bg-muted text-muted-foreground border-border',
                ].join(' ')}
                onClick={() => setIsBulkMode(!isBulkMode)}
              >
                {isBulkMode ? 'Bulk: ON' : 'Bulk: OFF'}
              </button>
            </div>

            <Scanner onScan={handleScan} />

            {isBulkMode && (
              <div className="flex flex-col gap-3 mt-2">
                <div className="rounded-lg border bg-muted/50 p-3 overflow-y-auto max-h-48">
                  <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                    Scanned ({scannedItems.length})
                  </h3>
                  {scannedItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Scan items to add them here</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {scannedItems.map((item, i) => (
                        <li
                          key={i}
                          className="flex items-center justify-between rounded-md border bg-background p-2 text-sm shadow-sm"
                        >
                          <span className="font-mono text-xs">{item.tlc}</span>
                          <button
                            onClick={() =>
                              setScannedItems((items) => items.filter((_, idx) => idx !== i))
                            }
                            className="text-xs text-destructive hover:text-destructive/80 transition-colors"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Button
                  onClick={handleBulkSubmit}
                  className="w-full min-h-[44px]"
                  disabled={scannedItems.length === 0}
                >
                  <Send data-icon="inline-start" />
                  Submit {scannedItems.length} Item{scannedItems.length !== 1 ? 's' : ''}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* LOOKING UP */}
        {scanState === SCAN_STATES.LOOKING_UP && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            <Spinner className="size-8" />
            <p className="text-sm text-muted-foreground">Looking up lot…</p>
          </div>
        )}

        {/* ERROR */}
        {scanState === SCAN_STATES.ERROR && (
          <div className="flex flex-col items-center justify-center flex-1 gap-4">
            <div className="rounded-full bg-destructive/10 p-4">
              <ScanLine className="size-8 text-destructive" />
            </div>
            <p className="text-sm font-medium text-destructive">Lookup failed</p>
            <p className="text-xs text-muted-foreground text-center">Check your connection and try again.</p>
            <Button onClick={resetToScan} className="min-h-[44px]">
              <RotateCcw data-icon="inline-start" />
              Try Again
            </Button>
          </div>
        )}

        {/* NOT FOUND */}
        {scanState === SCAN_STATES.NOT_FOUND && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="font-semibold text-amber-900">Unknown Lot Code</h3>
              <p className="font-mono text-sm mt-1 text-amber-800 break-all">{scannedLot?.tlc}</p>
              <p className="text-sm text-amber-700 mt-2">
                This lot doesn't exist in your system yet.
              </p>
            </div>
            <Button
              className="w-full min-h-[44px]"
              onClick={() => setScanState(SCAN_STATES.EVENT_FORM)}
            >
              <ListPlus data-icon="inline-start" />
              Create New Lot
            </Button>
            <Button
              variant="outline"
              className="w-full min-h-[44px]"
              onClick={resetToScan}
            >
              Cancel
            </Button>
          </div>
        )}

        {/* LOT FOUND */}
        {scanState === SCAN_STATES.LOT_FOUND && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 text-emerald-800 font-medium mb-1">
                <CheckCircle className="size-5 text-emerald-600" />
                Lot Found
              </div>
              <p className="text-sm text-emerald-700 font-mono break-all ml-7">
                {scannedLot?.tlc}
              </p>
            </div>
            <Button
              onClick={() => setScanState(SCAN_STATES.EVENT_FORM)}
              className="w-full min-h-[44px]"
            >
              Record Event for this Lot
            </Button>
            <Button
              variant="outline"
              onClick={resetToScan}
              className="w-full min-h-[44px]"
            >
              Scan Another
            </Button>
          </div>
        )}

        {/* EVENT FORM */}
        {scanState === SCAN_STATES.EVENT_FORM && (
          <div className="flex flex-col gap-5">
            <h3 className="font-semibold text-lg">Record Event</h3>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="event-type" className="text-sm font-medium">
                  Event Type
                </label>
                <select
                  id="event-type"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-ring/50"
                  value={eventData.eventType}
                  onChange={(e) =>
                    setEventData({ ...eventData, eventType: e.target.value })
                  }
                >
                  <option value="receiving">Receiving</option>
                  <option value="shipping">Shipping</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="event-location" className="text-sm font-medium">
                  Location
                </label>
                <select
                  id="event-location"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-ring/50"
                  value={eventData.locationId}
                  onChange={(e) =>
                    setEventData({ ...eventData, locationId: e.target.value })
                  }
                >
                  <option value="">Select Location…</option>
                  {locationsData?.data?.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Button
              onClick={handleEventSubmit}
              className="w-full min-h-[44px]"
              disabled={isSubmitting}
            >
              {isSubmitting && <Spinner data-icon="inline-start" />}
              Save Event
            </Button>
            <Button
              variant="outline"
              onClick={resetToScan}
              className="w-full min-h-[44px]"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* SUCCESS OVERLAY */}
      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-emerald-500/20 pointer-events-none">
          <div className="rounded-full bg-emerald-500 p-6 shadow-xl animate-in zoom-in duration-200">
            <CheckCircle className="size-12 text-white" />
          </div>
        </div>
      )}
    </div>
  );
}
