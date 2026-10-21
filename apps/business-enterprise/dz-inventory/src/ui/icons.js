import {
  createElement,
  LayoutDashboard, Package, Truck, MapPin, Settings, Plus, Minus, Search, X,
  Pencil, Trash2, Sun, Moon, Monitor, FileDown, FileUp, LogOut, Check,
  Sparkles, Cloud, WifiOff, TriangleAlert, CircleAlert, ChevronRight, ChevronLeft,
  ArrowUpDown, ArrowUp, ArrowDown, PackagePlus, PackageMinus,
  ClipboardList, History, Boxes, Phone, Mail, Globe,
  BellRing, Warehouse, Info, RotateCcw, Download, Upload, ShieldCheck,
  Ellipsis, Archive, ArchiveRestore, Copy, ArrowLeftRight, ScanBarcode, Camera,
  ListChecks, SquarePen, ShoppingCart, Send, ChartLine, Printer, Percent,
} from 'lucide';

const ICONS = {
  dashboard: LayoutDashboard,
  package: Package,
  truck: Truck,
  pin: MapPin,
  gear: Settings,
  plus: Plus,
  minus: Minus,
  search: Search,
  x: X,
  pencil: Pencil,
  trash: Trash2,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  fileDown: FileDown,
  fileUp: FileUp,
  logout: LogOut,
  check: Check,
  sparkle: Sparkles,
  cloud: Cloud,
  wifiOff: WifiOff,
  alert: TriangleAlert,
  circleAlert: CircleAlert,
  chevR: ChevronRight,
  chevL: ChevronLeft,
  sort: ArrowUpDown,
  sortAsc: ArrowUp,
  sortDesc: ArrowDown,
  packagePlus: PackagePlus,
  packageMinus: PackageMinus,
  clipboard: ClipboardList,
  history: History,
  boxes: Boxes,
  phone: Phone,
  mail: Mail,
  globe: Globe,
  bell: BellRing,
  warehouse: Warehouse,
  info: Info,
  rotateCcw: RotateCcw,
  download: Download,
  upload: Upload,
  shield: ShieldCheck,
  more: Ellipsis,
  archive: Archive,
  archiveRestore: ArchiveRestore,
  copy: Copy,
  move: ArrowLeftRight,
  barcode: ScanBarcode,
  camera: Camera,
  listChecks: ListChecks,
  edit: SquarePen,
  cart: ShoppingCart,
  send: Send,
  chart: ChartLine,
  printer: Printer,
  percent: Percent,
};

/**
 * Rendered markup by name+size+weight. The same icon at the same size is
 * the same string every time, but reaching it means building an SVG tree
 * and serializing it — and a list of a few thousand products asks for two
 * per row on every keystroke of its search box, which is most of a second
 * spent re-deriving a couple of dozen distinct answers. Every call site
 * passes literals, so the set of keys is bounded by the source.
 */
const RENDERED = new Map();

/** Render a Lucide icon as an HTML string. Unknown names fall back to a box. */
export function icon(name, size = 22, strokeWidth = 1.8) {
  const key = `${name}|${size}|${strokeWidth}`;
  const hit = RENDERED.get(key);
  if (hit !== undefined) return hit;
  const node = ICONS[name] || Package;
  const svg = createElement(node);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('aria-hidden', 'true');
  // Safe to share: callers only ever hand this to innerHTML, which parses
  // its own nodes from it.
  const markup = svg.outerHTML;
  RENDERED.set(key, markup);
  return markup;
}
