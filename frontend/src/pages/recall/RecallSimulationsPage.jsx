import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Plus, Search, Eye } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

import { useGetSimulations, useRunSimulation } from '@/api/recall.api';
import { useGetLots } from '@/api/lots.api';
import { usePermissions } from '@/hooks/usePermissions';
import { toPageParam } from '@/lib/pagination';

import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

const runSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  triggeringLotId: z.string().min(1, 'Lot is required'),
});

export default function RecallSimulationsPage() {
  const [page, setPage] = useState(1);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { can } = usePermissions();
  const navigate = useNavigate();

  const { data: response, isLoading } = useGetSimulations({ page, limit: 10 });
  const runMutation = useRunSimulation();
  const { data: lotsResponse, isLoading: isLoadingLots } = useGetLots({ limit: 50 });

  const { register, handleSubmit, formState: { errors }, reset, setValue, watch } = useForm({
    resolver: zodResolver(runSchema),
    defaultValues: { name: '', triggeringLotId: '' }
  });

  const onSubmit = async (data) => {
    try {
      const result = await runMutation.mutateAsync(data);
      setIsDialogOpen(false);
      reset();
      navigate(`/recall/${result.id}`);
    } catch (err) {
      // handled by api interceptor/react-query
    }
  };

  const columns = [
    {
      accessorKey: 'name',
      header: 'Simulation Name',
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const s = row.original.status;
        return (
          <Badge variant={s === 'complete' ? 'success' : s === 'running' ? 'warning' : 'destructive'}>
            {s === 'complete' ? 'Complete' : s === 'running' ? 'Running' : 'Failed'}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'run_at',
      header: 'Run Date',
      cell: ({ row }) => format(new Date(row.original.run_at), 'MMM d, yyyy HH:mm'),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/recall/${row.original.id}`}>
              <Eye className="w-4 h-4 mr-2" />
              View Results
            </Link>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recall Simulations"
        description="Run and review mock recalls to test your traceability readiness."
        icon={AlertTriangle}
        action={
          can('recall.write') && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Run Simulation
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Run Recall Simulation</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Simulation Name</Label>
                    <Input id="name" {...register('name')} placeholder="e.g., Q3 Mock Recall - Widget A" />
                    {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label>Triggering Lot</Label>
                    {isLoadingLots ? (
                      <Skeleton className="h-10 w-full" />
                    ) : (
                      <Select onValueChange={(val) => setValue('triggeringLotId', val)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a lot to recall" />
                        </SelectTrigger>
                        <SelectContent>
                          {lotsResponse?.data?.map(lot => (
                            <SelectItem key={lot.id} value={lot.id}>
                              {lot.traceabilityLotCode}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {errors.triggeringLotId && <p className="text-sm text-destructive">{errors.triggeringLotId.message}</p>}
                  </div>

                  <div className="pt-4 flex justify-end space-x-2">
                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={runMutation.isPending}>
                      {runMutation.isPending ? 'Running...' : 'Run Simulation'}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )
        }
      />

      <div className="bg-white border rounded-lg overflow-hidden">
        {response?.data?.length === 0 && !isLoading ? (
          <EmptyState
            icon={AlertTriangle}
            title="No simulations run yet"
            description="Run a mock recall to verify your trace engine and compliance readiness."
            action={
              can('recall.write') && (
                <Button onClick={() => setIsDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Run Simulation
                </Button>
              )
            }
          />
        ) : (
          <DataTable
            columns={columns}
            data={response?.data || []}
            isLoading={isLoading}
            pagination={response?.pagination}
            onPaginationChange={(newPagination) => setPage(toPageParam(newPagination))}
          />
        )}
      </div>
    </div>
  );
}
