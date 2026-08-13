import { useGetLawyerPerformance, getGetLawyerPerformanceQueryKey } from '@workspace/api-client-react';
import { PageHeader } from '@/components/layout/Shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AmountFormatter } from '@/components/ui/status-badge';
import { Users, TrendingUp, Briefcase, CheckSquare, Clock } from 'lucide-react';

export default function Team() {
  const { data: performance, isLoading } = useGetLawyerPerformance({ 
    query: { queryKey: getGetLawyerPerformanceQueryKey() } 
  });

  // Calculate aggregates
  const totalRevenue = performance?.reduce((sum, p) => sum + p.totalRevenue, 0) || 0;
  const totalBillable = performance?.reduce((sum, p) => sum + p.billableHours, 0) || 0;
  const totalActiveCases = performance?.reduce((sum, p) => sum + p.activeCases, 0) || 0;

  return (
    <div className="flex-1 flex flex-col">
      <PageHeader 
        title="Team Performance" 
        description="Monitor lawyer utilization, case load, and revenue generation."
      />

      <div className="p-8 space-y-8 max-w-7xl mx-auto w-full">
        {/* Firm Aggregates */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-border/40 shadow-sm bg-primary text-primary-foreground">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-primary-foreground/80 uppercase tracking-wider mb-2">Firm Revenue (MTD)</p>
                  <p className="text-3xl font-mono font-bold"><AmountFormatter amount={totalRevenue} /></p>
                </div>
                <div className="p-3 bg-white/10 rounded-xl">
                  <TrendingUp className="h-6 w-6 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/40 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Total Billable Hours</p>
                  <p className="text-3xl font-mono font-bold text-foreground">{totalBillable}</p>
                </div>
                <div className="p-3 bg-muted rounded-xl text-blue-500">
                  <Clock className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/40 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Active Matters</p>
                  <p className="text-3xl font-mono font-bold text-foreground">{totalActiveCases}</p>
                </div>
                <div className="p-3 bg-muted rounded-xl text-emerald-500">
                  <Briefcase className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/40 shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/20 border-b border-border/40">
            <CardTitle className="text-lg font-serif flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Lawyer Metrics
            </CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider border-b border-border/40">
                <tr>
                  <th className="px-6 py-4 font-medium">Lawyer / Practice Area</th>
                  <th className="px-6 py-4 font-medium text-center">Active Cases</th>
                  <th className="px-6 py-4 font-medium text-center">Tasks (Done/Pend)</th>
                  <th className="px-6 py-4 font-medium text-right">Billable Hours</th>
                  <th className="px-6 py-4 font-medium text-right">Avg Close Time</th>
                  <th className="px-6 py-4 font-medium text-right">Revenue Generated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {isLoading ? (
                  [...Array(4)].map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-4"><div className="h-10 bg-muted animate-pulse rounded"></div></td>
                      <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-12 mx-auto"></div></td>
                      <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-20 mx-auto"></div></td>
                      <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-16 ml-auto"></div></td>
                      <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-16 ml-auto"></div></td>
                      <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-24 ml-auto"></div></td>
                    </tr>
                  ))
                ) : performance?.length ? (
                  performance.map((p) => (
                    <tr key={p.lawyerId} className="hover:bg-muted/20 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                            {p.lawyerName.charAt(0)}
                          </div>
                          <div>
                            <div className="font-semibold text-foreground">{p.lawyerName}</div>
                            <div className="text-xs text-muted-foreground">{p.specialization || 'General Practice'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center font-mono font-medium">{p.activeCases}</td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-2 text-xs font-mono">
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">{p.tasksCompleted}</span>
                          <span className="text-muted-foreground">/</span>
                          <span className="text-amber-600 dark:text-amber-400 font-bold">{p.tasksPending}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right font-mono font-medium">{p.billableHours}</td>
                      <td className="px-6 py-4 text-right font-mono text-muted-foreground">
                        {p.avgCaseClosureTime ? `${p.avgCaseClosureTime} days` : '-'}
                      </td>
                      <td className="px-6 py-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        <AmountFormatter amount={p.totalRevenue} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No performance data available.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
