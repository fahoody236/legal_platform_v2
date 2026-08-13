import { useState } from 'react';
import { 
  useListTimeEntries, 
  useListInvoices, 
  useListExpenses,
  useGetTimeSummary,
  getListTimeEntriesQueryKey,
  getListInvoicesQueryKey,
  getListExpensesQueryKey,
  getGetTimeSummaryQueryKey
} from '@workspace/api-client-react';
import { PageHeader } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge, AmountFormatter } from '@/components/ui/status-badge';
import { Receipt, Clock, CreditCard, Plus, Download, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'wouter';

export default function Billing() {
  const [activeTab, setActiveTab] = useState<'time' | 'invoices' | 'expenses'>('invoices');

  const { data: timeEntries, isLoading: timeLoading } = useListTimeEntries({}, { query: { enabled: activeTab === 'time', queryKey: getListTimeEntriesQueryKey({}) } });
  const { data: invoices, isLoading: invoicesLoading } = useListInvoices({}, { query: { enabled: activeTab === 'invoices', queryKey: getListInvoicesQueryKey({}) } });
  const { data: expenses, isLoading: expensesLoading } = useListExpenses({}, { query: { enabled: activeTab === 'expenses', queryKey: getListExpensesQueryKey({}) } });
  const { data: timeSummary } = useGetTimeSummary({ query: { queryKey: getGetTimeSummaryQueryKey() } });

  return (
    <div className="flex-1 flex flex-col">
      <PageHeader 
        title="Billing & Financials" 
        description="Manage firm revenue, invoicing, and billable hours."
      >
        {activeTab === 'invoices' && <Button><Plus className="mr-2 h-4 w-4" /> Create Invoice</Button>}
        {activeTab === 'time' && <Button><Clock className="mr-2 h-4 w-4" /> Log Time</Button>}
        {activeTab === 'expenses' && <Button><CreditCard className="mr-2 h-4 w-4" /> Add Expense</Button>}
      </PageHeader>

      {/* Tabs */}
      <div className="px-8 border-b border-border/40 bg-card">
        <div className="flex gap-6">
          {(['invoices', 'time', 'expenses'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-4 text-sm font-medium border-b-2 transition-colors capitalize flex items-center gap-2 ${
                activeTab === tab 
                  ? 'border-primary text-primary' 
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              {tab === 'invoices' && <Receipt className="h-4 w-4" />}
              {tab === 'time' && <Clock className="h-4 w-4" />}
              {tab === 'expenses' && <CreditCard className="h-4 w-4" />}
              {tab === 'time' ? 'Time Entries' : tab}
            </button>
          ))}
        </div>
      </div>

      <div className="p-8 max-w-7xl mx-auto w-full">
        {activeTab === 'invoices' && (
          <Card className="border-border/40 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wider border-b border-border/40">
                  <tr>
                    <th className="px-6 py-4 font-medium">Invoice No.</th>
                    <th className="px-6 py-4 font-medium">Client & Matter</th>
                    <th className="px-6 py-4 font-medium">Status</th>
                    <th className="px-6 py-4 font-medium">Dates</th>
                    <th className="px-6 py-4 font-medium text-right">Amount</th>
                    <th className="px-6 py-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {invoicesLoading ? (
                    <tr><td colSpan={6} className="p-8 text-center"><div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto"></div></td></tr>
                  ) : invoices?.length ? (
                    invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-muted/20 transition-colors group cursor-pointer" onClick={() => window.location.href = `/invoices/${inv.id}`}>
                        <td className="px-6 py-4 font-mono font-bold text-foreground">
                          <Link href={`/invoices/${inv.id}`} className="hover:text-primary">{inv.invoiceNumber}</Link>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-semibold text-foreground">{inv.clientName}</div>
                          <Link href={`/cases/${inv.caseId}`} className="text-xs text-primary hover:underline block truncate max-w-[200px]" title={inv.caseName || ''}>
                            {inv.caseName}
                          </Link>
                        </td>
                        <td className="px-6 py-4"><StatusBadge status={inv.status} /></td>
                        <td className="px-6 py-4">
                          <div className="text-xs text-muted-foreground mb-0.5">Issued: <span className="font-mono text-foreground">{format(new Date(inv.issuedDate), 'MMM dd, yyyy')}</span></div>
                          {inv.dueDate && (
                            <div className="text-xs text-muted-foreground">Due: <span className="font-mono text-foreground">{format(new Date(inv.dueDate), 'MMM dd, yyyy')}</span></div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="font-mono font-bold text-foreground"><AmountFormatter amount={inv.totalAmount} /></div>
                          {inv.paidAmount ? (
                            <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Paid: <AmountFormatter amount={inv.paidAmount} /></div>
                          ) : null}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100"><Download className="h-4 w-4 mr-2" /> PDF</Button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No invoices found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {activeTab === 'time' && (
          <div className="space-y-6">
            {/* Time Summary */}
            {timeSummary && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <Card className="border-border/40 shadow-sm bg-muted/20">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Total Hours</p>
                      <p className="text-2xl font-mono font-bold text-foreground">{timeSummary.totalHours}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-border/40 shadow-sm bg-primary text-primary-foreground">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-primary-foreground/80 uppercase tracking-wider mb-1">Unbilled Amount</p>
                      <p className="text-2xl font-mono font-bold"><AmountFormatter amount={timeSummary.unbilledAmount} /></p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            <Card className="border-border/40 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wider border-b border-border/40">
                    <tr>
                      <th className="px-6 py-4 font-medium">Date & Lawyer</th>
                      <th className="px-6 py-4 font-medium">Matter</th>
                      <th className="px-6 py-4 font-medium">Description</th>
                      <th className="px-6 py-4 font-medium text-right">Hours & Rate</th>
                      <th className="px-6 py-4 font-medium text-right">Amount</th>
                      <th className="px-6 py-4 font-medium text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {timeLoading ? (
                      <tr><td colSpan={6} className="p-8 text-center"><div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto"></div></td></tr>
                    ) : timeEntries?.length ? (
                      timeEntries.map((entry) => (
                        <tr key={entry.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-6 py-4">
                            <div className="font-mono text-xs text-muted-foreground mb-1">{format(new Date(entry.date), 'MMM dd, yyyy')}</div>
                            <div className="font-medium text-foreground">{entry.lawyerName}</div>
                          </td>
                          <td className="px-6 py-4">
                            <Link href={`/cases/${entry.caseId}`} className="font-medium text-primary hover:underline block truncate max-w-[200px]" title={entry.caseName || ''}>
                              {entry.caseName}
                            </Link>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm max-w-sm truncate" title={entry.description}>{entry.description}</p>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="font-mono font-bold text-foreground">{entry.hours} hrs</div>
                            <div className="text-xs text-muted-foreground mt-1 font-mono">{entry.hourlyRate}/hr</div>
                          </td>
                          <td className="px-6 py-4 text-right font-mono font-bold text-foreground">
                            <AmountFormatter amount={entry.totalAmount} />
                          </td>
                          <td className="px-6 py-4 text-center">
                            {entry.invoiced ? <StatusBadge status="invoiced" /> : entry.isBillable ? <StatusBadge status="unbilled" /> : <span className="text-xs text-muted-foreground">Non-billable</span>}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No time entries logged.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {activeTab === 'expenses' && (
          <Card className="border-border/40 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wider border-b border-border/40">
                  <tr>
                    <th className="px-6 py-4 font-medium">Date & Category</th>
                    <th className="px-6 py-4 font-medium">Matter</th>
                    <th className="px-6 py-4 font-medium">Description</th>
                    <th className="px-6 py-4 font-medium">Submitted By</th>
                    <th className="px-6 py-4 font-medium text-right">Amount</th>
                    <th className="px-6 py-4 font-medium text-center">Billable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {expensesLoading ? (
                    <tr><td colSpan={6} className="p-8 text-center"><div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto"></div></td></tr>
                  ) : expenses?.length ? (
                    expenses.map((exp) => (
                      <tr key={exp.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-mono text-xs text-muted-foreground mb-1">{format(new Date(exp.date), 'MMM dd, yyyy')}</div>
                          <div className="font-medium text-foreground capitalize">{exp.category.replace('_', ' ')}</div>
                        </td>
                        <td className="px-6 py-4">
                          <Link href={`/cases/${exp.caseId}`} className="font-medium text-primary hover:underline block truncate max-w-[200px]" title={exp.caseName || ''}>
                            {exp.caseName}
                          </Link>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm max-w-sm truncate">{exp.description}</p>
                        </td>
                        <td className="px-6 py-4 font-medium">{exp.submittedBy}</td>
                        <td className="px-6 py-4 text-right font-mono font-bold text-foreground">
                          <AmountFormatter amount={exp.amount} />
                        </td>
                        <td className="px-6 py-4 text-center">
                          {exp.billable ? <StatusBadge status="billable" /> : <span className="text-xs text-muted-foreground">Internal</span>}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No expenses recorded.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
