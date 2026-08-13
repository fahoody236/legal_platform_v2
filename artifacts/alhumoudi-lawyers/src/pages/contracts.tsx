import { useState } from 'react';
import { useListContracts, getListContractsQueryKey } from '@workspace/api-client-react';
import { PageHeader } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { StatusBadge, AmountFormatter } from '@/components/ui/status-badge';
import { Plus, Search, ScrollText, Calendar as CalendarIcon } from 'lucide-react';
import { Link } from 'wouter';
import { format } from 'date-fns';

export default function Contracts() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const { data: contracts, isLoading } = useListContracts({ 
    search: search || undefined,
    status: statusFilter || undefined
  }, { 
    query: { queryKey: getListContractsQueryKey({ search: search || undefined, status: statusFilter || undefined }) } 
  });

  return (
    <div className="flex-1 flex flex-col">
      <PageHeader 
        title="Contracts & Retainers" 
        description="Manage recurring retainers, advisory agreements, and payment schedules."
      >
        <Button className="h-10 px-4 py-2">
          <Plus className="mr-2 h-4 w-4" />
          New Contract
        </Button>
      </PageHeader>

      <div className="p-8 space-y-6 max-w-7xl mx-auto w-full">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search by contract number, client..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card"
            />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="flex p-1 bg-muted/50 rounded-lg">
              {['', 'active', 'draft', 'finished', 'cancelled'].map(status => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                    statusFilter === status 
                      ? 'bg-card text-foreground shadow-sm' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {status || 'All'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Card className="border-border/40 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wider border-b border-border/40">
                <tr>
                  <th className="px-6 py-4 font-medium">Contract Ref.</th>
                  <th className="px-6 py-4 font-medium">Client & Case</th>
                  <th className="px-6 py-4 font-medium">Type & Status</th>
                  <th className="px-6 py-4 font-medium">Terms</th>
                  <th className="px-6 py-4 font-medium text-right">Value</th>
                  <th className="px-6 py-4 font-medium text-right">Next Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-4"><div className="h-10 bg-muted animate-pulse rounded"></div></td>
                      <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-32"></div></td>
                      <td className="px-6 py-4"><div className="h-8 bg-muted animate-pulse rounded w-24"></div></td>
                      <td className="px-6 py-4"><div className="h-8 bg-muted animate-pulse rounded w-24"></div></td>
                      <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-20 ml-auto"></div></td>
                      <td className="px-6 py-4"></td>
                    </tr>
                  ))
                ) : contracts?.length ? (
                  contracts.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/20 transition-colors group cursor-pointer">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-foreground mb-1">{c.title}</div>
                        <div className="text-xs font-mono text-muted-foreground">{c.contractNumber}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-foreground">{c.clientName}</div>
                        {c.caseId && (
                          <Link href={`/cases/${c.caseId}`} className="text-xs text-primary hover:underline block mt-1 truncate max-w-[200px]" title={c.caseName || ''}>
                            {c.caseName}
                          </Link>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{c.contractType.replace('_', ' ')}</div>
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                          <span className="w-10">Start:</span>
                          <span className="font-mono text-foreground">{format(new Date(c.startDate), 'MMM dd, yyyy')}</span>
                        </div>
                        {c.endDate && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="w-10">End:</span>
                            <span className="font-mono text-foreground">{format(new Date(c.endDate), 'MMM dd, yyyy')}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="font-mono font-bold text-foreground">
                          <AmountFormatter amount={c.totalValue} />
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {c.nextPaymentDate ? (
                          <div className="inline-flex flex-col items-end">
                            <span className="font-mono text-sm font-semibold text-foreground bg-primary/10 px-2 py-0.5 rounded text-primary border border-primary/20">
                              {format(new Date(c.nextPaymentDate), 'MMM dd, yyyy')}
                            </span>
                            <span className="text-xs text-muted-foreground mt-1">Upcoming</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                      <ScrollText className="h-10 w-10 mx-auto opacity-20 mb-3" />
                      <p className="text-lg font-medium text-foreground">No contracts found</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
