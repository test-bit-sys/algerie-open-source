import {
  createElement,
  ArrowLeft, Ban, Bell, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight,
  CircleAlert, CircleCheck, CircleCheckBig, CircleUserRound, CircleX, ClipboardCopy, Clock,
  Cloud, CloudUpload, Copy, CopyPlus, Download, Ellipsis, Eraser, ExternalLink, Eye, FileCheck,
  FileDown, FilePen, FilePlus, FileText, History, Hourglass, House, Images, Info,
  LayoutTemplate, Link, ListOrdered, LoaderCircle, Lock, LockOpen, LogOut, Mail, MailCheck,
  Monitor, Moon, PenLine, Pencil, Plus, RotateCcw, Search, Send, Settings, ShieldCheck,
  Signature, Sparkles, SquareCheck, SquarePen, Stamp, Sun, TextCursorInput, Trash2,
  TriangleAlert, Type, Undo2, Upload, UserPen, UserPlus, Users, WifiOff, X,
} from 'lucide';

const ICONS = {
  arrowLeft: ArrowLeft,
  ban: Ban,
  bell: Bell,
  calendar: CalendarDays,
  check: Check,
  chevD: ChevronDown,
  chevL: ChevronLeft,
  chevR: ChevronRight,
  circleAlert: CircleAlert,
  circleCheck: CircleCheck,
  circleCheckBig: CircleCheckBig,
  circleX: CircleX,
  clipboard: ClipboardCopy,
  clock: Clock,
  cloud: Cloud,
  cloudUpload: CloudUpload,
  copy: Copy,
  copyPlus: CopyPlus,
  download: Download,
  eraser: Eraser,
  externalLink: ExternalLink,
  eye: Eye,
  fileCheck: FileCheck,
  fileDown: FileDown,
  filePen: FilePen,
  filePlus: FilePlus,
  fileText: FileText,
  history: History,
  home: House,
  hourglass: Hourglass,
  images: Images,
  listOrdered: ListOrdered,
  info: Info,
  link: Link,
  lock: Lock,
  unlock: LockOpen,
  logout: LogOut,
  mail: Mail,
  mailCheck: MailCheck,
  monitor: Monitor,
  pencil: Pencil,
  template: LayoutTemplate,
  moon: Moon,
  more: Ellipsis,
  penLine: PenLine,
  plus: Plus,
  rotate: RotateCcw,
  search: Search,
  send: Send,
  gear: Settings,
  shield: ShieldCheck,
  signature: Signature,
  sparkle: Sparkles,
  spinner: LoaderCircle,
  squareCheck: SquareCheck,
  squarePen: SquarePen,
  stamp: Stamp,
  sun: Sun,
  textCursor: TextCursorInput,
  trash: Trash2,
  triangleAlert: TriangleAlert,
  type: Type,
  undo: Undo2,
  upload: Upload,
  user: CircleUserRound,
  userPen: UserPen,
  userPlus: UserPlus,
  users: Users,
  wifiOff: WifiOff,
  x: X,
};

/** Render a Lucide icon as an HTML string. Unknown names fall back to a file. */
export function icon(name, size = 22, strokeWidth = 1.8) {
  const node = ICONS[name] || FileText;
  const svg = createElement(node);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('aria-hidden', 'true');
  return svg.outerHTML;
}

/** The app icon (public/app-icon.png) as an HTML string. Decorative like the glyphs above. */
export function appIcon(size = 32) {
  return `<img class="app-icon" src="./app-icon.png" alt="" width="${size}" height="${size}" decoding="async" draggable="false" />`;
}

/** Icon names for each field type, shared by the editor and signing UIs. */
export const FIELD_ICONS = {
  signature: 'signature',
  initials: 'stamp',
  date: 'calendar',
  text: 'textCursor',
  checkbox: 'squareCheck',
};
