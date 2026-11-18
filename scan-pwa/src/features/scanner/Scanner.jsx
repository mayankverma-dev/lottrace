import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { useEffect, useRef, useState } from 'react';
import { CameraOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useNavigate } from 'react-router-dom';

export const Scanner = ({ onScan, onError }) => {
  const videoRef = useRef(null);
  const [permissionState, setPermissionState] = useState('starting');
  const navigate = useNavigate();
  const lastScanRef = useRef({ code: null, time: 0 });

  // Keep stable refs to callbacks so the scanner never restarts on re-renders.
  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    // Create the reader inside the effect so it's fully owned by this lifecycle.
    const reader = new BrowserMultiFormatReader();
    let cancelled = false;

    // ZXing emits noise on EVERY frame where no barcode is found — both via
    // console.warn AND console.error ("MultiFormatReader: non-ReaderException …").
    // Patch both for the scanner's lifetime to prevent DevTools memory bloat and
    // the resulting browser hang/unresponsiveness.
    const ZXING_NOISE_PATTERNS = ['NotFoundException', 'non-ReaderException', 'ChecksumException', 'FormatException'];
    const isZxingNoise = (args) => {
      return args.some((arg) => {
        if (typeof arg === 'string') {
          return ZXING_NOISE_PATTERNS.some((p) => arg.includes(p));
        }
        if (arg instanceof Error || (arg && typeof arg === 'object')) {
          return ZXING_NOISE_PATTERNS.some((p) =>
            (arg.name && typeof arg.name === 'string' && arg.name.includes(p)) ||
            (arg.message && typeof arg.message === 'string' && arg.message.includes(p)) ||
            (arg.toString && typeof arg.toString === 'function' && arg.toString().includes(p))
          );
        }
        return false;
      });
    };

    const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
      debug: console.debug,
      trace: console.trace,
    };

    Object.keys(originalConsole).forEach((method) => {
      console[method] = (...args) => {
        if (isZxingNoise(args)) return;
        originalConsole[method].apply(console, args);
      };
    });

    const fail = (err) => {
      if (cancelled) return;
      setPermissionState('denied');

      // Permission and missing-camera errors already have a dedicated fallback
      // screen; forward only genuinely unexpected failures to the caller.
      const name = err?.name;
      if (name !== 'NotAllowedError' && name !== 'NotFoundError') {
        onErrorRef.current?.(err);
      }
    };

    const startScanner = async () => {
      try {
        const devices = await reader.listVideoInputDevices();
        if (devices.length === 0) {
          if (!cancelled) setPermissionState('denied');
          return;
        }

        setPermissionState('granted');

        // ZXing returns a promise here. A denied getUserMedia call rejects it
        // asynchronously, so the surrounding try/catch cannot see it.
        const scanning = reader.decodeFromVideoDevice(null, videoRef.current, (result, err) => {
          if (result) {
            const code = result.getText()?.trim();
            if (!code) return; // Prevent empty scan triggers

            const now = Date.now();
            // De-duplicate: ignore same code scanned within 2 s
            if (
              code === lastScanRef.current.code &&
              now - lastScanRef.current.time < 2000
            ) {
              return;
            }
            lastScanRef.current = { code, time: now };
            onScanRef.current?.(code);
          }

          // err is set on EVERY frame where no barcode is found — this is expected
          // ZXing behaviour, not a real error. Only forward genuinely unexpected errors.
          if (err && !(err instanceof NotFoundException)) {
            // Also guard against the string-based name in case the bundler mangles classes
            const isIgnorableError = ['NotFoundException', 'ChecksumException', 'FormatException'].includes(err.name) ||
              ['NotFoundException', 'ChecksumException', 'FormatException'].includes(err.constructor?.name);
            if (!isIgnorableError) {
              onErrorRef.current?.(err);
            }
          }
        });

        if (scanning && typeof scanning.catch === 'function') {
          scanning.catch(fail);
        }
      } catch (err) {
        // Camera permission denied or not available
        fail(err);
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      // Restore patched console methods before teardown
      Object.keys(originalConsole).forEach((method) => {
        console[method] = originalConsole[method];
      });
      try {
        reader.reset();
      } catch (_) {
        // Ignore reset errors during unmount
      }
    };
  }, []); // Empty deps — scanner starts once and stays running for the component lifetime

  if (permissionState === 'denied') {
    return (
      <div className="text-center space-y-4 p-6">
        <CameraOff className="h-12 w-12 mx-auto text-muted-foreground" />
        <h3 className="font-semibold">Camera access needed</h3>
        <p className="text-sm text-muted-foreground">
          To scan barcodes, allow camera access in your browser settings.
        </p>
        <Button className="w-full min-h-[44px]" onClick={() => navigate('/manual')}>
          Enter Code Manually
        </Button>
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-[4/3] bg-black rounded-lg overflow-hidden">
      <video ref={videoRef} className="w-full h-full object-cover" />
      {permissionState !== 'granted' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white">
          <Spinner className="size-6" />
          <span className="text-sm">Starting camera…</span>
        </div>
      )}
      {/* Viewfinder overlay */}
      {permissionState === 'granted' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-64 h-64 border-2 border-white/70 rounded-lg" />
        </div>
      )}
    </div>
  );
};
