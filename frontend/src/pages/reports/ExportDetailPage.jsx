import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Clock,
  Download,
  FileText,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDownloadExport, useGetExport } from '@/api/reports.api';
import { exportStatusLabel, isExportPolling } from '@/lib/exportStatus';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const STATUS_CONFIG = {
  queued: {
    icon: Clock,
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  processing: {
    icon: Loader2,
    className: 'bg-blue-50 text-blue-700 border-blue-200',
    spin: true,
  },
  complete: {
    icon: CheckCircle,
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  failed: {
    icon: AlertCircle,
    className: 'bg-red-50 text-red-700 border-red-200',
  },
};

const StatusBadge = ({ status }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.queued;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${config.className}`}>
      <Icon className={`h-3.5 w-3.5 ${config.spin ? 'animate-spin' : ''}`} />
      {exportStatusLabel(status)}
    </span>
  );
};

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');

const ExportDetailPage = () => {
  const { exportId } = useParams();
  const { data, isLoading, isError, refetch } = useGetExport(exportId);
  const downloadExport = useDownloadExport();

  const record = data?.data;

  const handleDownload = () => {
    downloadExport.mutate(exportId, {
      onSuccess: (download) => {
        const link = document.createElement('a');
        link.href = download.downloadUrl;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
      },
      onError: (err) => {
        toast.error(err.response?.data?.message || 'Failed to start download');
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Failed to load export"
        description="The export may have expired, or it belongs to another organization."
        action={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  if (!record) {
    return (
      <EmptyState
        icon={FileText}
        title="Export not found"
        description="This export does not exist or is no longer available."
        action={<Button asChild><Link to="/events">Back to events</Link></Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Export details"
        subtitle="Download your event export when it is ready."
        action={
          <Button variant="outline" asChild>
            <Link to="/events">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to events
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-brand-600" />
            {record.format.toUpperCase()} export
          </CardTitle>
          <StatusBadge status={record.status} />
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Rows</dt>
              <dd className="mt-1 font-medium">
                {record.rowCount == null ? 'Pending' : record.rowCount}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Requested</dt>
              <dd className="mt-1 font-medium">{formatDate(record.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Started</dt>
              <dd className="mt-1 font-medium">{formatDate(record.startedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Completed</dt>
              <dd className="mt-1 font-medium">{formatDate(record.completedAt)}</dd>
            </div>
          </dl>

          {record.status === 'failed' && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {record.error || 'This export failed. Please request a new export.'}
            </div>
          )}

          {isExportPolling(record.status) && (
            <p className="text-sm text-muted-foreground">
              The export is running in the background. You can leave this page;
              we will notify you when it is ready.
            </p>
          )}

          {record.status === 'complete' && (
            <div>
              <Button onClick={handleDownload} disabled={downloadExport.isPending}>
                <Download className="h-4 w-4 mr-2" />
                {downloadExport.isPending ? 'Preparing download...' : 'Download export'}
              </Button>
            </div>
          )}

          {record.status === 'failed' && (
            <div>
              <Button asChild variant="outline">
                <Link to="/events">Request another export</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ExportDetailPage;
