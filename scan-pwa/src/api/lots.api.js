import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

const LOTS_KEYS = {
  all: ['lots'],
  lists: () => [...LOTS_KEYS.all, 'list'],
  list: (params) => [...LOTS_KEYS.lists(), params],
  details: () => [...LOTS_KEYS.all, 'detail'],
  detail: (id) => [...LOTS_KEYS.details(), id],
};

export const useGetLots = (params) => {
  return useQuery({
    queryKey: LOTS_KEYS.list(params),
    queryFn: async () => {
      const { data } = await api.get('/lots', { params });
      return data; // { data: [...], pagination: {...} }
    },
  });
};

/**
 * Finds one lot by exact traceability lot code in the authenticated organization.
 *
 * @param {string} lotCode
 * @returns {Promise<Object|null>}
 */
export const findLotByCode = async (lotCode) => {
  const { data } = await api.get('/lots', {
    params: { traceabilityLotCode: lotCode, limit: 1 },
  });
  return data?.data?.[0] ?? null;
};

export const useGetLot = (lotId) => {
  return useQuery({
    queryKey: LOTS_KEYS.detail(lotId),
    queryFn: async () => {
      const { data } = await api.get(`/lots/${lotId}`);
      return data.data;
    },
    enabled: !!lotId,
  });
};

export const useCreateLot = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (lotData) => {
      const { data } = await api.post('/lots', lotData);
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LOTS_KEYS.lists() });
    },
  });
};

export const useUpdateLot = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ lotId, data }) => {
      const response = await api.patch(`/lots/${lotId}`, data);
      return response.data.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: LOTS_KEYS.detail(variables.lotId) });
      queryClient.invalidateQueries({ queryKey: LOTS_KEYS.lists() });
    },
  });
};

export const useVoidLot = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ lotId, voidReason }) => {
      const { data } = await api.post(`/lots/${lotId}/void`, { voidReason });
      return data.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: LOTS_KEYS.detail(variables.lotId) });
      queryClient.invalidateQueries({ queryKey: LOTS_KEYS.lists() });
    },
  });
};
