import { useState } from 'react';
import { useGetComplianceGaps } from '@/api/reports.api';
import { parseJsonArray } from '@/lib/json';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { formatEventDate } from '@/utils/formatDate';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const ComplianceGapsPage = () => {
  const [params, setParams] = useState({ page: 1, limit: 20 });
  const { data, isLoading, isError, refetch } = useGetComplianceGaps(params);

  const columns = [
    {
      accessorKey: 'eventType',
      header: 'Event Type',
      cell: ({ row }) => (
        <span className="font-medium capitalize">{row.original.event_type}</span>
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
      accessorKey: 'gaps',
      header: 'Missing Required Fields',
      cell: ({ row }) => {
        const gaps = parseJsonArray(row.original.compliance_gaps);
        return (
          <div className="flex flex-wrap gap-1">
            {gaps.map((gap, i) => (
              <Badge key={i} variant="destructive" className="bg-red-100 text-red-800 border-red-200">
                {gap.field}
              </Badge>
            ))}
          </div>
        );
      },
    },
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
        icon={AlertCircle}
        title="Failed to load compliance gaps"
        description="Something went wrong. Please try again."
        action={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  const events = data?.data || [];
  const pagination = data?.meta;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Compliance Gaps"
        description="Review events missing required KDEs based on product schemas."
      />

      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <DataTable
          columns={columns}
          data={events}
          pagination={pagination}
          onPaginationChange={(newPagination) => {
            setParams(prev => ({
              ...prev,
              page: newPagination.pageIndex + 1,
              limit: newPagination.pageSize
            }));
          }}
        />
      </div>
    </div>
  );
};

export default ComplianceGapsPage;
