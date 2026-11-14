import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export const recallKeys = {
  all: ['recall'],
  lists: () => [...recallKeys.all, 'list'],
  list: (filters) => [...recallKeys.lists(), { filters }],
  details: () => [...recallKeys.all, 'detail'],
  detail: (id) => [...recallKeys.details(), id],
};



export const useGetSimulations = (params = {}) => {
  return useQuery({
    queryKey: recallKeys.list(params),
    // We need the full response, including pagination, for the table pager.
    queryFn: async () => {
      const { data } = await api.get('/recall', { params });
      return data; // returns { success, data, message, pagination }
    },
    keepPreviousData: true,
  });
};

const getSimulation = async (id) => {
  const { data } = await api.get(`/recall/${id}`);
  return data.data;
};

export const useGetSimulation = (id) => {
  return useQuery({
    queryKey: recallKeys.detail(id),
    queryFn: () => getSimulation(id),
    enabled: !!id,
  });
};

const runSimulation = async (payload) => {
  const { data } = await api.post('/recall', payload);
  return data.data;
};

export const useRunSimulation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: runSimulation,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: recallKeys.lists() });
      queryClient.setQueryData(recallKeys.detail(data.id), data);
    },
  });
};
