import { ReactNode, useState } from 'react';
import { Sidebar } from './Sidebar';
import { useAuth } from '@/lib/auth';
import { Redirect, useLocation } from 'wouter';
import { Search, Plus, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Map routes to a page label for the "New" button — extend as needed
const NEW_BUTTON_LABELS: Record<string, string> = {
  '/cases': 'New Case',
  '/documents': 'New Document',
  '/billing': 'New Entry',
  '/contracts': 'New Contract',
  '/tasks': 'New Task',
  '/ai-drafts': 'New Draft',
  '/team': 'Invite',
  '/admin/users': 'Add User',
};

function TopBar() {
  const [query, setQuery] = useState('');
  const { user } = useAuth();
  const [location] = useLocation();

  // Find best-matching label
  const newLabel =
    Object.entries(NEW_BUTTON_LABELS).find(([path]) =>
      location === path || location.startsWith(path + '/'),
    )?.[1] ?? 'New';

  const initials = user?.name
    ?.split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() ?? 'U';

  return (
    <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-border/40 bg-card/60 backdrop-blur-sm sticky top-0 z-20">
      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search across platform…"
          className="pl-8 h-7 text-sm bg-background/60 border-border/50 focus-visible:ring-1"
        />
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Notifications */}
        <button className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors relative">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />
        </button>

        {/* User avatar */}
        <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary select-none">
          {initials}
        </div>

        {/* New button */}
        <Button size="sm" className="h-7 text-xs gap-1.5 px-3">
          <Plus className="h-3.5 w-3.5" />
          {newLabel}
        </Button>
      </div>
    </header>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  if (!user) {
    return <Redirect to="/login" />;
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden antialiased">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto flex flex-col relative">
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="px-6 py-5 border-b border-border/40 bg-card/30">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-serif font-semibold text-foreground tracking-tight">{title}</h1>
          {description && (
            <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
          )}
        </div>
        {(actions || children) && (
          <div className="flex items-center gap-3 shrink-0">
            {actions}
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
