import { useState } from 'react';
import { Scanner } from '@/features/scanner/Scanner';
import { CreateLotForm } from '@/features/lots/CreateLotForm';
import { QuickEventForm } from '@/features/events/QuickEventForm';
import { resolveScannedLotCode } from '@/lib/recordEventPayload';
import { findLotByCode } from '@/api/lots.api';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { CheckCircle, Send, ListPlus, ScanLine, RotateCcw } from 'lucide-react';

const SCAN_STATES = {
  SCANNING:    'scanning',
  LOOKING_UP:  'looking_up',
  LOT_FOUND:   'lot_found',
  NOT_FOUND:   'not_found',
  CREATE_LOT:  'create_lot',
  EVENT_FORM:  'event_form',
  ERROR:       'error',
};

export default function ScanPage() {
  const [scanState, setScanState]       = useState(SCAN_STATES.SCANNING);
  const [scannedLot, setScannedLot]     = useState(null);
  const [isBulkMode, setIsBulkMode]     = useState(false);
  const [scannedItems, setScannedItems] = useState([]);
  const [showSuccess, setShowSuccess]   = useState(false);
  const isOnline = useOnlineStatus();

  const showSuccessFeedback = () => {
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    setShowSuccess(true);
    setTimeout(() => {
      setShowSuccess(false);
      setScanState(SCAN_STATES.SCANNING);
    }, 1500);
  };

  const toScannedItem = (lot, lotCode) => ({
    lotId: lot.id,
    tlc: lotCode,
    uom: lot.uom,
    quantity: Number(lot.quantity),
  });

  const handleScan = async (code) => {
    const lotCode = resolveScannedLotCode(code);
    if (!lotCode) return;

    if (navigator.vibrate) navigator.vibrate(50);

    if (isBulkMode) {
      if (scannedItems.some((item) => item.tlc === lotCode)) {
        toast.warning(`${lotCode} already scanned`);
        return;
      }
      try {
        const lot = await findLotByCode(lotCode);
        if (lot) {
          setScannedItems((prev) => [...prev, toScannedItem(lot, lotCode)]);
          if (navigator.vibrate) navigator.vibrate(100);
        } else {
          setScannedLot({ tlc: lotCode });
          setScanState(SCAN_STATES.NOT_FOUND);
        }
      } catch (err) {
        console.error(err);
        toast.error('Failed to look up lot. Check your connection.');
      }
      return;
    }

    setScanState(SCAN_STATES.LOOKING_UP);
    try {
      const lot = await findLotByCode(lotCode);
      if (lot) {
        setScannedLot(toScannedItem(lot, lotCode));
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

  const handleCreatedLot = (lot) => {
    const item = toScannedItem(lot, lot.traceabilityLotCode);

    if (isBulkMode) {
      setScannedItems((prev) => [...prev, item]);
      setScannedLot(null);
      setScanState(SCAN_STATES.SCANNING);
      return;
    }

    setScannedItems([item]);
    setScannedLot(null);
    setScanState(SCAN_STATES.EVENT_FORM);
  };

  const handleRecordFoundLot = () => {
    if (!scannedLot?.lotId) return;
    setScannedItems([scannedLot]);
    setScanState(SCAN_STATES.EVENT_FORM);
  };

  const handleBulkSubmit = () => {
    if (scannedItems.length === 0) return;
    setScanState(SCAN_STATES.EVENT_FORM);
  };

  const handleEventSubmitted = () => {
    setScannedItems([]);
    setScannedLot(null);
    setScanState(SCAN_STATES.SCANNING);
    showSuccessFeedback();
  };

  const resetToScan = () => {
    setScannedLot(null);
    setScanState(SCAN_STATES.SCANNING);
  };

  const cancelCreateLot = () => {
    setScannedLot(null);
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

            <Scanner
              onScan={handleScan}
              onError={(err) => toast.error(err?.message || 'Camera error')}
            />

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
                          key={item.lotId}
                          className="flex items-center justify-between rounded-md border bg-background p-2 text-sm shadow-sm"
                        >
                          <span className="font-mono text-xs break-all">{item.tlc}</span>
                          <button
                            onClick={() =>
                              setScannedItems((items) => items.filter((_, idx) => idx !== i))
                            }
                            className="text-xs text-destructive hover:text-destructive/80 transition-colors min-h-[44px] px-2"
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
              onClick={() => setScanState(SCAN_STATES.CREATE_LOT)}
              disabled={!isOnline}
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

        {/* CREATE LOT */}
        {scanState === SCAN_STATES.CREATE_LOT && (
          <CreateLotForm
            lotCode={scannedLot?.tlc ?? ''}
            disabled={!isOnline}
            onCreated={handleCreatedLot}
            onCancel={cancelCreateLot}
          />
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
              onClick={handleRecordFoundLot}
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
            <QuickEventForm
              items={scannedItems}
              source="scan"
              onSubmitted={handleEventSubmitted}
              onCancel={resetToScan}
            />
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
