import { cn } from '@/lib/utils';
import { useLocation, Link } from 'wouter';
import { useAuth } from '@/lib/auth';
import {
  LayoutDashboard,
  Briefcase,
  FileText,
  Receipt,
  ScrollText,
  CheckSquare,
  Wand2,
  MessageSquare,
  Users,
  Settings,
  LogOut,
} from 'lucide-react';

const navItems = [
  { name: 'Dashboard',  path: '/',           icon: LayoutDashboard },
  { name: 'Cases',      path: '/cases',       icon: Briefcase       },
  { name: 'Documents',  path: '/documents',   icon: FileText        },
  { name: 'Billing',    path: '/billing',     icon: Receipt         },
  { name: 'Contracts',  path: '/contracts',   icon: ScrollText      },
  { name: 'Tasks',      path: '/tasks',       icon: CheckSquare     },
  { name: 'AI Drafts',  path: '/ai-drafts',   icon: Wand2           },
  { name: 'Team Chat',  path: '/chat',        icon: MessageSquare   },
  { name: 'Team',       path: '/team',        icon: Users           },
];

const adminItems = [
  { name: 'User Management', path: '/admin/users', icon: Settings },
];

interface NavButtonProps {
  name: string;
  path: string;
  icon: React.ElementType;
  isActive: boolean;
}

function NavButton({ name, path, icon: Icon, isActive }: NavButtonProps) {
  return (
    <Link href={path}>
      <div className="relative group flex items-center justify-center">
        <button
          className={cn(
            'relative h-11 w-11 rounded-xl flex items-center justify-center transition-all duration-150',
            isActive
              ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30'
              : 'text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground',
          )}
          aria-label={name}
        >
          <Icon className="h-5 w-5" />
        </button>

        {/* Tooltip */}
        <div className="pointer-events-none absolute left-14 z-50 whitespace-nowrap rounded-md bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md ring-1 ring-border opacity-0 group-hover:opacity-100 transition-opacity duration-150 delay-100">
          {name}
          {/* Arrow */}
          <span className="absolute -left-1 top-1/2 -translate-y-1/2 h-2 w-2 rotate-45 bg-popover ring-1 ring-border [clip-path:polygon(0_0,100%_0,100%_100%)]" />
        </div>
      </div>
    </Link>
  );
}

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const isActive = (path: string) =>
    path === '/'
      ? location === '/'
      : location === path || location.startsWith(path + '/');

  const initials = user?.name
    ?.split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() ?? 'U';

  return (
    <div className="flex h-screen w-[72px] shrink-0 flex-col items-center bg-sidebar border-r border-sidebar-border py-4 gap-1">

      {/* Logo mark */}
      <Link href="/">
        <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-serif font-bold text-xl mb-4 cursor-pointer hover:opacity-90 transition-opacity">
          A
        </div>
      </Link>

      {/* Divider */}
      <div className="w-8 h-px bg-sidebar-border/60 mb-2" />

      {/* Main nav */}
      <nav className="flex flex-col items-center gap-1 flex-1">
        {navItems.map((item) => (
          <NavButton
            key={item.path}
            {...item}
            isActive={isActive(item.path)}
          />
        ))}

        {/* Admin section */}
        {user?.role === 'admin' && (
          <>
            <div className="w-8 h-px bg-sidebar-border/60 my-2" />
            {adminItems.map((item) => (
              <NavButton
                key={item.path}
                {...item}
                isActive={isActive(item.path)}
              />
            ))}
          </>
        )}
      </nav>

      {/* User avatar + logout */}
      <div className="flex flex-col items-center gap-2 mt-auto">
        <div className="relative group flex items-center justify-center">
          <div className="h-9 w-9 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-bold text-sidebar-accent-foreground cursor-default select-none">
            {initials}
          </div>
          {/* Tooltip */}
          <div className="pointer-events-none absolute left-14 z-50 whitespace-nowrap rounded-md bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md ring-1 ring-border opacity-0 group-hover:opacity-100 transition-opacity duration-150 delay-100">
            <span className="block font-semibold">{user?.name}</span>
            <span className="text-muted-foreground capitalize">{user?.role}</span>
            <span className="absolute -left-1 top-1/2 -translate-y-1/2 h-2 w-2 rotate-45 bg-popover ring-1 ring-border [clip-path:polygon(0_0,100%_0,100%_100%)]" />
          </div>
        </div>

        <div className="relative group flex items-center justify-center">
          <button
            onClick={logout}
            className="h-9 w-9 rounded-xl flex items-center justify-center text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-all duration-150"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
          <div className="pointer-events-none absolute left-14 z-50 whitespace-nowrap rounded-md bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md ring-1 ring-border opacity-0 group-hover:opacity-100 transition-opacity duration-150 delay-100">
            Log out
            <span className="absolute -left-1 top-1/2 -translate-y-1/2 h-2 w-2 rotate-45 bg-popover ring-1 ring-border [clip-path:polygon(0_0,100%_0,100%_100%)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
