import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ChevronLeft, ChevronRight, Gavel, AlertTriangle,
  CheckSquare, FileText, CreditCard, CalendarDays,
} from 'lucide-react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  startOfWeek, endOfWeek, isSameMonth, isSameDay, isToday,
  addMonths, subMonths, parseISO,
} from 'date-fns';
import { cn } from '@/lib/utils';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  type: 'court_date' | 'deadline' | 'task' | 'contract_end' | 'payment';
  entityId: number;
  path: string;
  meta?: string;
}

const TYPE_CONFIG: Record<
  CalendarEvent['type'],
  { label: string; color: string; bg: string; border: string; icon: React.ElementType }
> = {
  court_date:   { label: 'Court Date',       color: 'text-red-600',    bg: 'bg-red-50',     border: 'border-red-200',    icon: Gavel        },
  deadline:     { label: 'Statute Deadline', color: 'text-orange-600', bg: 'bg-orange-50',  border: 'border-orange-200', icon: AlertTriangle },
  task:         { label: 'Task Due',         color: 'text-blue-600',   bg: 'bg-blue-50',    border: 'border-blue-200',   icon: CheckSquare  },
  contract_end: { label: 'Contract End',     color: 'text-purple-600', bg: 'bg-purple-50',  border: 'border-purple-200', icon: FileText     },
  payment:      { label: 'Payment Due',      color: 'text-green-700',  bg: 'bg-green-50',   border: 'border-green-200',  icon: CreditCard   },
};

const DOT_COLORS: Record<CalendarEvent['type'], string> = {
  court_date:   'bg-red-500',
  deadline:     'bg-orange-500',
  task:         'bg-blue-500',
  contract_end: 'bg-purple-500',
  payment:      'bg-green-600',
};

function useCalendarEvents(month: Date) {
  const start = format(startOfMonth(month), 'yyyy-MM-dd');
  const end = format(endOfMonth(month), 'yyyy-MM-dd');
  return useQuery<CalendarEvent[]>({
    queryKey: ['calendar-events', start, end],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/calendar/events?start=${start}&end=${end}`);
      if (!res.ok) throw new Error('Failed to fetch events');
      return res.json();
    },
  });
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const { data: events = [], isLoading } = useCalendarEvents(currentMonth);

  // Build a map: date-string → events[]
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const existing = map.get(ev.date) ?? [];
      existing.push(ev);
      map.set(ev.date, existing);
    }
    return map;
  }, [events]);

  // Calendar grid: weeks containing the month
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const gridStart = startOfWeek(monthStart);
    const gridEnd = endOfWeek(monthEnd);
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  const selectedEvents = selectedDay
    ? (eventsByDate.get(format(selectedDay, 'yyyy-MM-dd')) ?? [])
    : [];

  // Upcoming events for the side panel (next 14 days)
  const upcoming = useMemo(() => {
    return events
      .filter((e) => {
        const d = parseISO(e.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return d >= today;
      })
      .slice(0, 10);
  }, [events]);

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <PageHeader
        title="Calendar"
        description="Court dates, deadlines, and task due dates at a glance."
      />

      <div className="flex-1 flex overflow-hidden p-4 gap-4">
        {/* ── Month Grid ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">
              {format(currentMonth, 'MMMM yyyy')}
            </h2>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs px-3"
                onClick={() => { setCurrentMonth(new Date()); setSelectedDay(new Date()); }}
              >
                Today
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 mb-3">
            {Object.entries(TYPE_CONFIG).map(([type, cfg]) => (
              <div key={type} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn('h-2 w-2 rounded-full', DOT_COLORS[type as CalendarEvent['type']])} />
                {cfg.label}
              </div>
            ))}
          </div>

          {/* Grid */}
          <Card className="flex-1 overflow-hidden">
            <CardContent className="p-0 h-full flex flex-col">
              {/* Weekday headers */}
              <div className="grid grid-cols-7 border-b border-border/40">
                {WEEKDAYS.map((d) => (
                  <div
                    key={d}
                    className="py-2 text-center text-xs font-medium text-muted-foreground"
                  >
                    {d}
                  </div>
                ))}
              </div>

              {/* Day cells */}
              <div className="flex-1 grid grid-cols-7" style={{ gridAutoRows: '1fr' }}>
                {calendarDays.map((day) => {
                  const key = format(day, 'yyyy-MM-dd');
                  const dayEvents = eventsByDate.get(key) ?? [];
                  const inMonth = isSameMonth(day, currentMonth);
                  const today = isToday(day);
                  const selected = selectedDay ? isSameDay(day, selectedDay) : false;

                  // Unique event types for dots
                  const dotTypes = [...new Set(dayEvents.map((e) => e.type))];

                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedDay(day)}
                      className={cn(
                        'min-h-[70px] p-1.5 text-left border-b border-r border-border/20 flex flex-col gap-0.5 transition-colors',
                        !inMonth && 'bg-muted/20',
                        inMonth && 'hover:bg-accent/40',
                        selected && 'bg-primary/8 ring-1 ring-inset ring-primary/30',
                      )}
                    >
                      <span
                        className={cn(
                          'text-xs font-medium h-5 w-5 flex items-center justify-center rounded-full',
                          !inMonth && 'text-muted-foreground/40',
                          today && 'bg-primary text-primary-foreground',
                          !today && inMonth && 'text-foreground',
                        )}
                      >
                        {format(day, 'd')}
                      </span>

                      {/* Dots for event types */}
                      {dotTypes.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mt-0.5">
                          {dotTypes.map((type) => (
                            <span
                              key={type}
                              className={cn('h-1.5 w-1.5 rounded-full', DOT_COLORS[type])}
                            />
                          ))}
                        </div>
                      )}

                      {/* Show up to 2 event labels */}
                      <div className="flex flex-col gap-0.5 mt-0.5 w-full overflow-hidden">
                        {dayEvents.slice(0, 2).map((ev) => {
                          const cfg = TYPE_CONFIG[ev.type];
                          return (
                            <span
                              key={ev.id}
                              className={cn(
                                'text-[9px] leading-tight px-1 py-0.5 rounded truncate',
                                cfg.bg, cfg.color,
                              )}
                            >
                              {ev.title.replace(/^(Court|Task|Deadline|Contract Ends|Payment Due): /, '')}
                            </span>
                          );
                        })}
                        {dayEvents.length > 2 && (
                          <span className="text-[9px] text-muted-foreground px-1">
                            +{dayEvents.length - 2} more
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Side Panel ── */}
        <div className="w-72 shrink-0 flex flex-col gap-3">
          {/* Selected day events */}
          {selectedDay && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  {format(selectedDay, 'EEEE, MMMM d')}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {selectedEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No events this day.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedEvents.map((ev) => {
                      const cfg = TYPE_CONFIG[ev.type];
                      const Icon = cfg.icon;
                      return (
                        <Link key={ev.id} href={ev.path}>
                          <div
                            className={cn(
                              'flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer hover:opacity-80 transition-opacity',
                              cfg.bg, cfg.border,
                            )}
                          >
                            <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', cfg.color)} />
                            <div className="min-w-0">
                              <p className={cn('text-xs font-semibold leading-tight', cfg.color)}>
                                {cfg.label}
                              </p>
                              <p className="text-xs text-foreground/80 mt-0.5 leading-tight truncate">
                                {ev.title.replace(/^(Court|Task|Deadline|Contract Ends|Payment Due): /, '')}
                              </p>
                              {ev.meta && (
                                <p className="text-[10px] text-muted-foreground mt-0.5">{ev.meta}</p>
                              )}
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Upcoming events */}
          <Card className="flex-1 overflow-hidden flex flex-col">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm">Upcoming This Month</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 flex-1 overflow-hidden">
              {isLoading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : upcoming.length === 0 ? (
                <p className="text-xs text-muted-foreground">No upcoming events.</p>
              ) : (
                <ScrollArea className="h-full max-h-[400px]">
                  <div className="space-y-2">
                    {upcoming.map((ev) => {
                      const cfg = TYPE_CONFIG[ev.type];
                      const Icon = cfg.icon;
                      const evDate = parseISO(ev.date);
                      return (
                        <Link key={ev.id} href={ev.path}>
                          <div className="flex items-start gap-2.5 py-2 border-b border-border/30 last:border-0 cursor-pointer hover:opacity-70 transition-opacity">
                            <div className={cn('h-7 w-7 rounded-md flex items-center justify-center shrink-0', cfg.bg)}>
                              <Icon className={cn('h-3.5 w-3.5', cfg.color)} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium truncate">
                                {ev.title.replace(/^(Court|Task|Deadline|Contract Ends|Payment Due): /, '')}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <Badge variant="outline" className={cn('text-[9px] px-1 py-0 h-3.5 border-0', cfg.bg, cfg.color)}>
                                  {cfg.label}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground">
                                  {format(evDate, 'MMM d')}
                                </span>
                              </div>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
