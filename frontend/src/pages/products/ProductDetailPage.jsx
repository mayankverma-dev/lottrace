import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Box, Pencil, Trash2, Plus, ShieldCheck } from 'lucide-react';

import { useGetProduct, useUpdateProduct } from '@/api/products.api';
import { usePermissions } from '@/hooks/usePermissions';
import { parseJsonArray } from '@/lib/json';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const UOM_OPTIONS = ['kg', 'lb', 'units', 'cases', 'pallets', 'liters', 'gallons'];
const KDE_TYPE_LABELS = { string: 'Text', number: 'Number', boolean: 'Yes/No', date: 'Date' };

const updateSchema = z.object({
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

const ProductDetailPage = () => {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [editing, setEditing] = useState(false);

  const { data, isLoading, isError, refetch } = useGetProduct(productId);
  const updateMutation = useUpdateProduct();

  const product = data?.data;

  const { register, handleSubmit, reset, formState: { errors }, control, setValue, watch } = useForm({
    resolver: zodResolver(updateSchema),
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'customKdeSchema' });

  const startEditing = () => {
    if (!product) return;
    const kdeSchema = parseJsonArray(product.custom_kde_schema);
    reset({
      name: product.name,
      sku: product.sku || '',
      gtin: product.gtin || '',
      category: product.category || '',
      isFtl: product.is_ftl || false,
      defaultUom: product.default_uom || 'kg',
      customKdeSchema: kdeSchema,
    });
    setEditing(true);
  };

  const onSubmit = (formData) => {
    updateMutation.mutate({ productId, ...formData }, {
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

  if (isError || !product) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Box className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-base font-semibold">Product not found</h3>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/products')}>
          Back to products
        </Button>
      </div>
    );
  }

  const kdeSchema = parseJsonArray(product.custom_kde_schema);

  return (
    <div className="flex flex-col gap-6">
      {/* Back nav */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/products')}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Products
        </Button>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10">
            <Box className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{product.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              {product.is_ftl && (
                <Badge variant="default" className="gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  FTL
                </Badge>
              )}
              <Badge variant={product.is_active ? 'default' : 'secondary'}>
                {product.is_active ? 'Active' : 'Inactive'}
              </Badge>
              {product.category && <Badge variant="secondary">{product.category}</Badge>}
            </div>
          </div>
        </div>
        {can('products.update') && !editing && (
          <Button variant="outline" onClick={startEditing}>
            <Pencil className="h-4 w-4 mr-2" />
            Edit
          </Button>
        )}
      </div>

      <Separator />

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit Product</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" {...register('name')} />
                {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sku">SKU</Label>
                  <Input id="sku" {...register('sku')} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="gtin">GTIN</Label>
                  <Input id="gtin" {...register('gtin')} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="category">Category</Label>
                  <Input id="category" {...register('category')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Default UoM</Label>
                  <Select defaultValue={product.default_uom || 'kg'} onValueChange={(v) => setValue('defaultUom', v)}>
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
                  <Label htmlFor="isFtl">FDA Food Traceability List</Label>
                </div>
              </div>

              <Separator />

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Custom KDE Fields</Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => append({ name: '', label: '', type: 'string', required: false })}>
                    <Plus className="h-3 w-3 mr-1" /> Add Field
                  </Button>
                </div>
                {fields.map((field, index) => (
                  <div key={field.id} className="grid grid-cols-12 gap-2 items-end p-3 rounded-md border bg-muted/30">
                    <div className="col-span-3 flex flex-col gap-1">
                      <Label className="text-xs">Name</Label>
                      <Input {...register(`customKdeSchema.${index}.name`)} placeholder="field_name" className="text-sm" />
                    </div>
                    <div className="col-span-3 flex flex-col gap-1">
                      <Label className="text-xs">Label</Label>
                      <Input {...register(`customKdeSchema.${index}.label`)} placeholder="Label" className="text-sm" />
                    </div>
                    <div className="col-span-2 flex flex-col gap-1">
                      <Label className="text-xs">Type</Label>
                      <Select defaultValue={field.type || 'string'} onValueChange={(v) => setValue(`customKdeSchema.${index}.type`, v)}>
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
                      <input type="checkbox" {...register(`customKdeSchema.${index}.required`)} className="rounded" />
                      <span className="text-xs">Required</span>
                    </div>
                    <div className="col-span-2 flex justify-end pb-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
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
              <CardTitle>Product Info</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">SKU</span>
                <span>{product.sku || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">GTIN</span>
                <span>{product.gtin || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Category</span>
                <span>{product.category || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Default UoM</span>
                <span>{product.default_uom}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{new Date(product.created_at).toLocaleDateString()}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Custom KDE Fields ({kdeSchema.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {kdeSchema.length === 0 ? (
                <p className="text-sm text-muted-foreground">No custom fields defined. Standard KDEs are always captured.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {kdeSchema.map((field, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded border text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{field.label}</span>
                        <span className="text-xs text-muted-foreground">({field.name})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{KDE_TYPE_LABELS[field.type] || field.type}</Badge>
                        {field.required && <Badge variant="destructive" className="text-xs">Required</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default ProductDetailPage;
