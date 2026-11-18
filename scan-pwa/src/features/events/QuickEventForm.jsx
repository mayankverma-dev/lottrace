import { useRef } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Send, Trash2, RotateCcw } from 'lucide-react';

import { useGetLocations } from '@/api/locations.api';
import { useCreateEvent } from '@/api/events.api';
import { newIdempotencyKey } from '@/lib/idempotency';
import { enqueueEvent } from '@/lib/outbox';
import { refreshOutboxState } from '@/lib/outboxSync';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useAuthStore } from '@/stores/auth.store';
import { buildEventPayload, toPositiveQuantity } from '@/lib/recordEventPayload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';

const SELECT_CLASS = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-base min-h-[44px] focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50';

const quickEventSchema = z.object({
  eventType: z.enum(['receiving', 'shipping']),
  locationId: z.string().min(1, 'Select a location'),
  notes: z.string().max(2000).optional(),
  items: z.array(z.object({
    lotId: z.string().min(1),
    tlc: z.string(),
    uom: z.string().min(1),
    quantity: z.string().trim().min(1, 'Quantity is required').refine(
      (value) => toPositiveQuantity(value) !== null,
      'Quantity must be a positive number',
    ),
  })).min(1, 'At least one lot is required'),
});

/**
 * Minimal mobile event form shared by the scan and manual-entry flows.
 *
 * @param {{
 *   items: Array<{ lotId: string, tlc: string, uom: string, quantity: number }>,
 *   source: 'scan'|'manual',
 *   onSubmitted: () => void,
 *   onCancel: () => void,
 * }} props
 */
export const QuickEventForm = ({ items, source, onSubmitted, onCancel }) => {
  const { data: locationsData } = useGetLocations({ limit: 100 });
  const { mutateAsync: createEvent } = useCreateEvent();
  const isOnline = useOnlineStatus();
  const eventDatetimeRef = useRef(new Date().toISOString());
  const idempotencyRef = useRef({ signature: null, key: null });

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(quickEventSchema),
    defaultValues: {
      eventType: 'receiving',
      locationId: '',
      notes: '',
      items: items.map((item) => ({
        lotId: item.lotId,
        tlc: item.tlc,
        uom: item.uom,
        quantity: String(item.quantity ?? ''),
      })),
    },
  });

  const { fields, remove } = useFieldArray({ control, name: 'items' });

  const onSubmit = async (values) => {
    try {
      const payload = buildEventPayload({
        eventType: values.eventType,
        locationId: values.locationId,
        eventDatetime: eventDatetimeRef.current,
        notes: values.notes,
        source,
        items: values.items,
      });

      // Reuse one key for retries of the same logical submit. A changed
      // payload is a new operation and gets a new key.
      const signature = JSON.stringify(payload);
      if (idempotencyRef.current.signature !== signature) {
        idempotencyRef.current = { signature, key: newIdempotencyKey() };
      }
      const idempotencyKey = idempotencyRef.current.key;

      const queue = async () => {
        const user = useAuthStore.getState().user;
        if (!user?.id || !user?.organizationId) {
          throw new Error('Your session has expired. Sign in again.');
        }
        await enqueueEvent({
          organizationId: user.organizationId,
          userId: user.id,
          payload,
          idempotencyKey,
        });
        await refreshOutboxState();
        idempotencyRef.current = { signature: null, key: null };
        toast.success('Event queued — it will sync when you are online');
        onSubmitted();
      };

      if (!isOnline) {
        await queue();
        return;
      }

      try {
        await createEvent({ payload, idempotencyKey });
      } catch (err) {
        // A request that never reached the API is safe to queue: the same
        // idempotency key makes a later retry a no-op if it did arrive.
        if (!err.response) {
          await queue();
          return;
        }
        throw err;
      }

      idempotencyRef.current = { signature: null, key: null };
      toast.success('Event saved');
      onSubmitted();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to save event. Try again.');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      <FieldGroup className="gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="quick-event-type" className="text-sm font-medium">Event Type</label>
          <select
            id="quick-event-type"
            className={SELECT_CLASS}
            disabled={isSubmitting}
            {...register('eventType')}
          >
            <option value="receiving">Receiving</option>
            <option value="shipping">Shipping</option>
          </select>
        </div>

        <Field data-invalid={!!errors.locationId}>
          <FieldLabel htmlFor="quick-event-location">Location</FieldLabel>
          <select
            id="quick-event-location"
            className={SELECT_CLASS}
            aria-invalid={!!errors.locationId}
            disabled={isSubmitting}
            {...register('locationId')}
          >
            <option value="">Select Location…</option>
            {(locationsData?.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          {errors.locationId && <FieldError>{errors.locationId.message}</FieldError>}
        </Field>

        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium">
            Lots ({fields.length})
          </h4>
          <ul className="flex flex-col gap-2">
            {fields.map((field, index) => (
              <li key={field.id} className="rounded-lg border bg-muted/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-mono text-xs break-all pt-2">{field.tlc}</span>
                  {fields.length > 1 && (
                    <button
                      type="button"
                      className="text-xs text-destructive hover:text-destructive/80 transition-colors min-h-[44px] px-2"
                      onClick={() => remove(index)}
                      disabled={isSubmitting}
                    >
                      <Trash2 className="size-4" />
                      <span className="sr-only">Remove {field.tlc}</span>
                    </button>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-3">
                  <Field data-invalid={!!errors.items?.[index]?.quantity}>
                    <FieldLabel htmlFor={`quick-item-quantity-${index}`}>Quantity</FieldLabel>
                    <Input
                      id={`quick-item-quantity-${index}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      className="min-h-[44px] text-base"
                      aria-invalid={!!errors.items?.[index]?.quantity}
                      disabled={isSubmitting}
                      {...register(`items.${index}.quantity`)}
                    />
                    {errors.items?.[index]?.quantity && (
                      <FieldError>{errors.items[index].quantity.message}</FieldError>
                    )}
                  </Field>
                  <span className="pb-3 text-sm text-muted-foreground">{field.uom}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <Field data-invalid={!!errors.notes}>
          <FieldLabel htmlFor="quick-event-notes">Notes (optional)</FieldLabel>
          <Input
            id="quick-event-notes"
            className="min-h-[44px] text-base"
            aria-invalid={!!errors.notes}
            disabled={isSubmitting}
            {...register('notes')}
          />
          {errors.notes && <FieldError>{errors.notes.message}</FieldError>}
        </Field>
      </FieldGroup>

      <Button
        type="submit"
        className="w-full min-h-[44px]"
        disabled={isSubmitting}
      >
        {isSubmitting ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
        Save Event
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full min-h-[44px]"
        onClick={onCancel}
        disabled={isSubmitting}
      >
        <RotateCcw data-icon="inline-start" />
        Cancel
      </Button>
    </form>
  );
};
