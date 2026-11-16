import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';

export const useGetComplianceGaps = (params) => {
  return useQuery({
    queryKey: ['complianceGaps', params],
    queryFn: async () => {
      const { data } = await api.get('/reports/compliance-gaps', { params });
      return data;
    },
  });
};

export const REPORTS_KEYS = {
  all: ['reports'],
  export: (exportId) => ['reports', 'exports', exportId],
};

export const useRequestExport = () => {
  return useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/reports/export', payload);
      return data;
    },
  });
};

export const useGetExport = (exportId) => {
  return useQuery({
    queryKey: REPORTS_KEYS.export(exportId),
    queryFn: async () => {
      const { data } = await api.get(`/reports/exports/${exportId}`);
      return data;
    },
    enabled: !!exportId,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.status;
      return status === 'queued' || status === 'processing' ? 2000 : false;
    },
  });
};

export const useDownloadExport = () => {
  return useMutation({
    mutationFn: async (exportId) => {
      const { data } = await api.get(`/reports/exports/${exportId}/download`);
      return data.data;
    },
  });
};
