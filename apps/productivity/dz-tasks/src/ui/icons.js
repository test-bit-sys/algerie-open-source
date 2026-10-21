import {
  createElement,
  // UI chrome
  House, CalendarDays, CalendarClock, LayoutGrid, Settings, Plus, Search, X,
  ChevronLeft, ChevronRight, Ellipsis, Pencil, Trash2, Sun, Moon, Monitor,
  LogOut, Check, Sparkles, Cloud, WifiOff, Repeat, Flag, Bell, Link, Share2,
  Users, ListChecks, Inbox, ArchiveRestore, FileDown, FileUp, CalendarPlus,
  Clock, CircleCheckBig, History, SkipForward, RotateCcw, Copy, ExternalLink,
  Eye, NotebookPen, ChevronDown, ChevronUp, CalendarArrowDown, CircleAlert,
  // List icons (kebab-case keys stored in user data)
  List, User, Briefcase, Heart, ShoppingCart, BookOpen, Plane, Star, Target,
  Dumbbell, Gift, Utensils, GraduationCap, PawPrint,
} from 'lucide';

const ICONS = {
  // UI chrome (keys kept stable across the app)
  home: House,
  calendar: CalendarDays,
  calendarClock: CalendarClock,
  calendarPlus: CalendarPlus,
  calendarFeed: CalendarArrowDown,
  grid: LayoutGrid,
  gear: Settings,
  plus: Plus,
  search: Search,
  x: X,
  chevL: ChevronLeft,
  chevR: ChevronRight,
  chevDown: ChevronDown,
  chevUp: ChevronUp,
  more: Ellipsis,
  pencil: Pencil,
  trash: Trash2,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  logout: LogOut,
  check: Check,
  checkBig: CircleCheckBig,
  sparkle: Sparkles,
  cloud: Cloud,
  wifiOff: WifiOff,
  repeat: Repeat,
  flag: Flag,
  bell: Bell,
  link: Link,
  share: Share2,
  users: Users,
  listChecks: ListChecks,
  inbox: Inbox,
  archive: ArchiveRestore,
  fileDown: FileDown,
  fileUp: FileUp,
  clock: Clock,
  history: History,
  skip: SkipForward,
  undo: RotateCcw,
  copy: Copy,
  external: ExternalLink,
  eye: Eye,
  notes: NotebookPen,
  alert: CircleAlert,

  // List icons (names stored in user data)
  'list': List,
  'user': User,
  'briefcase': Briefcase,
  'house': House,
  'heart': Heart,
  'shopping-cart': ShoppingCart,
  'book-open': BookOpen,
  'plane': Plane,
  'star': Star,
  'users': Users,
  'target': Target,
  'dumbbell': Dumbbell,
  'gift': Gift,
  'utensils': Utensils,
  'graduation-cap': GraduationCap,
  'paw-print': PawPrint,
};

/** icon('plus', 18) → SVG markup string for `html:` attributes. */
export function icon(name, size = 18, strokeWidth = 2) {
  // Own-property lookup: names can come from foreign payloads (shared
  // lists, collab manifests), and e.g. 'constructor' would otherwise
  // resolve through the prototype chain and crash createElement.
  const def = Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : ICONS.list;
  const node = createElement(def);
  node.setAttribute('width', size);
  node.setAttribute('height', size);
  node.setAttribute('stroke-width', strokeWidth);
  node.setAttribute('aria-hidden', 'true');
  return node.outerHTML;
}

/** iconEl: same but as a DOM node, for places that append children. */
export function iconEl(name, size = 18, strokeWidth = 2) {
  const tpl = document.createElement('template');
  tpl.innerHTML = icon(name, size, strokeWidth);
  return tpl.content.firstChild;
}
