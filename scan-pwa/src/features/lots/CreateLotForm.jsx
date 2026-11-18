import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { PackagePlus, RotateCcw } from 'lucide-react';

import { useGetProducts } from '@/api/products.api';
import { useCreateLot } from '@/api/lots.api';
import { buildLotPayload, toPositiveQuantity } from '@/lib/recordEventPayload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';

const createLotSchema = z.object({
  productId: z.string().min(1, 'Select a product'),
  quantity: z.string().trim().min(1, 'Quantity is required').refine(
    (value) => toPositiveQuantity(value) !== null,
    'Quantity must be a positive number',
  ),
  uom: z.string().trim().min(1, 'Unit of measure is required').max(20),
  notes: z.string().max(1000).optional(),
});

const SELECT_CLASS = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-base min-h-[44px] focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50';

/**
 * Creates a lot from an unknown scan or a manually typed code.
 *
 * @param {{
 *   lotCode: string,
 *   disabled?: boolean,
 *   onCreated: (lot: Object) => void,
 *   onCancel: () => void,
 * }} props
 */
export const CreateLotForm = ({ lotCode, disabled = false, onCreated, onCancel }) => {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: productsData, isLoading: isLoadingProducts } = useGetProducts({
    limit: 100,
    isActive: 'true',
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  });
  const { mutateAsync: createLot } = useCreateLot();

  const products = useMemo(() => productsData?.data ?? [], [productsData]);

  // Keep a selected product visible when a later search no longer returns it.
  const productOptions = useMemo(() => {
    if (selectedProduct && !products.some((product) => product.id === selectedProduct.id)) {
      return [selectedProduct, ...products];
    }
    return products;
  }, [products, selectedProduct]);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createLotSchema),
    defaultValues: {
      productId: '',
      quantity: '1',
      uom: '',
      notes: '',
    },
  });

  const onSubmit = async (values) => {
    try {
      const lot = await createLot(buildLotPayload({
        productId: values.productId,
        traceabilityLotCode: lotCode,
        quantity: values.quantity,
        uom: values.uom,
        notes: values.notes,
      }));
      toast.success('Lot created');
      onCreated(lot);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to create lot');
    }
  };

  const handleProductChange = (event) => {
    const productId = event.target.value;
    const product = productOptions.find((item) => item.id === productId) ?? null;
    setSelectedProduct(product);
    setValue('productId', productId, { shouldValidate: true });
    if (product?.default_uom) {
      setValue('uom', product.default_uom, { shouldValidate: true });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h3 className="font-semibold text-amber-900">Create New Lot</h3>
        <p className="font-mono text-sm mt-1 text-amber-800 break-all">{lotCode}</p>
      </div>

      {isLoadingProducts ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading products…
        </div>
      ) : productOptions.length === 0 ? (
        <p className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
          {debouncedSearch
            ? `No products match "${debouncedSearch}".`
            : 'No products available. Ask an admin to create a product before adding lots.'}
        </p>
      ) : null}

      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="lot-product-search">Find product</FieldLabel>
          <Input
            id="lot-product-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, SKU, or GTIN"
            autoComplete="off"
            className="min-h-[44px] text-base"
            disabled={disabled || isSubmitting}
          />
        </Field>

        <Field data-invalid={!!errors.productId}>
          <FieldLabel htmlFor="lot-product">Product</FieldLabel>
          <select
            id="lot-product"
            className={SELECT_CLASS}
            aria-invalid={!!errors.productId}
            disabled={disabled || isSubmitting || productOptions.length === 0}
            {...register('productId', { onChange: handleProductChange })}
          >
            <option value="">Select Product…</option>
            {productOptions.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
                {product.sku ? ` (${product.sku})` : ''}
              </option>
            ))}
          </select>
          {errors.productId && <FieldError>{errors.productId.message}</FieldError>}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field data-invalid={!!errors.quantity}>
            <FieldLabel htmlFor="lot-quantity">Quantity</FieldLabel>
            <Input
              id="lot-quantity"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              className="min-h-[44px] text-base"
              aria-invalid={!!errors.quantity}
              disabled={disabled || isSubmitting}
              {...register('quantity')}
            />
            {errors.quantity && <FieldError>{errors.quantity.message}</FieldError>}
          </Field>

          <Field data-invalid={!!errors.uom}>
            <FieldLabel htmlFor="lot-uom">Unit</FieldLabel>
            <Input
              id="lot-uom"
              className="min-h-[44px] text-base"
              placeholder="kg"
              aria-invalid={!!errors.uom}
              disabled={disabled || isSubmitting}
              {...register('uom')}
            />
            {errors.uom && <FieldError>{errors.uom.message}</FieldError>}
          </Field>
        </div>

        <Field data-invalid={!!errors.notes}>
          <FieldLabel htmlFor="lot-notes">Notes (optional)</FieldLabel>
          <Input
            id="lot-notes"
            className="min-h-[44px] text-base"
            aria-invalid={!!errors.notes}
            disabled={disabled || isSubmitting}
            {...register('notes')}
          />
          {errors.notes && <FieldError>{errors.notes.message}</FieldError>}
        </Field>
      </FieldGroup>

      <Button
        type="submit"
        className="w-full min-h-[44px]"
        disabled={disabled || isSubmitting || productOptions.length === 0}
      >
        {isSubmitting ? <Spinner data-icon="inline-start" /> : <PackagePlus data-icon="inline-start" />}
        Create Lot
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full min-h-[44px]"
        onClick={onCancel}
        disabled={isSubmitting}
      >
        <RotateCcw data-icon="inline-start" />
        Cancel
      </Button>
    </form>
  );
};
