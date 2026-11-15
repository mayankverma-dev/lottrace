import React, { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Upload, FileText, CheckCircle, AlertCircle, Clock,
  Download, X, FileUp, Loader2, ChevronDown, AlertTriangle, Info
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/common/PageHeader';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetImports, useUploadImport, useGetImportErrors, downloadTemplate } from '@/api/imports.api';
import { formatDistanceToNow } from 'date-fns';

const CTE_OPTIONS = [
  { value: 'creation', label: 'Creation' },
  { value: 'receiving', label: 'Receiving' },
  { value: 'transformation', label: 'Transformation' },
  { value: 'shipping', label: 'Shipping' },
];

const STATUS_CONFIG = {
  pending: { icon: Clock, color: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Pending' },
  processing: { icon: Loader2, color: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Processing' },
  complete: { icon: CheckCircle, color: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Complete' },
  complete_with_errors: { icon: AlertTriangle, color: 'bg-orange-50 text-orange-700 border-orange-200', label: 'Partial' },
  failed: { icon: AlertCircle, color: 'bg-red-50 text-red-700 border-red-200', label: 'Failed' },
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ─── Status Badge ──────────────────────────────────────────
const ImportStatusBadge = ({ status }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = config.icon;
  const isAnimated = status === 'processing';

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${config.color}`}>
      <Icon className={`w-3.5 h-3.5 ${isAnimated ? 'animate-spin' : ''}`} />
      {config.label}
    </span>
  );
};

// ─── Drag & Drop Upload Zone ───────────────────────────────
const UploadZone = ({ onFileDrop, file, onClear }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer?.files?.[0];
    if (droppedFile) onFileDrop(droppedFile);
  }, [onFileDrop]);

  const handleClick = () => inputRef.current?.click();

  const handleChange = (e) => {
    const selected = e.target.files?.[0];
    if (selected) onFileDrop(selected);
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  if (file) {
    const sizeKB = (file.size / 1024).toFixed(1);
    return (
      <div className="flex items-center gap-3 p-3 border rounded-lg bg-gray-50">
        <FileText className="w-8 h-8 text-brand-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{file.name}</p>
          <p className="text-xs text-muted-foreground">{sizeKB} KB</p>
        </div>
        <button
          onClick={onClear}
          className="p-1 rounded-md hover:bg-gray-200 transition-colors"
          aria-label="Remove file"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`
        border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all
        ${isDragOver
          ? 'border-brand-500 bg-brand-50'
          : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
        }
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        onChange={handleChange}
        className="hidden"
      />
      <FileUp className={`w-10 h-10 mx-auto mb-2 ${isDragOver ? 'text-brand-500' : 'text-gray-400'}`} />
      <p className="text-sm font-medium text-gray-700">
        Drop CSV file here or <span className="text-brand-600">browse</span>
      </p>
      <p className="text-xs text-muted-foreground mt-1">Max 10 MB · .csv only</p>
    </div>
  );
};

// ─── Error Viewer Dialog ───────────────────────────────────
const ErrorViewerDialog = ({ open, onOpenChange, importId }) => {
  const [errorPage, setErrorPage] = useState(1);
  const { data: errData, isLoading: errLoading } = useGetImportErrors(
    open ? importId : null,
    { page: errorPage, limit: 50 }
  );

  const errors = errData?.data || [];
  const pagination = errData?.pagination;

  // Reset page when dialog opens for different import
  useEffect(() => {
    if (open) setErrorPage(1);
  }, [open, importId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-500" />
            Import Errors
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto mt-2">
          {errLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : errors.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No errors found.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-4 py-2 font-medium text-gray-600 w-20">Row</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((err, idx) => (
                    <tr key={idx} className="border-b last:border-0 hover:bg-red-50/30">
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{err.row}</td>
                      <td className="px-4 py-2.5 text-red-700">{err.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between pt-3 border-t mt-2">
            <p className="text-xs text-muted-foreground">
              Showing {errors.length} of {pagination.total} errors
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.hasPrevPage}
                onClick={() => setErrorPage(p => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.hasNextPage}
                onClick={() => setErrorPage(p => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ─── Main ImportPage ───────────────────────────────────────
export default function ImportPage() {
  const [file, setFile] = useState(null);
  const [cteType, setCteType] = useState('receiving');
  const [fileError, setFileError] = useState(null);
  const [errorViewImportId, setErrorViewImportId] = useState(null);

  // Fetch imports — auto-poll every 5s when any import is in-progress
  const [hasActiveImport, setHasActiveImport] = useState(false);
  const { data, isLoading, isError } = useGetImports(
    { page: 1, limit: 50 },
    { refetchInterval: hasActiveImport ? 5000 : false }
  );

  const imports = data?.data || [];
  const displayImports = imports;

  useEffect(() => {
    const active = imports.some(i => i.status === 'pending' || i.status === 'processing');
    setHasActiveImport(active);
  }, [imports]);

  const uploadMutation = useUploadImport();

  const handleFileDrop = useCallback((droppedFile) => {
    setFileError(null);

    if (!droppedFile.name.toLowerCase().endsWith('.csv')) {
      setFileError('Only CSV files are accepted');
      return;
    }
    if (droppedFile.size > MAX_FILE_SIZE) {
      setFileError('File exceeds 10 MB limit');
      return;
    }
    if (droppedFile.size === 0) {
      setFileError('File is empty');
      return;
    }

    setFile(droppedFile);
  }, []);

  const handleUpload = () => {
    if (!file) return;

    uploadMutation.mutate(
      { file, cteType },
      {
        onSuccess: () => {
          toast.success('Import queued', {
            description: `${file.name} is being processed. You'll be notified when it's done.`,
          });
          setFile(null);
          setFileError(null);
        },
        onError: (err) => {
          const msg = err.response?.data?.message || 'Upload failed';
          toast.error('Import failed', { description: msg });
        },
      }
    );
  };

  const handleTemplateDownload = async (type) => {
    try {
      await downloadTemplate(type);
      toast.success('Template downloaded');
    } catch {
      toast.error('Failed to download template');
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      <PageHeader
        title="Bulk Import"
        subtitle="Upload CSV files to create traceability events in bulk across all CTE types."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── Upload Card ─────────────────────────────────── */}
        <div className="space-y-6">
          <Card className="border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Upload className="w-5 h-5 text-brand-600" />
                Upload CSV
              </CardTitle>
              <CardDescription>Select event type and upload your data file.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* CTE Type Select */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Event Type</label>
                <Select value={cteType} onValueChange={setCteType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {CTE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* File Drop Zone */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">CSV File</label>
                <UploadZone
                  file={file}
                  onFileDrop={handleFileDrop}
                  onClear={() => { setFile(null); setFileError(null); }}
                />
                {fileError && (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {fileError}
                  </p>
                )}
              </div>

              {/* Upload Button */}
              <Button
                className="w-full"
                onClick={handleUpload}
                disabled={!file || uploadMutation.isPending}
              >
                {uploadMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload & Process
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* ─── Template Download Card ───────────────────── */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Download className="w-4 h-4 text-gray-500" />
                CSV Templates
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {CTE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleTemplateDownload(opt.value)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-md hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-200"
                >
                  <FileText className="w-4 h-4 text-gray-400" />
                  <span className="flex-1">{opt.label} template</span>
                  <Download className="w-3.5 h-3.5 text-gray-400" />
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* ─── Recent Imports List ──────────────────────────── */}
        <Card className="lg:col-span-2 border shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Recent Imports</CardTitle>
              {hasActiveImport && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Auto-refreshing
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {hasActiveImport && (
              <p className="mb-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  Imports process at up to 5 files per minute. Queued files stay Pending
                  and start automatically — no need to upload again.
                </span>
              </p>
            )}
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : isError ? (
              <div className="text-center py-10 text-red-600">
                <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                <p className="text-sm">Failed to load imports.</p>
              </div>
            ) : displayImports.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
                <Upload className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-medium">No imports yet</p>
                <p className="text-xs mt-1">Upload a CSV file to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {displayImports.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50/50 transition-colors"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <p className="font-medium text-sm truncate">{job.filename}</p>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {job.cte_type}
                        </Badge>
                        <span>{formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}</span>
                        {job.created_by_name && <span>by {job.created_by_name}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 ml-4">
                      {/* Row counts */}
                      {job.total_rows != null && (
                        <div className="text-xs text-right min-w-[80px]">
                          <div className="text-emerald-600 font-medium">
                            {job.valid_rows || 0} imported
                          </div>
                          {job.error_rows > 0 && (
                            <button
                              onClick={() => setErrorViewImportId(job.id)}
                              className="text-red-600 hover:underline cursor-pointer"
                            >
                              {job.error_rows} errors →
                            </button>
                          )}
                          <div className="text-gray-400">{job.total_rows} total</div>
                        </div>
                      )}

                      {/* Status badge */}
                      <ImportStatusBadge status={job.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Error Viewer Dialog */}
      <ErrorViewerDialog
        open={!!errorViewImportId}
        onOpenChange={(open) => { if (!open) setErrorViewImportId(null); }}
        importId={errorViewImportId}
      />
    </div>
  );
}
