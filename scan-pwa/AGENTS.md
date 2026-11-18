# LotTrace Scan PWA — AI Context

> Read this when working in `/scan-pwa`.
> Also read root `AGENTS.md` + `frontend/AGENTS.md` (same patterns apply) + `docs/UI_DESIGN_SYSTEM.md`.

---

## What This App Is
A mobile-first Progressive Web App for warehouse/floor workers.
Primary use: scan barcodes → look up lots → record events (receiving, shipping) in 2–3 taps.
Secondary: manual lot code entry when barcode is damaged.

This is **NOT** the full dashboard. It is a focused, fast scanning interface.

---

## Stack (Same as `/frontend` plus PWA plugins)
React 18 + Vite + JavaScript + Tailwind + shadcn/ui + `@zxing/library` + `vite-plugin-pwa`

---

## Mobile-First Rules (Strict)

### Touch Targets
- **All interactive elements minimum 44×44px** — use `min-h-[44px]` on buttons
- Buttons always `w-full` unless inside an inline row
- Font size minimum `text-base` (16px) — prevents iOS zoom on input focus

### Inputs
```jsx
// Always use text-base to prevent iOS auto-zoom
<Input className="text-base min-h-[44px]" ... />
```

### Layout
- No sidebar — bottom nav tabs only
- Content: `px-4 py-6` padding
- Stack everything vertically — no side-by-side columns on mobile

### Bottom Navigation
```jsx
const SCAN_NAV = [
  { label: 'Scan',    path: '/scan',     icon: ScanLine },
  { label: 'History', path: '/history',  icon: Clock },
  { label: 'Manual',  path: '/manual',   icon: Keyboard },
];
```

---

## Camera Scanning (`@zxing/library`)

```javascript
// features/scanner/Scanner.jsx
import { BrowserMultiFormatReader } from '@zxing/library';
import { useEffect, useRef, useState } from 'react';

export const Scanner = ({ onScan, onError }) => {
  const videoRef = useRef(null);
  const readerRef = useRef(new BrowserMultiFormatReader());

  useEffect(() => {
    const reader = readerRef.current;

    reader.decodeFromVideoDevice(null, videoRef.current, (result, err) => {
      if (result) {
        // Debounce: ignore same code within 2 seconds
        onScan(result.getText());
      }
    });

    return () => reader.reset();
  }, []);

  return (
    <div className="relative w-full aspect-[4/3] bg-black rounded-lg overflow-hidden">
      <video ref={videoRef} className="w-full h-full object-cover" />
      {/* Viewfinder overlay */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-64 h-64 border-2 border-white/70 rounded-lg" />
      </div>
    </div>
  );
};
```

### Camera Permission Handling
```jsx
// Always handle permission denied gracefully
const [permissionState, setPermissionState] = useState('prompt'); // prompt | granted | denied

// On denied:
<div className="text-center space-y-4 p-6">
  <CameraOff className="h-12 w-12 mx-auto text-muted-foreground" />
  <h3 className="font-semibold">Camera access needed</h3>
  <p className="text-sm text-muted-foreground">
    To scan barcodes, allow camera access in your browser settings.
  </p>
  <Button onClick={() => navigate('/manual')}>Enter Code Manually</Button>
</div>
```

---

## Scan Flow (State Machine)

```
IDLE → [user taps Scan] → SCANNING
SCANNING → [code detected] → LOOKING_UP (API call)
LOOKING_UP → [lot found] → LOT_FOUND (show lot details)
LOOKING_UP → [lot not found] → CREATE_PROMPT ("Create new lot with this code?")
LOT_FOUND → [user taps Record Event] → EVENT_FORM
EVENT_FORM → [submit] → SUCCESS (green flash) → IDLE (reset after 2s)
```

```javascript
// Scan session state
const SCAN_STATES = {
  IDLE:          'idle',
  SCANNING:      'scanning',
  LOOKING_UP:    'looking_up',
  LOT_FOUND:     'lot_found',
  NOT_FOUND:     'not_found',
  EVENT_FORM:    'event_form',
  SUCCESS:       'success',
  ERROR:         'error',
};
```

### Duplicate Scan Detection
```javascript
const lastScanRef = useRef({ code: null, time: 0 });

const handleScan = (code) => {
  const now = Date.now();
  // Ignore same code within 2 seconds
  if (code === lastScanRef.current.code && now - lastScanRef.current.time < 2000) return;
  lastScanRef.current = { code, time: now };
  processCode(code);
};
```

---

## GS1-128 / Data Matrix Parsing

```javascript
// utils/gs1Parser.js
// Parse GS1 Application Identifiers from structured barcodes
const GS1_AIS = {
  '01': 'gtin',     // 14 digits
  '10': 'lotCode',  // variable length
  '11': 'prodDate', // YYMMDD
  '17': 'expDate',  // YYMMDD
  '30': 'quantity', // variable
};

export const parseGS1 = (rawCode) => {
  // Try to extract AIs — fall back to raw code if not GS1
  const result = { raw: rawCode };
  // GS1 codes start with FNC1 or are structured with AIs
  // Simple check: if code starts with known AI
  if (/^\d{2}/.test(rawCode)) {
    // Attempt AI parsing
    let pos = 0;
    while (pos < rawCode.length) {
      const ai = rawCode.substring(pos, pos + 2);
      if (GS1_AIS[ai]) {
        // Extract value (fixed or variable length)
        // ... parsing logic
      } else break;
    }
  }
  return result;
};
```

---

## Bulk Scan Mode (Sequential Receiving)

```jsx
// For receiving multiple lots in sequence
const BulkScanMode = () => {
  const [scannedLots, setScannedLots] = useState([]);

  const handleScan = (code) => {
    // Add to list, don't navigate away
    setScannedLots(prev => [...prev, { code, scannedAt: new Date() }]);
    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(100);
  };

  return (
    <div>
      <Scanner onScan={handleScan} />
      <div className="mt-4 space-y-2">
        {scannedLots.map((lot, i) => (
          <div key={i} className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
            <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
            <span className="font-mono text-sm">{lot.code}</span>
          </div>
        ))}
      </div>
      {scannedLots.length > 0 && (
        <Button className="w-full mt-4" onClick={submitAll}>
          Record {scannedLots.length} Lots as Received
        </Button>
      )}
    </div>
  );
};
```

---

## Success Feedback

```javascript
// Visual feedback on successful scan/submit
const showSuccessFeedback = () => {
  // 1. Haptic
  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  // 2. Visual — brief green overlay
  setShowSuccess(true);
  setTimeout(() => setShowSuccess(false), 1500);
};

// In JSX:
{showSuccess && (
  <div className="fixed inset-0 bg-green-500/20 flex items-center justify-center z-50 pointer-events-none">
    <div className="bg-green-500 text-white rounded-full p-6">
      <CheckCircle className="h-12 w-12" />
    </div>
  </div>
)}
```

---

## PWA Configuration (`vite.config.js`)

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'LotTrace Scanner',
        short_name: 'LotTrace',
        description: 'Scan barcodes and record supply chain events',
        theme_color: '#3b82f6',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/scan',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
});
```

> Do not add Workbox runtime caching for `/api/**`. Authenticated responses must
> never enter Cache Storage. The app shell is precached; API data is network-only.
> Purge `api-cache` on logout and auth failure via `purgeApiCache()`.

> `pnpm --filter scan-pwa build` runs `scripts/verify-pwa-build.mjs` after Vite.
> The build fails if `registerSW.js`, `manifest.webmanifest`, the PNG icons, or
> the precache entries are missing, if icon dimensions do not match the manifest,
> or if the service worker starts caching API routes.

---

## Scan PWA Page Structure

```
scan-pwa/src/
├── main.jsx
├── App.jsx             ← Bottom nav layout
├── lib/
│   ├── api.js          ← Same axios pattern as frontend
│   └── queryClient.js
├── api/
│   ├── lots.api.js
│   └── events.api.js
├── pages/
│   ├── ScanPage.jsx        ← Camera + scan flow
│   ├── HistoryPage.jsx     ← Recently scanned lots
│   └── ManualEntryPage.jsx ← Type lot code manually
├── features/
│   ├── scanner/
│   │   ├── Scanner.jsx
│   │   ├── ScanResult.jsx
│   │   └── CreateLotPrompt.jsx
│   └── events/
│       ├── QuickEventForm.jsx  ← Minimal mobile form (CTE)
│       └── BulkScanMode.jsx
└── utils/
    ├── gs1Parser.js
    └── haptics.js
```

---

## Offline Handling
- Show banner when offline: `"You're offline — scans will sync when reconnected"`
- Do NOT cache authenticated API responses in the service worker or Cache Storage
- Lot lookup is network-only; there is no offline lookup in v1
- Do NOT allow event submission while offline in v1 — show clear "No connection" state
- A future offline store must be keyed by `organizationId`/`userId` and purged on logout
- Offline-first sync is Phase 4 scope

```javascript
// Offline detection
window.addEventListener('online', () => toast.success('Back online'));
window.addEventListener('offline', () => toast.warning("You're offline"));
```
