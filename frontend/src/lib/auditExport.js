export const buildAuditExportPayload = (actionFilter) => ({
  type: 'audit',
  format: 'csv',
  filters: actionFilter && actionFilter !== 'all' ? { action: actionFilter } : {},
});
