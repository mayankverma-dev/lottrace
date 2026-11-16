import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Search, LayoutList } from 'lucide-react';
import { format } from 'date-fns';

import { useGetAuditLogs } from '@/api/audit.api';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRequestExport } from '@/api/reports.api';
import { buildAuditExportPayload } from '@/lib/auditExport';
import { usePermissions } from '@/hooks/usePermissions';
import { toast } from 'sonner';

const AuditLogPage = () => {
  const [params, setParams] = useState({ page: 1, limit: 20 });
  const [actionFilter, setActionFilter] = useState('');
  const navigate = useNavigate();
  const { can } = usePermissions();
  
  const queryParams = { 
    ...params, 
    ...(actionFilter && actionFilter !== 'all' ? { action: actionFilter } : {}) 
  };
  const { data, isLoading, isError, refetch } = useGetAuditLogs(queryParams);
  const { mutate: requestExport, isPending: isExporting } = useRequestExport();

  const handleExport = () => {
    requestExport(buildAuditExportPayload(actionFilter), {
      onSuccess: (response) => {
        toast.success('Export started! You will be notified when it is ready.');
        navigate(`/reports/exports/${response.data.id}`);
      },
      onError: (err) => {
        toast.error(err.response?.data?.message || 'Failed to start export');
      }
    });
  };

  const columns = [
    {
      accessorKey: 'createdAt',
      header: 'Timestamp',
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap">
          {format(new Date(row.original.created_at), 'MMM d, yyyy h:mm:ss a')}
        </span>
      ),
    },
    {
      accessorKey: 'actor',
      header: 'Actor',
      cell: ({ row }) => {
        if (row.original.actor_type === 'system') return <Badge variant="outline">System</Badge>;
        return (
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {row.original.actor_first_name} {row.original.actor_last_name}
            </span>
            <span className="text-xs text-muted-foreground">{row.original.actor_email}</span>
          </div>
        );
      },
    },
    {
      accessorKey: 'action',
      header: 'Action',
      cell: ({ row }) => (
        <Badge variant="secondary" className="font-mono text-xs">
          {row.original.action}
        </Badge>
      ),
    },
    {
      accessorKey: 'entity',
      header: 'Entity',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="text-sm capitalize">{row.original.entity_type}</span>
          <span className="text-xs font-mono text-muted-foreground" title={row.original.entity_id}>
            {row.original.entity_id?.split('-')[0]}...
          </span>
        </div>
      ),
    },
    {
      accessorKey: 'ipAddress',
      header: 'IP Address',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.ip_address || 'N/A'}
        </span>
      ),
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
        icon={Shield}
        title="Failed to load audit logs"
        description="Something went wrong. Please try again."
        action={<button onClick={() => refetch()} className="text-sm font-medium text-primary hover:underline">Retry</button>}
      />
    );
  }

  const logs = data?.data || [];
  const pagination = data?.pagination;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit Log"
        subtitle="Security and compliance trail for all sensitive actions"
        action={
          can('reports.export') && (
            <Button variant="outline" onClick={handleExport} disabled={isExporting}>
              {isExporting ? 'Starting...' : 'Export CSV'}
            </Button>
          )
        }
      />

      <div className="flex items-center gap-3">
        <div className="w-64">
          <Select 
            value={actionFilter || 'all'} 
            onValueChange={(v) => { setActionFilter(v); setParams(p => ({ ...p, page: 1 })); }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Filter by action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="user.invite">User Invited</SelectItem>
              <SelectItem value="user.role_change">Role Changed</SelectItem>
              <SelectItem value="lot.void">Lot Voided</SelectItem>
              <SelectItem value="event.void">Event Voided</SelectItem>
              <SelectItem value="event.amend">Event Amended</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {!logs.length ? (
        <EmptyState
          icon={LayoutList}
          title="No audit logs found"
          description="Sensitive actions will appear here."
        />
      ) : (
        <DataTable
          columns={columns}
          data={logs}
          pagination={pagination}
          onPaginationChange={setParams}
        />
      )}
    </div>
  );
};

export default AuditLogPage;
