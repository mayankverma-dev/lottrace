import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Box, Plus, Search, Trash2, ShieldCheck } from 'lucide-react';

import { useGetProducts, useCreateProduct } from '@/api/products.api';
import { usePermissions } from '@/hooks/usePermissions';
import { parseJsonArray } from '@/lib/json';

import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';

import { Link } from 'react-router-dom';

const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  sku: z.string().optional().default(''),
  gtin: z.string().optional().default(''),
  category: z.string().optional().default(''),
  isFtl: z.boolean().optional().default(false),
  defaultUom: z.string().optional().default('kg'),
  customKdeSchema: z.array(z.object({
    name: z.string().min(1, 'Field name required'),
    label: z.string().min(1, 'Label required'),
    type: z.enum(['string', 'number', 'boolean', 'date']),
    required: z.boolean().default(false),
  })).optional().default([]),
});

const UOM_OPTIONS = ['kg', 'lb', 'units', 'cases', 'pallets', 'liters', 'gallons'];

const ProductsListPage = () => {
  const [params, setParams] = useState({ page: 1, limit: 20 });
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const { can } = usePermissions();

  const queryParams = { ...params, ...(search && { search }) };
  const { data, isLoading, isError, refetch } = useGetProducts(queryParams);
  const createMutation = useCreateProduct();

  const { register, handleSubmit, reset, formState: { errors }, control, watch, setValue } = useForm({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', sku: '', gtin: '', category: '', isFtl: false, defaultUom: 'kg', customKdeSchema: [] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'customKdeSchema' });

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
      header: 'Product',
      cell: ({ row }) => (
        <Link to={`/products/${row.original.id}`} className="font-medium text-primary hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'sku',
      header: 'SKU',
      cell: ({ row }) => row.original.sku || <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'gtin',
      header: 'GTIN',
      cell: ({ row }) => row.original.gtin || <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'category',
      header: 'Category',
      cell: ({ row }) => row.original.category || <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'is_ftl',
      header: 'FTL',
      cell: ({ row }) =>
        row.original.is_ftl ? (
          <Badge variant="default" className="gap-1">
            <ShieldCheck className="h-3 w-3" />
            FTL
          </Badge>
        ) : null,
    },
    {
      accessorKey: 'default_uom',
      header: 'UoM',
      cell: ({ row }) => <span className="text-sm">{row.original.default_uom}</span>,
    },
    {
      id: 'kdeCount',
      header: 'KDE Fields',
      cell: ({ row }) => {
        const count = parseJsonArray(row.original.custom_kde_schema).length;
        return count > 0 ? <Badge variant="secondary">{count}</Badge> : <span className="text-muted-foreground">—</span>;
      },
    },
  ];

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={Box}
        title="Failed to load products"
        description="Something went wrong. Please try again."
        action={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  const products = data?.data || [];
  const pagination = data?.pagination;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Products"
        subtitle="Manage products and their traceability requirements"
        action={
          can('products.create') && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Product
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add Product</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit(onCreateSubmit)} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input id="name" {...register('name')} placeholder="e.g. Fresh Romaine Lettuce" />
                    {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="sku">SKU</Label>
                      <Input id="sku" {...register('sku')} placeholder="Internal SKU" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="gtin">GTIN</Label>
                      <Input id="gtin" {...register('gtin')} placeholder="GS1 GTIN" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="category">Category</Label>
                      <Input id="category" {...register('category')} placeholder="e.g. Leafy Greens" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="defaultUom">Default Unit of Measure</Label>
                      <Select defaultValue="kg" onValueChange={(v) => setValue('defaultUom', v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {UOM_OPTIONS.map((u) => (
                            <SelectItem key={u} value={u}>{u}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-3 pt-6">
                      <Switch
                        id="isFtl"
                        checked={watch('isFtl')}
                        onCheckedChange={(v) => setValue('isFtl', v)}
                      />
                      <Label htmlFor="isFtl" className="text-sm">On FDA Food Traceability List</Label>
                    </div>
                  </div>

                  <Separator />

                  {/* KDE Schema Builder */}
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-base font-semibold">Custom KDE Fields</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Define additional data fields to capture on events for this product
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => append({ name: '', label: '', type: 'string', required: false })}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Field
                      </Button>
                    </div>

                    {fields.map((field, index) => (
                      <div key={field.id} className="grid grid-cols-12 gap-2 items-end p-3 rounded-md border bg-muted/30">
                        <div className="col-span-3 flex flex-col gap-1">
                          <Label className="text-xs">Field Name</Label>
                          <Input
                            {...register(`customKdeSchema.${index}.name`)}
                            placeholder="field_name"
                            className="text-sm"
                          />
                        </div>
                        <div className="col-span-3 flex flex-col gap-1">
                          <Label className="text-xs">Label</Label>
                          <Input
                            {...register(`customKdeSchema.${index}.label`)}
                            placeholder="Display Label"
                            className="text-sm"
                          />
                        </div>
                        <div className="col-span-2 flex flex-col gap-1">
                          <Label className="text-xs">Type</Label>
                          <Select
                            defaultValue={field.type || 'string'}
                            onValueChange={(v) => setValue(`customKdeSchema.${index}.type`, v)}
                          >
                            <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="string">Text</SelectItem>
                              <SelectItem value="number">Number</SelectItem>
                              <SelectItem value="boolean">Yes/No</SelectItem>
                              <SelectItem value="date">Date</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-2 flex items-center gap-2 pb-1">
                          <input
                            type="checkbox"
                            {...register(`customKdeSchema.${index}.required`)}
                            className="rounded"
                          />
                          <span className="text-xs">Required</span>
                        </div>
                        <div className="col-span-2 flex justify-end pb-1">
                          <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}

                    {fields.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4 border rounded-md border-dashed">
                        No custom fields. Standard KDEs are always captured.
                      </p>
                    )}
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

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setParams(p => ({ ...p, page: 1 })); }}
            className="pl-9"
          />
        </div>
      </div>

      {/* Data */}
      {!products.length ? (
        <EmptyState
          icon={Box}
          title="No products yet"
          description="Add your first product to define what you're tracking."
          action={
            can('products.create') && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Product
              </Button>
            )
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={products}
          pagination={pagination}
          onPaginationChange={setParams}
        />
      )}
    </div>
  );
};

export default ProductsListPage;
