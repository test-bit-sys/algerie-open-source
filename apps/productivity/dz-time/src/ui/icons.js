import {
  createElement,
  Timer, CalendarDays, ChartColumn, FolderKanban, Settings,
  Play, Square, Plus, X, Check, ChevronLeft, ChevronRight, ChevronDown,
  Pencil, Trash2, Sun, Moon, Monitor, Download, LogOut, Sparkles,
  WifiOff, Cloud, Banknote, Archive, ArchiveRestore,
  CircleDollarSign, Users, FileDown, RotateCcw, Tag,
  CheckCheck, Printer, TriangleAlert, Search, FileUp, Copy, ListChecks,
  ReceiptText, Link2,
} from 'lucide';

const ICONS = {
  timer: Timer,
  calendar: CalendarDays,
  chart: ChartColumn,
  folders: FolderKanban,
  gear: Settings,
  play: Play,
  stop: Square,
  plus: Plus,
  x: X,
  check: Check,
  chevL: ChevronLeft,
  chevR: ChevronRight,
  chevD: ChevronDown,
  pencil: Pencil,
  trash: Trash2,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  download: Download,
  logout: LogOut,
  sparkle: Sparkles,
  wifiOff: WifiOff,
  cloud: Cloud,
  banknote: Banknote,
  archive: Archive,
  unarchive: ArchiveRestore,
  dollar: CircleDollarSign,
  users: Users,
  fileDown: FileDown,
  reset: RotateCcw,
  tag: Tag,
  checkCheck: CheckCheck,
  printer: Printer,
  alert: TriangleAlert,
  search: Search,
  fileUp: FileUp,
  copy: Copy,
  listChecks: ListChecks,
  receipt: ReceiptText,
  link: Link2,
};

/** Render a Lucide icon as an HTML string. Unknown names fall back to a tag. */
export function icon(name, size = 22, strokeWidth = 1.8) {
  const svg = createElement(ICONS[name] || Tag);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('aria-hidden', 'true');
  return svg.outerHTML;
}
