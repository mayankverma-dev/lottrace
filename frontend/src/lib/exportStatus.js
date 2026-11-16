const STATUS_LABELS = {
  queued: 'Queued',
  processing: 'Processing',
  complete: 'Ready',
  failed: 'Failed',
};

export const isExportTerminal = (status) => status === 'complete' || status === 'failed';

export const isExportPolling = (status) => status === 'queued' || status === 'processing';

export const exportStatusLabel = (status) => STATUS_LABELS[status] || status;
