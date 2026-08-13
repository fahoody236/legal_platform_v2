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
  Sparkles,
  SlidersHorizontal,
  MessageSquare,
  Users,
  Settings,
  LogOut,
  ChevronRight,
} from 'lucide-react';

const navItems = [
  { name: 'Dashboard',     path: '/',              icon: LayoutDashboard   },
  { name: 'Cases',         path: '/cases',         icon: Briefcase         },
  { name: 'Documents',     path: '/documents',     icon: FileText          },
  { name: 'Billing',       path: '/billing',       icon: Receipt           },
  { name: 'Contracts',     path: '/contracts',     icon: ScrollText        },
  { name: 'Tasks',         path: '/tasks',         icon: CheckSquare       },
];

const aiItems = [
  { name: 'AI Assistant',  path: '/ai-assistant',  icon: Sparkles          },
  { name: 'AI Drafts',     path: '/ai-drafts',     icon: Wand2             },
  { name: 'AI Settings',   path: '/ai-settings',   icon: SlidersHorizontal },
];

const teamItems = [
  { name: 'Team Chat',     path: '/chat',          icon: MessageSquare     },
  { name: 'Team',          path: '/team',          icon: Users             },
];

const adminItems = [
  { name: 'User Management', path: '/admin/users', icon: Settings },
];

interface NavItemProps {
  name: string;
  path: string;
  icon: React.ElementType;
  isActive: boolean;
}

function NavItem({ name, path, icon: Icon, isActive }: NavItemProps) {
  return (
    <Link href={path}>
      <div
        className={cn(
          'flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150 group',
          isActive
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground',
        )}
      >
        <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary-foreground' : '')} />
        <span className="text-sm font-medium truncate">{name}</span>
        {!isActive && (
          <ChevronRight className="h-3.5 w-3.5 ml-auto opacity-0 group-hover:opacity-40 transition-opacity" />
        )}
      </div>
    </Link>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/30 select-none">
      {label}
    </p>
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
    <div className="flex h-screen w-[220px] shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
      {/* Logo / Brand */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border/60">
        <Link href="/">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-serif font-bold text-base shrink-0 cursor-pointer hover:opacity-90 transition-opacity">
            A
          </div>
        </Link>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-sidebar-foreground leading-tight truncate">Alhumoudi</p>
          <p className="text-[10px] text-sidebar-foreground/40 truncate">Law Firm Platform</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        <SectionLabel label="Main" />
        {navItems.map((item) => (
          <NavItem key={item.path} {...item} isActive={isActive(item.path)} />
        ))}

        <SectionLabel label="AI" />
        {aiItems.map((item) => (
          <NavItem key={item.path} {...item} isActive={isActive(item.path)} />
        ))}

        <SectionLabel label="People" />
        {teamItems.map((item) => (
          <NavItem key={item.path} {...item} isActive={isActive(item.path)} />
        ))}

        {user?.role === 'admin' && (
          <>
            <SectionLabel label="Admin" />
            {adminItems.map((item) => (
              <NavItem key={item.path} {...item} isActive={isActive(item.path)} />
            ))}
          </>
        )}
      </nav>

      {/* User / Logout */}
      <div className="border-t border-sidebar-border/60 px-3 py-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0 select-none">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-sidebar-foreground truncate">{user?.name}</p>
            <p className="text-[10px] text-sidebar-foreground/40 capitalize truncate">{user?.role}</p>
          </div>
          <button
            onClick={logout}
            title="Log out"
            className="h-7 w-7 rounded-md flex items-center justify-center text-sidebar-foreground/30 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-all shrink-0"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
