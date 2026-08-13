import { useState } from 'react';
import { useListTasks, getListTasksQueryKey } from '@workspace/api-client-react';
import { PageHeader } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { CheckSquare, Clock, Plus, Filter, User as UserIcon } from 'lucide-react';
import { Link } from 'wouter';
import { format } from 'date-fns';
import { useAuth } from '@/lib/auth';

export default function Tasks() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<'all' | 'mine'>('all');

  const { data: tasks, isLoading } = useListTasks({
    assigneeId: filter === 'mine' ? user?.id : undefined
  }, { 
    query: { queryKey: getListTasksQueryKey({ assigneeId: filter === 'mine' ? user?.id : undefined }) } 
  });

  const columns = [
    { id: 'pending', title: 'Pending' },
    { id: 'in_progress', title: 'In Progress' },
    { id: 'done', title: 'Completed' },
  ];

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <PageHeader 
        title="Tasks & Deadlines" 
        description="Manage matter deliverables and administrative tasks."
      >
        <Button className="h-10 px-4 py-2">
          <Plus className="mr-2 h-4 w-4" />
          Add Task
        </Button>
      </PageHeader>

      <div className="px-8 py-4 border-b border-border/40 bg-card flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 bg-muted/50 p-1 rounded-lg">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              filter === 'all' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Firm Tasks
          </button>
          <button
            onClick={() => setFilter('mine')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              filter === 'mine' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            My Tasks
          </button>
        </div>
        <Button variant="outline" size="sm">
          <Filter className="mr-2 h-4 w-4" />
          Filter & Sort
        </Button>
      </div>

      <div className="flex-1 overflow-x-auto p-8">
        <div className="flex gap-6 h-full min-w-max">
          {columns.map(col => {
            const colTasks = tasks?.filter(t => t.status === col.id) || [];
            
            return (
              <div key={col.id} className="w-96 flex flex-col h-full">
                <div className="flex items-center justify-between mb-4 px-1">
                  <h3 className="font-serif font-bold text-lg text-foreground flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      col.id === 'done' ? 'bg-emerald-500' : col.id === 'in_progress' ? 'bg-amber-500' : 'bg-blue-500'
                    }`}></span>
                    {col.title}
                  </h3>
                  <span className="text-xs font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                    {isLoading ? '-' : colTasks.length}
                  </span>
                </div>
                
                <div className="flex-1 overflow-y-auto space-y-4 pr-2 pb-4">
                  {isLoading ? (
                    [...Array(3)].map((_, i) => (
                      <Card key={i} className="border-border/40 shadow-sm animate-pulse">
                        <CardContent className="p-4 h-32 bg-muted/50"></CardContent>
                      </Card>
                    ))
                  ) : colTasks.length ? (
                    colTasks.map(task => (
                      <Card key={task.id} className="border-border/40 shadow-sm hover:shadow-md transition-shadow group cursor-grab">
                        <CardContent className="p-4 flex flex-col h-full gap-3">
                          <div className="flex justify-between items-start gap-2">
                            <StatusBadge status={task.priority} className="text-[10px] px-1.5 py-0 leading-tight" />
                            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 -mr-2 -mt-2">
                              <CheckSquare className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </div>
                          
                          <div>
                            <h4 className="font-medium text-sm text-foreground leading-tight mb-1">{task.title}</h4>
                            {task.caseId && (
                              <Link href={`/cases/${task.caseId}`} className="text-xs text-primary hover:underline line-clamp-1">
                                {task.caseName}
                              </Link>
                            )}
                          </div>
                          
                          <div className="mt-auto pt-3 flex items-center justify-between border-t border-border/40">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              {task.assigneeId ? (
                                <>
                                  <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                                    {task.assigneeName?.charAt(0) || 'U'}
                                  </div>
                                  <span className="truncate max-w-[80px]" title={task.assigneeName || ''}>{task.assigneeName?.split(' ')[0]}</span>
                                </>
                              ) : (
                                <>
                                  <UserIcon className="h-3 w-3" />
                                  <span>Unassigned</span>
                                </>
                              )}
                            </div>
                            
                            {task.dueDate && (
                              <div className={`flex items-center gap-1 text-xs font-mono ${
                                task.status !== 'done' && new Date(task.dueDate) < new Date() ? 'text-destructive font-bold' : 'text-muted-foreground'
                              }`}>
                                <Clock className="h-3 w-3" />
                                {format(new Date(task.dueDate), 'MMM dd')}
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  ) : (
                    <div className="h-32 border-2 border-dashed border-border/40 rounded-xl flex items-center justify-center text-muted-foreground text-sm p-4 text-center">
                      No tasks in this column
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
