import {
  createElement,
  // Navigation & chrome
  LayoutDashboard, SquareKanban, Users, Building2, CalendarCheck, ChartColumn,
  Settings, Plus, Search, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Ellipsis,
  Pencil, Trash2, Sun, Moon, Monitor, Download, Upload, LogOut, Check, Menu,
  // Domain
  Handshake, Target, Clock, TrendingUp, TrendingDown, ArrowRight, User,
  UserPlus, Globe, Briefcase, GripVertical, CircleAlert, Video, Phone, Mail,
  StickyNote, Sparkles, WifiOff, Trophy, CircleX, Undo2, CalendarDays,
  CircleDollarSign, Inbox, ListChecks, FileDown, FileUp, Percent, Info,
  SquareCheckBig, RotateCcw, Building, Tag, Repeat, AlarmClock, Merge,
  Paperclip, FileText,
} from 'lucide';

const ICONS = {
  dashboard: LayoutDashboard,
  pipeline: SquareKanban,
  users: Users,
  company: Building2,
  building: Building,
  followups: CalendarCheck,
  chart: ChartColumn,
  gear: Settings,
  plus: Plus,
  search: Search,
  x: X,
  chevL: ChevronLeft,
  chevR: ChevronRight,
  chevD: ChevronDown,
  chevU: ChevronUp,
  more: Ellipsis,
  menu: Menu,
  pencil: Pencil,
  trash: Trash2,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  download: Download,
  upload: Upload,
  fileDown: FileDown,
  fileUp: FileUp,
  logout: LogOut,
  check: Check,
  checkbox: SquareCheckBig,
  deal: Handshake,
  target: Target,
  clock: Clock,
  trendUp: TrendingUp,
  trendDown: TrendingDown,
  arrowR: ArrowRight,
  user: User,
  userPlus: UserPlus,
  globe: Globe,
  briefcase: Briefcase,
  grip: GripVertical,
  alert: CircleAlert,
  video: Video,
  phone: Phone,
  mail: Mail,
  note: StickyNote,
  sparkle: Sparkles,
  wifiOff: WifiOff,
  trophy: Trophy,
  circleX: CircleX,
  undo: Undo2,
  calendar: CalendarDays,
  money: CircleDollarSign,
  inbox: Inbox,
  listChecks: ListChecks,
  percent: Percent,
  info: Info,
  reset: RotateCcw,
  tag: Tag,
  repeat: Repeat,
  snooze: AlarmClock,
  merge: Merge,
  paperclip: Paperclip,
  fileText: FileText,
};

/** Render a Lucide icon as an HTML string. Unknown names fall back to a tag. */
export function icon(name, size = 22, strokeWidth = 1.8) {
  const node = ICONS[name] || Tag;
  const svg = createElement(node);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('aria-hidden', 'true');
  return svg.outerHTML;
}
