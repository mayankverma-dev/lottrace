import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, MapPin, Pencil, ExternalLink } from 'lucide-react';

import { useGetLocation, useUpdateLocation, useDeactivateLocation } from '@/api/locations.api';
import { usePermissions } from '@/hooks/usePermissions';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { Controller } from 'react-hook-form';

const LOCATION_TYPES = ['farm', 'plant', 'warehouse', 'distributor', 'retailer', 'other'];
const TYPE_LABELS = { farm: 'Farm', plant: 'Plant', warehouse: 'Warehouse', distributor: 'Distributor', retailer: 'Retailer', other: 'Other' };

const updateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(LOCATION_TYPES),
  addressLine1: z.string().optional().default(''),
  city: z.string().optional().default(''),
  state: z.string().optional().default(''),
  postalCode: z.string().optional().default(''),
  country: z.string().optional().default('US'),
  gln: z.string().optional().default(''),
  timezone: z.string().optional().default(''),
  isExternal: z.boolean().default(false),
});

const LocationDetailPage = () => {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [editing, setEditing] = useState(false);

  const { data, isLoading, isError, refetch } = useGetLocation(locationId);
  const updateMutation = useUpdateLocation();
  const deactivateMutation = useDeactivateLocation();

  const location = data?.data;

  const { register, handleSubmit, reset, formState: { errors }, setValue, control } = useForm({
    resolver: zodResolver(updateSchema),
  });

  const startEditing = () => {
    if (!location) return;
    reset({
      name: location.name,
      type: location.type,
      addressLine1: location.address_line1 || '',
      city: location.city || '',
      state: location.state || '',
      postalCode: location.postal_code || '',
      country: location.country || 'US',
      gln: location.gln || '',
      timezone: location.timezone || '',
      isExternal: location.is_external || false,
    });
    setEditing(true);
  };

  const onSubmit = (formData) => {
    updateMutation.mutate({ locationId, ...formData }, {
      onSuccess: () => {
        setEditing(false);
        refetch();
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  if (isError || !location) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <MapPin className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-base font-semibold">Location not found</h3>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/locations')}>
          Back to locations
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/locations')}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Locations
        </Button>
      </div>

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10">
            <MapPin className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{location.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="secondary">{TYPE_LABELS[location.type]}</Badge>
              {location.is_external && (
                <Badge variant="outline" className="gap-1">
                  <ExternalLink className="h-3 w-3" />
                  Partner
                </Badge>
              )}
              <Badge variant={location.is_active ? 'default' : 'secondary'}>
                {location.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {can('locations.update') && location.is_active && !editing && (
            <Button variant="outline" onClick={startEditing}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
          {can('locations.deactivate') && location.is_active && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive">Deactivate</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Deactivate "{location.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This location will no longer appear in dropdowns. Existing events linked to this location are not affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deactivateMutation.mutate(locationId, { onSuccess: () => navigate('/locations') })}>
                    Deactivate
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <Separator />

      {/* Content */}
      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit Location</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input id="name" {...register('name')} />
                  {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="type">Type *</Label>
                  <Select defaultValue={location.type} onValueChange={(v) => setValue('type', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LOCATION_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="addressLine1">Address</Label>
                <Input id="addressLine1" {...register('addressLine1')} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="city">City</Label>
                  <Input id="city" {...register('city')} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="state">State</Label>
                  <Input id="state" {...register('state')} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="postalCode">Zip</Label>
                  <Input id="postalCode" {...register('postalCode')} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="country">Country</Label>
                  <Input id="country" {...register('country')} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="gln">GLN</Label>
                  <Input id="gln" {...register('gln')} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Input id="timezone" {...register('timezone')} />
                </div>
              </div>
              <div className="flex flex-row items-center justify-between rounded-lg border p-3 mt-2 shadow-sm">
                <div className="space-y-0.5">
                  <Label>External Location</Label>
                  <p className="text-sm text-muted-foreground">
                    This location is managed by a third-party partner.
                  </p>
                </div>
                <Controller
                  name="isExternal"
                  control={control}
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Address</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {location.address_line1 && <p>{location.address_line1}</p>}
              {location.address_line2 && <p>{location.address_line2}</p>}
              <p>
                {[location.city, location.state, location.postal_code].filter(Boolean).join(', ')}
              </p>
              <p>{location.country}</p>
              {!location.address_line1 && !location.city && (
                <p className="text-muted-foreground">No address provided</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">GLN</span>
                <span>{location.gln || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Timezone</span>
                <span>{location.timezone || 'Org default'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{new Date(location.created_at).toLocaleDateString()}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default LocationDetailPage;
