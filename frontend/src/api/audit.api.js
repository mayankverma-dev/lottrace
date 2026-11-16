import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export const AUDIT_KEYS = {
  all: ['audit'],
  list: (params) => ['audit', 'list', params],
};

export const useGetAuditLogs = (params, { enabled = true } = {}) => {
  return useQuery({
    queryKey: AUDIT_KEYS.list(params),
    queryFn: async () => {
      const { data } = await api.get('/audit', { params });
      return data;
    },
    enabled,
  });
};
