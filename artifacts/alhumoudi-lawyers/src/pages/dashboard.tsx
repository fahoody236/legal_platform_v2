import { 
  useGetDashboardStats, 
  useGetUpcomingDeadlines, 
  useGetLawyerPerformance, 
  useGetRecentActivity,
  getGetDashboardStatsQueryKey,
  getGetUpcomingDeadlinesQueryKey,
  getGetLawyerPerformanceQueryKey,
  getGetRecentActivityQueryKey
} from '@workspace/api-client-react';
import { PageHeader } from '@/components/layout/Shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { 
  Briefcase, 
  Clock, 
  AlertCircle, 
  Receipt, 
  Wand2, 
  ScrollText, 
  TrendingUp, 
  Activity 
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats({ query: { queryKey: getGetDashboardStatsQueryKey() } });
  const { data: deadlines, isLoading: deadlinesLoading } = useGetUpcomingDeadlines({}, { query: { queryKey: getGetUpcomingDeadlinesQueryKey({}) } });
  const { data: performance, isLoading: performanceLoading } = useGetLawyerPerformance({ query: { queryKey: getGetLawyerPerformanceQueryKey() } });
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity({ query: { queryKey: getGetRecentActivityQueryKey() } });

  const statCards = [
    { title: "Active Cases", value: stats?.activeCases, icon: Briefcase, color: "text-blue-500", trend: "+2 this month" },
    { title: "Pending Tasks", value: stats?.pendingTasks, icon: Clock, color: "text-amber-500", trend: `${stats?.overdueTasks || 0} overdue` },
    { title: "Unbilled Hours", value: stats?.unbilledHours, icon: Receipt, color: "text-emerald-500", trend: "Ready to invoice" },
    { title: "AI Drafts", value: stats?.pendingAiDrafts, icon: Wand2, color: "text-purple-500", trend: "Require approval" },
  ];

  return (
    <div className="flex-1 flex flex-col">
      <PageHeader 
        title="Dashboard" 
        description="Firm overview and priority actions."
      />
      
      <div className="p-8 space-y-8 max-w-7xl mx-auto w-full">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {statCards.map((stat, i) => (
            <Card key={i} className="border-border/40 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{stat.title}</p>
                    {statsLoading ? (
                      <div className="h-8 w-16 bg-muted animate-pulse rounded"></div>
                    ) : (
                      <p className="text-3xl font-serif font-bold text-foreground">{stat.value ?? 0}</p>
                    )}
                  </div>
                  <div className={`p-3 rounded-xl bg-muted/50 ${stat.color}`}>
                    <stat.icon className="h-6 w-6" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-xs text-muted-foreground">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  {stat.trend}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Column */}
          <div className="lg:col-span-2 space-y-8">
            {/* Lawyer Performance */}
            <Card className="border-border/40 shadow-sm">
              <CardHeader className="border-b border-border/40 bg-muted/20 pb-4">
                <CardTitle className="text-lg font-serif flex items-center gap-2">
                  <Briefcase className="h-5 w-5 text-primary" />
                  Team Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
                      <tr>
                        <th className="px-6 py-4 font-medium">Lawyer</th>
                        <th className="px-6 py-4 font-medium text-center">Active Cases</th>
                        <th className="px-6 py-4 font-medium text-right">Billable Hours</th>
                        <th className="px-6 py-4 font-medium text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {performanceLoading ? (
                        [...Array(3)].map((_, i) => (
                          <tr key={i}>
                            <td colSpan={4} className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded"></div></td>
                          </tr>
                        ))
                      ) : (
                        performance?.slice(0, 5).map((p) => (
                          <tr key={p.lawyerId} className="hover:bg-muted/30 transition-colors">
                            <td className="px-6 py-4">
                              <div className="font-medium text-foreground">{p.lawyerName}</div>
                              <div className="text-xs text-muted-foreground">{p.specialization || 'General Practice'}</div>
                            </td>
                            <td className="px-6 py-4 text-center font-mono">{p.activeCases}</td>
                            <td className="px-6 py-4 text-right font-mono">{p.billableHours}</td>
                            <td className="px-6 py-4 text-right font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                              {new Intl.NumberFormat('en-SA', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }).format(p.totalRevenue)}
                            </td>
                          </tr>
                        ))
                      )}
                      {!performance?.length && !performanceLoading && (
                        <tr>
                          <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">No performance data available.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card className="border-border/40 shadow-sm">
              <CardHeader className="border-b border-border/40 bg-muted/20 pb-4">
                <CardTitle className="text-lg font-serif flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  Recent Firm Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
                  {activityLoading ? (
                    <div className="h-32 bg-muted animate-pulse rounded-md"></div>
                  ) : (
                    activity?.slice(0, 5).map((act, i) => (
                      <div key={act.id || i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-primary text-primary-foreground shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                          <Activity className="h-4 w-4" />
                        </div>
                        <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-lg border border-border/50 bg-card shadow-sm">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-sm capitalize">{act.activityType.replace('_', ' ')}</span>
                            <time className="text-xs text-muted-foreground font-mono">{formatDistanceToNow(new Date(act.createdAt), { addSuffix: true })}</time>
                          </div>
                          <p className="text-sm text-muted-foreground">{act.description}</p>
                          <div className="mt-2 text-xs font-medium text-primary">
                            {act.caseTitle} • {act.performedBy}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column */}
          <div className="space-y-8">
            {/* Upcoming Deadlines */}
            <Card className="border-border/40 shadow-sm">
              <CardHeader className="border-b border-border/40 bg-muted/20 pb-4">
                <CardTitle className="text-lg font-serif flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-destructive" />
                  Upcoming Deadlines
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border/40">
                  {deadlinesLoading ? (
                    <div className="p-6 space-y-4">
                      <div className="h-12 bg-muted animate-pulse rounded"></div>
                      <div className="h-12 bg-muted animate-pulse rounded"></div>
                    </div>
                  ) : deadlines?.length ? (
                    deadlines.map((dl) => (
                      <div key={dl.id} className="p-4 hover:bg-muted/30 transition-colors flex gap-4">
                        <div className="flex flex-col items-center justify-center bg-muted rounded-md p-2 min-w-14 shrink-0 text-center">
                          <span className="text-xs text-muted-foreground uppercase font-semibold">{format(new Date(dl.deadline), 'MMM')}</span>
                          <span className="text-xl font-bold font-mono text-foreground leading-none">{format(new Date(dl.deadline), 'dd')}</span>
                        </div>
                        <div className="flex flex-col justify-center min-w-0">
                          <h4 className="text-sm font-semibold truncate text-foreground">{dl.title}</h4>
                          <p className="text-xs text-muted-foreground truncate">{dl.relatedCaseName || dl.assigneeName}</p>
                          <div className="mt-2 flex items-center gap-2">
                            <StatusBadge status={dl.type} className="text-[10px] px-1.5 py-0" />
                            {dl.daysUntil <= 3 && (
                              <span className="text-[10px] font-bold uppercase tracking-wider text-destructive bg-destructive/10 px-1.5 rounded-sm">Urgent</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-8 text-center text-muted-foreground">
                      <Clock className="h-8 w-8 mx-auto mb-3 opacity-20" />
                      <p>No upcoming deadlines in the next 7 days.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/40 shadow-sm bg-primary text-primary-foreground">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/10 rounded-lg">
                    <ScrollText className="h-6 w-6 text-white" />
                  </div>
                  <h3 className="font-serif font-bold text-lg">Active Contracts</h3>
                </div>
                <p className="text-primary-foreground/80 text-sm">
                  There are {stats?.activeContracts || 0} active contracts requiring review or payment collection this month.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
