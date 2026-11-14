import { useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Activity, ArrowLeft, MoreVertical, Ban, Edit2, Package, MapPin, Calendar, FileText, AlertTriangle, ShieldCheck } from 'lucide-react';

import { useGetEvent, useVoidEvent } from '@/api/events.api';
import { newIdempotencyKey } from '@/lib/idempotency';
import { parseJsonArray, parseJsonObject } from '@/lib/json';
import { usePermissions } from '@/hooks/usePermissions';
import { formatEventDate } from '@/utils/formatDate';

import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';

const voidSchema = z.object({
  voidReason: z.string().min(1, 'Reason is required'),
});

const getEventTypeBadge = (type) => {
  switch (type) {
    case 'creation':
      return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Creation</Badge>;
    case 'receiving':
      return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Receiving</Badge>;
    case 'transformation':
      return <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">Transformation</Badge>;
    case 'shipping':
      return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">Shipping</Badge>;
    default:
      return <Badge variant="outline">{type}</Badge>;
  }
};

const getStatusBadge = (status) => {
  switch (status) {
    case 'active':
      return <Badge className="bg-green-600 hover:bg-green-700">Active</Badge>;
    case 'amended':
      return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200">Amended</Badge>;
    case 'void':
      return <Badge variant="destructive">Void</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

const EventDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();

  const { data: eventResult, isLoading, isError } = useGetEvent(id);
  const voidMutation = useVoidEvent();

  const [voidOpen, setVoidOpen] = useState(false);
  const voidIdempotencyRef = useRef({ signature: null, key: null });

  const { register: registerVoid, handleSubmit: handleVoidSubmit, reset: resetVoid, formState: { errors: voidErrors } } = useForm({
    resolver: zodResolver(voidSchema),
    defaultValues: { voidReason: '' },
  });

  const onVoid = (data) => {
    const payload = { voidReason: data.voidReason };
    const signature = JSON.stringify({ eventId: id, payload });
    if (voidIdempotencyRef.current.signature !== signature) {
      voidIdempotencyRef.current = { signature, key: newIdempotencyKey() };
    }

    voidMutation.mutate({ eventId: id, payload, idempotencyKey: voidIdempotencyRef.current.key }, {
      onSuccess: () => {
        setVoidOpen(false);
        resetVoid();
        voidIdempotencyRef.current = { signature: null, key: null };
      },
    });
  };

  const onAmend = () => {
    navigate(`/events/record?amendEventId=${id}`);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-10 w-64" />
        </div>
        <div className="grid grid-cols-3 gap-6">
          <Skeleton className="h-48 col-span-2" />
          <Skeleton className="h-48 col-span-1" />
        </div>
      </div>
    );
  }

  if (isError || !eventResult?.data) {
    return (
      <EmptyState
        icon={Activity}
        title="Event not found"
        description="The event you're looking for doesn't exist or you don't have access."
        action={<Button onClick={() => navigate('/events')}>Back to Events</Button>}
      />
    );
  }

  const event = eventResult.data;
  const isMutable = event.status === 'active';
  const complianceGaps = parseJsonArray(event.compliance_gaps);
  const kdePayload = parseJsonObject(event.kde_payload);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/events')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader
          title="Event Details"
          subtitle={`Recorded on ${formatEventDate(event.created_at)}`}
          action={
            <div className="flex items-center gap-3">
              {getStatusBadge(event.status)}
              
              {can('events.create') && isMutable && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={onAmend}>
                      <Edit2 className="h-4 w-4 mr-2" />
                      Amend Event
                    </DropdownMenuItem>
                    {can('org_admin') && (
                      <DropdownMenuItem onClick={() => setVoidOpen(true)} className="text-destructive focus:text-destructive">
                        <Ban className="h-4 w-4 mr-2" />
                        Void Event
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          }
        />
      </div>

      <Card className={complianceGaps.length > 0 ? 'border-destructive bg-destructive/5' : undefined}>
        <CardHeader className="py-3">
          <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${complianceGaps.length > 0 ? 'text-destructive' : 'text-foreground'}`}>
            {complianceGaps.length > 0 ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            Compliance Gaps
          </CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          {complianceGaps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No compliance gaps detected.</p>
          ) : (
            <ul className="list-disc pl-5 text-sm text-destructive">
              {complianceGaps.map((gap, i) => (
                <li key={i}>{gap?.message || `Missing KDE: ${gap?.field ?? 'unknown field'}`}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Core Information</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-6 text-sm">
                <div className="flex flex-col gap-1">
                  <dt className="text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3"/> Type</dt>
                  <dd className="font-medium mt-1">{getEventTypeBadge(event.event_type)}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3"/> Event Date</dt>
                  <dd className="font-medium mt-1">{formatEventDate(event.event_datetime)}</dd>
                </div>
                
                {event.status !== 'active' && event.status_reason && (
                  <div className="flex flex-col gap-1 sm:col-span-2 mt-2 p-3 bg-secondary/30 rounded-md border text-foreground">
                    <dt className="font-semibold flex items-center gap-1 text-xs uppercase text-muted-foreground">
                      <Ban className="h-3 w-3" /> Reason for Change
                    </dt>
                    <dd className="mt-1">{event.status_reason}</dd>
                  </div>
                )}
                {event.supersedes_event_id && (
                  <div className="flex flex-col gap-1 sm:col-span-2 mt-2">
                    <dt className="text-muted-foreground flex items-center gap-1">Supersedes</dt>
                    <dd className="font-medium mt-1 text-primary">
                      <Link to={`/events/${event.supersedes_event_id}`} className="hover:underline">
                        Event {event.supersedes_event_id.split('-')[0]}...
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-base">Input Lots</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 flex flex-col gap-3">
                {(!event.inputs || event.inputs.length === 0) ? (
                  <span className="text-sm text-muted-foreground">No inputs</span>
                ) : (
                  event.inputs.map((input, idx) => (
                    <div key={idx} className="flex justify-between items-center text-sm border-b pb-2 last:border-0 last:pb-0">
                      <Link to={`/lots/${input.lot_id}`} className="font-medium text-primary hover:underline truncate mr-2">
                        {input.traceability_lot_code}
                      </Link>
                      <span className="text-muted-foreground whitespace-nowrap">{Number(input.quantity).toLocaleString()} {input.uom}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-base">Output Lots</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 flex flex-col gap-3">
                {(!event.outputs || event.outputs.length === 0) ? (
                  <span className="text-sm text-muted-foreground">No outputs</span>
                ) : (
                  event.outputs.map((output, idx) => (
                    <div key={idx} className="flex justify-between items-center text-sm border-b pb-2 last:border-0 last:pb-0">
                      <Link to={`/lots/${output.lot_id}`} className="font-medium text-primary hover:underline truncate mr-2">
                        {output.traceability_lot_code}
                      </Link>
                      <span className="text-muted-foreground whitespace-nowrap">{Number(output.quantity).toLocaleString()} {output.uom}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
          
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base">Key Data Elements (KDEs)</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {Object.keys(kdePayload).length === 0 ? (
                <span className="text-sm text-muted-foreground">No KDEs recorded.</span>
              ) : (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  {Object.entries(kdePayload).map(([key, val]) => (
                    <div key={key} className="flex flex-col gap-1">
                      <dt className="text-muted-foreground capitalize">{key}</dt>
                      <dd className="font-medium">{val?.toString() || '—'}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 flex flex-col gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground flex items-center gap-1"><FileText className="h-3 w-3"/> Notes</span>
                <span>{event.notes || '—'}</span>
              </div>
              <Separator />
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">Source</span>
                <span className="capitalize">{event.source}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">Hash</span>
                <span className="font-mono text-xs bg-muted p-1 rounded break-all">{event.record_hash}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Ban className="h-5 w-5" />
              Void Event
            </DialogTitle>
            <DialogDescription>
              This will mark the event as voided. This action is irreversible and affects the traceability graph.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleVoidSubmit(onVoid)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="voidReason">Reason for voiding *</Label>
              <Textarea id="voidReason" {...registerVoid('voidReason')} placeholder="e.g. Recorded in error" required />
              {voidErrors.voidReason && <p className="text-sm text-destructive">{voidErrors.voidReason.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setVoidOpen(false); resetVoid(); }}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={voidMutation.isPending}>
                {voidMutation.isPending ? 'Voiding...' : 'Void Event'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EventDetailPage;
