import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { toast } from 'sonner';

export const USERS_KEYS = {
  all:    ['users'],
  lists:  () => ['users', 'list'],
  list:   (params) => ['users', 'list', params],
  detail: (id) => ['users', 'detail', id],
};

export const useGetUsers = (params) => useQuery({
  queryKey: USERS_KEYS.list(params),
  queryFn: async () => {
    const { data } = await api.get('/users', { params });
    return data;
  },
});

export const useGetUser = (userId) => useQuery({
  queryKey: USERS_KEYS.detail(userId),
  queryFn: async () => {
    const { data } = await api.get(`/users/${userId}`);
    return data;
  },
  enabled: !!userId,
});

export const useInviteUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post('/users/invite', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_KEYS.all });
      toast.success('Invite sent successfully');
    },
    onError: (err) => {
      toast.error(err.response?.data?.message ?? 'Failed to send invite');
    },
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...payload }) => api.patch(`/users/${userId}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_KEYS.all });
      toast.success('User updated');
    },
    onError: (err) => {
      toast.error(err.response?.data?.message ?? 'Failed to update user');
    },
  });
};

export const useDeactivateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId) => api.post(`/users/${userId}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_KEYS.all });
      toast.success('User deactivated');
    },
    onError: (err) => {
      toast.error(err.response?.data?.message ?? 'Failed to deactivate user');
    },
  });
};

export const useReactivateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId) => api.post(`/users/${userId}/reactivate`),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: USERS_KEYS.all });
      toast.success(response.data?.message ?? 'User reactivated');
    },
    onError: (err) => {
      toast.error(err.response?.data?.message ?? 'Failed to reactivate user');
    },
  });
};

export const useResendInvite = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId) => api.post(`/users/${userId}/resend-invite`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_KEYS.all });
      toast.success('Invite resent');
    },
    onError: (err) => {
      toast.error(err.response?.data?.message ?? 'Failed to resend invite');
    },
  });
};
