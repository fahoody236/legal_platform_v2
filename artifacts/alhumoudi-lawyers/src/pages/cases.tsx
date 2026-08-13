import { useState } from 'react';
import { useListCases, getListCasesQueryKey } from '@workspace/api-client-react';
import { PageHeader } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Plus, Search, Filter, MoreHorizontal, FileText, CheckCircle2 } from 'lucide-react';
import { Link } from 'wouter';
import { format } from 'date-fns';

export default function Cases() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const { data: cases, isLoading } = useListCases({ 
    search: search || undefined,
    status: statusFilter || undefined
  }, { 
    query: { queryKey: getListCasesQueryKey({ search: search || undefined, status: statusFilter || undefined }) } 
  });

  return (
    <div className="flex-1 flex flex-col">
      <PageHeader 
        title="Matters & Cases" 
        description="Manage active litigations, corporate matters, and advisory cases."
      >
        <Link href="/cases/new" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
          <Plus className="mr-2 h-4 w-4" />
          Open New Matter
        </Link>
      </PageHeader>

      <div className="p-8 space-y-6 max-w-7xl mx-auto w-full">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search by case number, client, or title..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card"
            />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="flex p-1 bg-muted/50 rounded-lg">
              {['', 'open', 'active', 'on_hold', 'closed'].map(status => (
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
                  <th className="px-6 py-4 font-medium">Case Info</th>
                  <th className="px-6 py-4 font-medium">Client</th>
                  <th className="px-6 py-4 font-medium">Type & Jurisdiction</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                  <th className="px-6 py-4 font-medium">Key Dates</th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-4"><div className="h-10 bg-muted animate-pulse rounded"></div></td>
                      <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-24"></div></td>
                      <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-32"></div></td>
                      <td className="px-6 py-4"><div className="h-6 bg-muted animate-pulse rounded-full w-16"></div></td>
                      <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-20"></div></td>
                      <td className="px-6 py-4"></td>
                    </tr>
                  ))
                ) : cases?.length ? (
                  cases.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/20 transition-colors group">
                      <td className="px-6 py-4">
                        <Link href={`/cases/${c.id}`} className="font-semibold text-foreground hover:text-primary transition-colors block mb-1">
                          {c.title}
                        </Link>
                        <div className="text-xs font-mono text-muted-foreground">{c.caseNumber}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium">{c.clientName}</div>
                        {c.assignedLawyerName && (
                          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary/50"></span>
                            {c.assignedLawyerName}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium capitalize">{c.caseType.replace('_', ' ')}</div>
                        <div className="text-xs text-muted-foreground mt-1">{c.jurisdiction} {c.court && `• ${c.court}`}</div>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-6 py-4">
                        {c.courtDate ? (
                          <div className="text-sm">
                            <span className="text-muted-foreground text-xs block mb-0.5">Hearing</span>
                            <span className="font-mono">{format(new Date(c.courtDate), 'MMM dd, yyyy')}</span>
                          </div>
                        ) : c.statuteDeadline ? (
                          <div className="text-sm">
                            <span className="text-muted-foreground text-xs block mb-0.5">Deadline</span>
                            <span className="font-mono text-destructive">{format(new Date(c.statuteDeadline), 'MMM dd, yyyy')}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link href={`/cases/${c.id}`} className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 px-3 opacity-0 group-hover:opacity-100">
                          View Details
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                      <div className="flex flex-col items-center justify-center">
                        <Search className="h-10 w-10 opacity-20 mb-4" />
                        <p className="text-lg font-medium text-foreground">No matters found</p>
                        <p className="text-sm mt-1">Try adjusting your search or filters.</p>
                        <Link href="/cases/new" className="mt-4 text-primary hover:underline text-sm font-medium">
                          Open a new matter
                        </Link>
                      </div>
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
