import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';

import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/card';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { usePermissions } from '@/hooks/usePermissions';

const schema = z.object({
  name: z.string().min(1, 'Organization Name is required'),
  timezoneDefault: z.string().min(1, 'Timezone is required'),
  uomDefault: z.string().min(1, 'Unit of Measure is required'),
});

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 
  'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney'
];

const UOM_OPTIONS = [
  { value: 'kg', label: 'Kilograms (kg)' },
  { value: 'lb', label: 'Pounds (lb)' },
  { value: 'g', label: 'Grams (g)' },
  { value: 'oz', label: 'Ounces (oz)' },
  { value: 'units', label: 'Units' }
];

export default function OrganizationPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canUpdateSettings = can('settings.update');
  
  const { data: orgData, isLoading } = useQuery({
    queryKey: ['organization', 'me'],
    queryFn: async () => {
      const { data } = await api.get('/organizations/me');
      return data.data;
    }
  });

  const { register, control, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    values: { 
      name: orgData?.name || '',
      timezoneDefault: orgData?.timezoneDefault || 'UTC',
      uomDefault: orgData?.uomDefault || 'kg',
    }
  });

  const updateMutation = useMutation({
    mutationFn: (payload) => api.patch('/organizations/me', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization', 'me'] });
      toast.success('Organization updated successfully');
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Failed to update organization');
    }
  });

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin text-brand-600" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Organization Profile</h3>
        <p className="text-sm text-muted-foreground">Manage your organization profile and preferences.</p>
      </div>
      <div className="grid grid-cols-1 gap-6 max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle>Profile Details</CardTitle>
            <CardDescription>Update your organization's core information and defaults.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={canUpdateSettings
                ? handleSubmit((d) => updateMutation.mutate(d))
                : (event) => event.preventDefault()}
              className="space-y-6 max-w-xl"
            >
              <FormField label="Organization Name" error={errors.name?.message}>
                <Input {...register('name')} disabled={!canUpdateSettings} />
              </FormField>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField label="Default Timezone" error={errors.timezoneDefault?.message}>
                  <Controller
                    name="timezoneDefault"
                    control={control}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger disabled={!canUpdateSettings}>
                          <SelectValue placeholder="Select timezone" />
                        </SelectTrigger>
                        <SelectContent>
                          {TIMEZONES.map(tz => (
                            <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>
                
                <FormField label="Default Unit of Measure" error={errors.uomDefault?.message}>
                  <Controller
                    name="uomDefault"
                    control={control}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger disabled={!canUpdateSettings}>
                          <SelectValue placeholder="Select UOM" />
                        </SelectTrigger>
                        <SelectContent>
                          {UOM_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>
              </div>

              {canUpdateSettings && (
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              )}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subscription & Account</CardTitle>
            <CardDescription>View your current subscription plan and account status.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-1">Industry Vertical</dt>
                <dd className="capitalize font-medium">{orgData?.industryVertical || 'N/A'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-1">Plan Tier</dt>
                <dd className="capitalize font-medium">{orgData?.planTier || 'N/A'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-1">Status</dt>
                <dd>
                  <Badge variant={orgData?.status === 'active' ? 'default' : 'secondary'} className="capitalize">
                    {orgData?.status || 'Unknown'}
                  </Badge>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
