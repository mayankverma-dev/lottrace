import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MapPin, Plus, Search, Building2, ExternalLink } from 'lucide-react';

import { useGetLocations, useCreateLocation, useDeactivateLocation } from '@/api/locations.api';
import { usePermissions } from '@/hooks/usePermissions';

import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { Link } from 'react-router-dom';

const LOCATION_TYPES = ['farm', 'plant', 'warehouse', 'distributor', 'retailer', 'other'];

const TYPE_LABELS = {
  farm: 'Farm',
  plant: 'Plant',
  warehouse: 'Warehouse',
  distributor: 'Distributor',
  retailer: 'Retailer',
  other: 'Other',
};

const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(LOCATION_TYPES),
  isExternal: z.boolean().optional().default(false),
  addressLine1: z.string().optional().default(''),
  city: z.string().optional().default(''),
  state: z.string().optional().default(''),
  postalCode: z.string().optional().default(''),
  country: z.string().optional().default('US'),
  gln: z.string().optional().default(''),
  timezone: z.string().optional().default(''),
});

const LocationsListPage = () => {
  const [params, setParams] = useState({ page: 1, limit: 20 });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const { can } = usePermissions();

  const queryParams = { ...params, ...(search && { search }), ...(typeFilter && { type: typeFilter }) };
  const { data, isLoading, isError, refetch } = useGetLocations(queryParams);
  const createMutation = useCreateLocation();
  const deactivateMutation = useDeactivateLocation();

  const { register, handleSubmit, reset, formState: { errors }, setValue, watch } = useForm({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', type: 'warehouse', isExternal: false, country: 'US' },
  });

  const onCreateSubmit = (formData) => {
    createMutation.mutate(formData, {
      onSuccess: () => {
        setCreateOpen(false);
        reset();
      },
    });
  };

  const columns = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <Link to={`/locations/${row.original.id}`} className="font-medium text-primary hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => (
        <Badge variant="secondary">{TYPE_LABELS[row.original.type] || row.original.type}</Badge>
      ),
    },
    {
      id: 'location',
      header: 'Location',
      cell: ({ row }) => {
        const { city, state, country } = row.original;
        const parts = [city, state, country].filter(Boolean);
        return parts.length ? parts.join(', ') : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      accessorKey: 'gln',
      header: 'GLN',
      cell: ({ row }) => row.original.gln || <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'is_external',
      header: 'External',
      cell: ({ row }) =>
        row.original.is_external ? (
          <Badge variant="outline" className="gap-1">
            <ExternalLink className="h-3 w-3" />
            Partner
          </Badge>
        ) : null,
    },
    {
      accessorKey: 'is_active',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.original.is_active ? 'default' : 'secondary'}>
          {row.original.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        can('locations.read') && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">⋯</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/locations/${row.original.id}`}>View details</Link>
              </DropdownMenuItem>
              {can('locations.deactivate') && row.original.is_active && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                      Deactivate
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Deactivate location?</AlertDialogTitle>
                      <AlertDialogDescription>
                        "{row.original.name}" will no longer appear in dropdowns. Existing events linked to this location are not affected.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deactivateMutation.mutate(row.original.id)}>
                        Deactivate
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      ),
    },
  ];

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <EmptyState
        icon={MapPin}
        title="Failed to load locations"
        description="Something went wrong. Please try again."
        action={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  const locations = data?.data || [];
  const pagination = data?.pagination;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Locations"
        subtitle="Manage facilities, warehouses, and partner locations"
        action={
          can('locations.create') && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Location
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Add Location</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit(onCreateSubmit)} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input id="name" {...register('name')} placeholder="e.g. Chicago Warehouse" />
                    {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="type">Type *</Label>
                      <Select defaultValue="warehouse" onValueChange={(v) => setValue('type', v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LOCATION_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="country">Country</Label>
                      <Input id="country" {...register('country')} placeholder="US" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="addressLine1">Address</Label>
                    <Input id="addressLine1" {...register('addressLine1')} placeholder="Street address" />
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
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="gln">GLN</Label>
                      <Input id="gln" {...register('gln')} placeholder="Global Location Number" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="timezone">Timezone</Label>
                      <Input id="timezone" {...register('timezone')} placeholder="America/Chicago" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="isExternal" {...register('isExternal')} className="rounded" />
                    <Label htmlFor="isExternal" className="text-sm">External partner location</Label>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={() => { setCreateOpen(false); reset(); }}>Cancel</Button>
                    <Button type="submit" disabled={createMutation.isPending}>
                      {createMutation.isPending ? 'Creating...' : 'Create'}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search locations..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setParams(p => ({ ...p, page: 1 })); }}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v === 'all' ? '' : v); setParams(p => ({ ...p, page: 1 })); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {LOCATION_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Data */}
      {!locations.length ? (
        <EmptyState
          icon={MapPin}
          title="No locations yet"
          description="Add your first location to start recording supply chain events."
          action={
            can('locations.create') && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Location
              </Button>
            )
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={locations}
          pagination={pagination}
          onPaginationChange={setParams}
        />
      )}
    </div>
  );
};

export default LocationsListPage;
