import { useState } from 'react';
import { 
  useListUsers, 
  getListUsersQueryKey,
  useUpdateUser
} from '@workspace/api-client-react';
import { PageHeader } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge, AmountFormatter } from '@/components/ui/status-badge';
import { Users, Plus, Shield, ShieldCheck, Mail, Briefcase, SwitchCamera } from 'lucide-react';
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';

export default function AdminUsers() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const { data: users, isLoading } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  
  const updateUser = useUpdateUser();

  const handleToggleStatus = (id: number, currentActive: boolean) => {
    updateUser.mutate({
      id,
      data: { active: !currentActive }
    }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() })
    });
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50/50">
        <div className="text-center space-y-4">
          <Shield className="h-16 w-16 text-muted-foreground mx-auto opacity-20" />
          <h2 className="text-2xl font-serif font-bold">Access Denied</h2>
          <p className="text-muted-foreground">You do not have administrative privileges to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <PageHeader 
        title="User Management" 
        description="Manage system access, roles, and billing rates for firm personnel."
      >
        <Button className="h-10 px-4 py-2">
          <Plus className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </PageHeader>

      <div className="p-8 space-y-6 max-w-7xl mx-auto w-full">
        <Card className="border-border/40 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wider border-b border-border/40">
                <tr>
                  <th className="px-6 py-4 font-medium">Personnel</th>
                  <th className="px-6 py-4 font-medium">Role & Practice</th>
                  <th className="px-6 py-4 font-medium">Contact</th>
                  <th className="px-6 py-4 font-medium text-right">Billable Rate</th>
                  <th className="px-6 py-4 font-medium text-center">Status</th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-4"><div className="h-10 bg-muted animate-pulse rounded"></div></td>
                      <td className="px-6 py-4"><div className="h-8 bg-muted animate-pulse rounded w-24"></div></td>
                      <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-32"></div></td>
                      <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-16 ml-auto"></div></td>
                      <td className="px-6 py-4"><div className="h-6 bg-muted animate-pulse rounded-full w-16 mx-auto"></div></td>
                      <td className="px-6 py-4"></td>
                    </tr>
                  ))
                ) : users?.length ? (
                  users.map((u) => (
                    <tr key={u.id} className={`hover:bg-muted/20 transition-colors ${!u.active ? 'opacity-60' : ''}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs ${u.role === 'admin' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>
                            {u.name.charAt(0)}
                          </div>
                          <div>
                            <div className="font-semibold text-foreground">{u.name}</div>
                            {u.barNumber && <div className="text-xs font-mono text-muted-foreground mt-0.5">Bar: {u.barNumber}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 mb-1">
                          {u.role === 'admin' && <ShieldCheck className="h-3 w-3 text-primary" />}
                          <span className="text-xs font-bold uppercase tracking-wider text-foreground">{u.role}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{u.specialization || '-'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-sm">
                          <Mail className="h-3 w-3 text-muted-foreground" />
                          {u.email}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {u.billableRate ? (
                          <div className="font-mono font-bold text-foreground">
                            <AmountFormatter amount={u.billableRate} />/hr
                          </div>
                        ) : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <StatusBadge status={u.active ? 'active' : 'archived'} />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => handleToggleStatus(u.id, u.active || false)}
                          disabled={updateUser.isPending || u.id === currentUser.id}
                          className="text-xs"
                        >
                          {u.active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No personnel records found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
