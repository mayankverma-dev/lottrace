import { useState } from 'react';
import { useGetEvents } from '@/api/events.api';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { formatEventDate } from '@/utils/formatDate';
import { Activity, ChevronDown, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Link, useNavigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePermissions } from '@/hooks/usePermissions';
import { useRequestExport } from '@/api/reports.api';
import { toast } from 'sonner';

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

const EventsListPage = () => {
  const [params, setParams] = useState({ page: 1, limit: 20 });
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { data, isLoading, isError, refetch } = useGetEvents(params);
  const { mutate: requestExport, isPending: isExporting } = useRequestExport();

  const handleExport = (format) => {
    requestExport({ type: 'events', format }, {
      onSuccess: (response) => {
        toast.success('Export queued. You will be notified when it is ready.');
        navigate(`/reports/exports/${response.data.id}`);
      },
      onError: (err) => {
        toast.error(err.response?.data?.message || 'Failed to start export');
      },
    });
  };

  const columns = [
    {
      accessorKey: 'eventType',
      header: 'Type',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Link to={`/events/${row.original.id}`} className="hover:opacity-80">
            {getEventTypeBadge(row.original.event_type)}
          </Link>
          {row.original.status === 'void' && <Badge variant="destructive" className="scale-75">VOID</Badge>}
          {row.original.status === 'amended' && <Badge variant="secondary" className="scale-75 bg-yellow-100 text-yellow-800">AMENDED</Badge>}
        </div>
      ),
    },
    {
      accessorKey: 'eventDatetime',
      header: 'Date & Time',
      cell: ({ row }) => (
        <span className="text-sm">
          {formatEventDate(row.original.event_datetime)}
        </span>
      ),
    },
    {
      accessorKey: 'location',
      header: 'Location',
      cell: ({ row }) => (
        <span className="text-sm font-medium">
          {row.original.location_name || 'N/A'}
        </span>
      ),
    },
    {
      accessorKey: 'recordedBy',
      header: 'Recorded By',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="text-sm">{row.original.recorded_by_name}</span>
          <span className="text-xs text-muted-foreground">
            {new Date(row.original.recorded_at).toLocaleDateString()}
          </span>
        </div>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">⋯</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={`/events/${row.original.id}`}>View Details</Link>
            </DropdownMenuItem>
            {can('events.amend') && row.original.status === 'active' && (
              <DropdownMenuItem onClick={() => navigate(`/events/record?amendEventId=${row.original.id}`)}>
                Amend Event
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
  ];

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={Activity}
        title="Failed to load events"
        description="Something went wrong. Please try again."
        action={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  const events = data?.data || [];
  const pagination = data?.pagination;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Events"
        subtitle="Supply chain traceability events"
        action={
          <div className="flex gap-2">
            {can('reports.export') && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={isExporting}>
                    {isExporting ? 'Starting...' : 'Export'}
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleExport('csv')}>
                    Export CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('json')}>
                    Export JSON
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {can('events.create') && (
              <Button onClick={() => navigate('/events/record')}>
                <Plus className="h-4 w-4 mr-2" />
                Record Event
              </Button>
            )}
          </div>
        }
      />

      {!events.length ? (
        <EmptyState
          icon={Activity}
          title="No events recorded"
          description="Record your first supply chain event to establish traceability."
          action={
            can('events.create') && (
              <Button onClick={() => navigate('/events/record')}>
                <Plus className="h-4 w-4 mr-2" />
                Record Event
              </Button>
            )
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={events}
          pagination={pagination}
          onPaginationChange={setParams}
        />
      )}
    </div>
  );
};

export default EventsListPage;
