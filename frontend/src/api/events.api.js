import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export const EVENTS_KEYS = {
  all: ['events'],
  list: (params) => ['events', 'list', params],
  detail: (id) => ['events', 'detail', id],
};

export const useGetEvents = (params) => {
  return useQuery({
    queryKey: EVENTS_KEYS.list(params),
    queryFn: async () => {
      const { data } = await api.get('/events', { params });
      return data;
    },
  });
};

export const useGetEvent = (id) => {
  return useQuery({
    queryKey: EVENTS_KEYS.detail(id),
    queryFn: async () => {
      const { data } = await api.get(`/events/${id}`);
      return data;
    },
    enabled: !!id,
  });
};

export const useCreateEvent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }) => api.post('/events', payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EVENTS_KEYS.all }),
  });
};

export const useVoidEvent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, payload }) => api.post(`/events/${eventId}/void`, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: EVENTS_KEYS.all });
      queryClient.invalidateQueries({ queryKey: EVENTS_KEYS.detail(variables.eventId) });
    },
  });
};

export const useAmendEvent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, payload }) => api.post(`/events/${eventId}/amend`, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: EVENTS_KEYS.all });
      queryClient.invalidateQueries({ queryKey: EVENTS_KEYS.detail(variables.eventId) });
    },
  });
};

export const useGetAttachmentUploadUrl = () => {
  return useMutation({
    mutationFn: ({ eventId, payload }) => api.post(`/events/${eventId}/attachments/presigned-url`, payload),
  });
};

export const useAddAttachment = () => {
  return useMutation({
    mutationFn: ({ eventId, payload }) => api.post(`/events/${eventId}/attachments`, payload),
  });
};
