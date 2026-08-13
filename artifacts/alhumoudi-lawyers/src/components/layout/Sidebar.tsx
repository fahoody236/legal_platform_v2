import { cn } from '@/lib/utils';
import { useLocation } from 'wouter';
import { useAuth } from '@/lib/auth';
import { 
  LayoutDashboard, 
  Briefcase, 
  FileText, 
  Receipt, 
  ScrollText, 
  CheckSquare, 
  Wand2, 
  Users, 
  Settings,
  LogOut,
  MessageSquare,
} from 'lucide-react';
import { Link } from 'wouter';

const navItems = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Cases', path: '/cases', icon: Briefcase },
  { name: 'Documents', path: '/documents', icon: FileText },
  { name: 'Billing', path: '/billing', icon: Receipt },
  { name: 'Contracts', path: '/contracts', icon: ScrollText },
  { name: 'Tasks', path: '/tasks', icon: CheckSquare },
  { name: 'AI Drafts', path: '/ai-drafts', icon: Wand2 },
  { name: 'Team Chat', path: '/chat', icon: MessageSquare },
  { name: 'Team', path: '/team', icon: Users },
];

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shadow-xl">
      <div className="flex h-16 shrink-0 items-center px-6 border-b border-sidebar-border/50">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded bg-primary-foreground flex items-center justify-center text-primary font-serif font-bold text-xl">
            A
          </div>
          <span className="font-serif font-semibold text-lg tracking-wide">ALHUMOUDI</span>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto py-6 px-4 flex flex-col gap-1">
        <div className="px-2 mb-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          Practice Management
        </div>
        
        {navItems.map((item) => {
          const isActive = location === item.path || (item.path !== '/' && location.startsWith(item.path));
          
          return (
            <Link 
              key={item.path} 
              href={item.path}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200",
                isActive 
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm" 
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}

        {user?.role === 'admin' && (
          <>
            <div className="px-2 mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              Administration
            </div>
            <Link 
              href="/admin/users"
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200",
                location.startsWith('/admin/users')
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm" 
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Settings className="h-4 w-4" />
              User Management
            </Link>
          </>
        )}
      </div>
      
      <div className="mt-auto border-t border-sidebar-border/50 p-4">
        <div className="flex items-center gap-3 rounded-md px-3 py-2">
          <div className="h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center font-bold text-xs uppercase text-sidebar-accent-foreground">
            {user?.name?.charAt(0) || 'U'}
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-sm font-medium truncate">{user?.name}</span>
            <span className="text-xs text-sidebar-foreground/60 truncate capitalize">{user?.role}</span>
          </div>
          <button 
            onClick={handleLogout}
            className="p-1.5 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-md transition-colors"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
