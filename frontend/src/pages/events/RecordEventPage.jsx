import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, ClipboardList, AlertCircle } from 'lucide-react';

import { useCreateEvent, useGetAttachmentUploadUrl, useAddAttachment, useGetEvent, useAmendEvent } from '@/api/events.api';
import { newIdempotencyKey } from '@/lib/idempotency';
import { useGetLocations } from '@/api/locations.api';
import { useGetLots } from '@/api/lots.api';
import { useGetProducts } from '@/api/products.api';

import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { buildEventPayload, hasAmendReason } from './recordEventPayload';

const CTE_TYPES = [
  { value: 'creation', label: 'Creation' },
  { value: 'receiving', label: 'Receiving' },
  { value: 'transformation', label: 'Transformation' },
  { value: 'shipping', label: 'Shipping' },
];

const SHOWS_INPUTS = ['receiving', 'transformation', 'shipping'];
const SHOWS_OUTPUTS = ['creation', 'receiving', 'transformation'];

const emptyLotRow = () => ({ lotId: '', quantity: 1, uom: 'kg' });

export default function RecordEventPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const amendEventId = searchParams.get('amendEventId');

  const { data: amendEventData, isLoading: isLoadingAmend } = useGetEvent(amendEventId);
  const { mutateAsync: createEvent, isPending: isCreating } = useCreateEvent();
  const { mutateAsync: amendEvent, isPending: isAmending } = useAmendEvent();
  const isPending = isCreating || isAmending;

  const { data: locationsData } = useGetLocations({ limit: 100 });
  const { data: lotsData } = useGetLots({ limit: 100 });
  const { data: productsData } = useGetProducts({ limit: 100 });

  const lots = lotsData?.data ?? [];
  const locations = locationsData?.data ?? [];
  const products = productsData?.data ?? [];

  const [formData, setFormData] = useState({
    eventType: 'receiving',
    locationId: '',
    eventDatetime: new Date().toISOString().slice(0, 16),
    notes: '',
    amendReason: '', // only used if amending
    counterpartyName: '',
    counterpartyLotCode: '',
  });

  const [inputs, setInputs] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [kdePayload, setKdePayload] = useState({});
  const idempotencyRef = useRef({ signature: null, key: null });
  const attachmentKeysRef = useRef(new Map());

  useEffect(() => {
    if (amendEventId && amendEventData?.data) {
      const e = amendEventData.data;
      let cp = {};
      try {
        if (e.counterparty_info) {
          cp = typeof e.counterparty_info === 'string' ? JSON.parse(e.counterparty_info) : e.counterparty_info;
        }
      } catch (err) {
        console.error('Failed to parse counterparty info', err);
      }
      
      setFormData({
        eventType: e.event_type,
        locationId: e.location_id || '',
        eventDatetime: new Date(e.event_datetime).toISOString().slice(0, 16),
        notes: e.notes || '',
        amendReason: '',
        counterpartyName: cp.name || '',
        counterpartyLotCode: cp.lotCode || '',
      });
      setInputs((e.inputs || []).map(i => ({ lotId: String(i.lot_id), quantity: i.quantity, uom: i.uom })));
      setOutputs((e.outputs || []).map(o => ({ lotId: String(o.lot_id), quantity: o.quantity, uom: o.uom })));
      setKdePayload(e.kde_payload || {});
    }
  }, [amendEventId, amendEventData]);

  const setSelect = (field) => (val) => setFormData((prev) => ({ ...prev, [field]: val }));
  const setInput = (field) => (e) => setFormData((prev) => ({ ...prev, [field]: e.target.value }));

  const updateRow = (setter) => (index, field, value) => {
    setter((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: field === 'quantity' ? Number(value) : value,
      };
      return next;
    });
  };

  const removeRow = (setter) => (index) => setter((prev) => prev.filter((_, i) => i !== index));

  const updateInput = updateRow(setInputs);
  const updateOutput = updateRow(setOutputs);
  const removeInput = removeRow(setInputs);
  const removeOutput = removeRow(setOutputs);

  const { mutateAsync: getUploadUrl } = useGetAttachmentUploadUrl();
  const { mutateAsync: addAttachment } = useAddAttachment();

  const [files, setFiles] = useState([]);
  const handleFileChange = (e) => {
    if (e.target.files.length > 0) setFiles(Array.from(e.target.files));
  };

  // Compute required KDEs dynamically based on selected lots' products
  const requiredKDEs = useMemo(() => {
    const activeLotIds = [];
    if (SHOWS_INPUTS.includes(formData.eventType)) activeLotIds.push(...inputs.map(i => i.lotId).filter(Boolean));
    if (SHOWS_OUTPUTS.includes(formData.eventType)) activeLotIds.push(...outputs.map(i => i.lotId).filter(Boolean));

    const kdes = new Map();
    activeLotIds.forEach(lotId => {
      const lot = lots.find(l => String(l.id) === lotId);
      if (!lot) return;
      const product = products.find(p => p.id === lot.productId);
      if (!product || !product.custom_kde_schema) return;
      
      let schema = [];
      try {
        schema = typeof product.custom_kde_schema === 'string' ? JSON.parse(product.custom_kde_schema) : product.custom_kde_schema;
      } catch (e) {
        // ignore parse error
      }
      
      schema.forEach(field => {
        if (!kdes.has(field.name)) {
          kdes.set(field.name, field);
        }
      });
    });
    
    return Array.from(kdes.values());
  }, [inputs, outputs, formData.eventType, lots, products]);

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = buildEventPayload({
        formData,
        inputs,
        outputs,
        kdePayload,
        isAmending: Boolean(amendEventId),
      });
      
      let eventId;
      if (amendEventId) {
        if (!hasAmendReason(formData.amendReason)) {
          toast.error('Amendment reason is required');
          return;
        }
        const signature = JSON.stringify({ eventId: amendEventId, payload });
        if (idempotencyRef.current.signature !== signature) {
          idempotencyRef.current = { signature, key: newIdempotencyKey() };
        }
        const res = await amendEvent({
          eventId: amendEventId,
          payload,
          idempotencyKey: idempotencyRef.current.key,
        });
        idempotencyRef.current = { signature: null, key: null };
        eventId = res.data.data.id;
        toast.success('Event amended successfully');
      } else {
        // Reuse one key for retries of the same logical submit. A changed
        // payload is a new operation and gets a new key.
        const signature = JSON.stringify(payload);
        if (idempotencyRef.current.signature !== signature) {
          idempotencyRef.current = { signature, key: newIdempotencyKey() };
        }
        const res = await createEvent({
          payload,
          idempotencyKey: idempotencyRef.current.key,
        });
        idempotencyRef.current = { signature: null, key: null };
        eventId = res.data.data.id;
        toast.success('Event recorded successfully');
      }

      if (files.length > 0) {
        for (const file of files) {
          const fileSignature = `${eventId}:${file.name}:${file.type}:${file.size}`;
          let attachmentKeys = attachmentKeysRef.current.get(fileSignature);
          if (!attachmentKeys) {
            attachmentKeys = { upload: newIdempotencyKey(), add: newIdempotencyKey() };
            attachmentKeysRef.current.set(fileSignature, attachmentKeys);
          }

          const urlRes = await getUploadUrl({
            eventId,
            payload: { filename: file.name, contentType: file.type },
            idempotencyKey: attachmentKeys.upload,
          });
          const { uploadUrl, key } = urlRes.data.data;
          
          await fetch(uploadUrl, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type },
          });

          await addAttachment({
            eventId,
            payload: { key, filename: file.name, contentType: file.type, sizeBytes: file.size },
            idempotencyKey: attachmentKeys.add,
          });
          attachmentKeysRef.current.delete(fileSignature);
        }
      }

      navigate('/events');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record event');
    }
  };

  if (amendEventId && isLoadingAmend) {
    return <div className="p-8"><Skeleton className="h-96 w-full" /></div>;
  }

  const LotRows = ({ items, updateFn, removeFn, addFn, title }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={addFn}>
          <Plus className="h-4 w-4 mr-1" />
          Add Lot
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">No lots added yet.</p>
        )}
        {items.map((item, i) => (
          <div key={i} className="flex gap-3 items-end">
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <Label className="text-xs text-muted-foreground">Lot</Label>
              <Select value={item.lotId} onValueChange={(val) => updateFn(i, 'lotId', val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select lot…" />
                </SelectTrigger>
                <SelectContent>
                  {lots.map((lot) => (
                    <SelectItem key={lot.id} value={String(lot.id)}>
                      {lot.traceabilityLotCode}
                      {lot.productName ? ` — ${lot.productName}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5 w-24 shrink-0">
              <Label className="text-xs text-muted-foreground">Qty</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={item.quantity}
                onChange={(e) => updateFn(i, 'quantity', e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5 w-20 shrink-0">
              <Label className="text-xs text-muted-foreground">UOM</Label>
              <Input
                value={item.uom}
                onChange={(e) => updateFn(i, 'uom', e.target.value)}
                placeholder="kg"
              />
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive shrink-0 mb-0.5"
              onClick={() => removeFn(i)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={amendEventId ? "Amend Event" : "Record Event"}
        subtitle={amendEventId ? "Create a corrected event that supersedes the original" : "Capture a Critical Tracking Event (CTE) for FSMA 204 compliance"}
        action={
          <Button type="submit" form="record-event-form" disabled={isPending}>
            <ClipboardList className="h-4 w-4 mr-2" />
            {isPending ? 'Saving…' : (amendEventId ? 'Amend Event' : 'Save Event')}
          </Button>
        }
      />

      <form id="record-event-form" onSubmit={onSubmit} className="flex flex-col gap-6">
        {/* Amend Details */}
        {amendEventId && (
          <Card className="border-yellow-200 bg-yellow-50/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-yellow-800 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> Amend Reason
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="amendReason">Reason for amending (this will supersede the old event) *</Label>
                <Textarea
                  id="amendReason"
                  value={formData.amendReason}
                  onChange={setInput('amendReason')}
                  placeholder="e.g. Corrected quantity and location"
                  rows={2}
                  required
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Core details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Event Details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="eventType">Event Type *</Label>
                <Select value={formData.eventType} onValueChange={setSelect('eventType')}>
                  <SelectTrigger id="eventType">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {CTE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="locationId">Location *</Label>
                <Select value={formData.locationId} onValueChange={setSelect('locationId')}>
                  <SelectTrigger id="locationId">
                    <SelectValue placeholder="Select location…" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="eventDatetime">Date &amp; Time *</Label>
                <Input
                  id="eventDatetime"
                  type="datetime-local"
                  value={formData.eventDatetime}
                  onChange={setInput('eventDatetime')}
                  required
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Counterparty Information */}
        {['receiving', 'shipping'].includes(formData.eventType) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Counterparty Information</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="counterpartyName">
                    {formData.eventType === 'receiving' ? 'Supplier Name *' : 'Customer Name *'}
                  </Label>
                  <Input
                    id="counterpartyName"
                    value={formData.counterpartyName}
                    onChange={setInput('counterpartyName')}
                    placeholder={formData.eventType === 'receiving' ? "e.g. Green Farms LLC" : "e.g. FreshMart Stores"}
                    required
                  />
                </div>
                
                {formData.eventType === 'receiving' && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="counterpartyLotCode">Supplier Lot Code</Label>
                    <Input
                      id="counterpartyLotCode"
                      value={formData.counterpartyLotCode}
                      onChange={setInput('counterpartyLotCode')}
                      placeholder="Lot code from supplier"
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Input lots */}
        {SHOWS_INPUTS.includes(formData.eventType) && (
          <LotRows
            items={inputs}
            updateFn={updateInput}
            removeFn={removeInput}
            addFn={() => setInputs((prev) => [...prev, emptyLotRow()])}
            title="Input Lots"
          />
        )}

        {/* Output lots */}
        {SHOWS_OUTPUTS.includes(formData.eventType) && (
          <LotRows
            items={outputs}
            updateFn={updateOutput}
            removeFn={removeOutput}
            addFn={() => setOutputs((prev) => [...prev, emptyLotRow()])}
            title="Output Lots"
          />
        )}

        {/* Dynamic KDEs */}
        {requiredKDEs.length > 0 && (
          <Card className="border-primary/20">
            <CardHeader className="pb-3 bg-primary/5">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                Key Data Elements (KDEs)
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {requiredKDEs.map((kde) => (
                  <div key={kde.name} className="flex flex-col gap-1.5">
                    <Label htmlFor={kde.name}>{kde.label || kde.name} {kde.required && '*'}</Label>
                    <Input
                      id={kde.name}
                      type={kde.type === 'number' ? 'number' : kde.type === 'date' ? 'date' : 'text'}
                      value={kdePayload[kde.name] || ''}
                      onChange={(e) => setKdePayload(prev => ({ ...prev, [kde.name]: e.target.value }))}
                      required={kde.required}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Notes */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={setInput('notes')}
              placeholder="Optional notes or context for this event"
              rows={3}
            />
          </CardContent>
        </Card>

        {/* Attachments */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Attachments</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              type="file"
              multiple
              onChange={handleFileChange}
              className="file:mr-4 file:py-1 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
            />
            {files.length > 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                {files.length} file(s) selected
              </p>
            )}
          </CardContent>
        </Card>

        <Separator />

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} className="min-w-32">
            {isPending ? 'Saving…' : (amendEventId ? 'Amend Event' : 'Save Event')}
          </Button>
        </div>
      </form>
    </div>
  );
}
