import {
  createElement,
  Library, Search, Clock, Plus, ChevronDown, ChevronRight, ChevronLeft, ChevronUp,
  ArrowDownWideNarrow, Share2, Cloud, CloudCheck, CloudOff, CloudAlert, RefreshCw,
  Undo2, Redo2, Ellipsis, Lightbulb, ClipboardPaste, Scissors, Copy, Paintbrush,
  Bold, Italic, Underline, Strikethrough, Highlighter, RemoveFormatting,
  List, ListOrdered, ListIndentDecrease, ListIndentIncrease, TextAlignStart,
  TextAlignCenter, TextAlignEnd, Subscript, Superscript, LassoSelect, Eraser, Pen,
  Table, Paperclip, Image, Camera, Link, Sigma, Calendar, CalendarClock, Mic,
  PaintBucket, Trash2, ZoomIn, ZoomOut, Maximize2, Minimize2, BookOpenText, Moon,
  Sun, Monitor, SquareCheckBig, Square, Star, CircleHelp, KeyRound, CircleAlert,
  Flag, Film, Book, Music, FileText, Users, Mail, Phone, PhoneCall, House, Globe,
  Briefcase, User, Notebook, NotebookPen, Folder, FolderPlus, FilePlus2, Lock,
  LockOpen, History, X, Check, Printer, Download, Upload, Keyboard, Info, LogOut,
  Type, Shapes, Minus, MoveRight, ArrowLeftRight, RectangleHorizontal, Circle,
  Triangle, Diamond, MoveVertical, BetweenHorizontalStart, BetweenHorizontalEnd,
  BetweenVerticalStart, BetweenVerticalEnd, Sparkles, Volume2, Pause, Play,
  CircleStop, PanelLeft, Eye, EyeOff, Quote, Code, ALargeSmall, AArrowUp,
  AArrowDown, GripVertical, ArrowUp, ArrowDown, File, FileAudio, Hand, Bookmark,
  ListFilter, ArchiveRestore, ExternalLink, Accessibility, LayoutTemplate,
  SquareDashed, ChevronsDownUp, ChevronsUpDown, Grid3x3, Rows3, Palette, PenLine,
  CornerDownRight, Languages, Pilcrow, MousePointer2, FolderOpen, SquarePlus,
  Video,
} from 'lucide';
import { GLASS_ICONS, hasGlassIcon } from './glass-icons.js';

/*
 * Original glyphs for commands Lucide has no good match for. Drawn on the
 * same 24px grid with 2px strokes so they sit with the Lucide set.
 */
// Lucide's Baseline without its baseline: the ribbon draws the current
// color as the underline instead.
const FontColor = [
  ['path', { d: 'm6 16 6-12 6 12' }],
  ['path', { d: 'M8 12h8' }],
];
const RuleLines = [
  ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
  ['path', { d: 'M3 8h18' }],
  ['path', { d: 'M3 12.5h18' }],
  ['path', { d: 'M3 17h18' }],
  ['path', { d: 'M8 3v18' }],
];
const InsertSpace = [
  ['path', { d: 'M3 4h18' }],
  ['path', { d: 'M3 20h18' }],
  ['path', { d: 'M12 7v10' }],
  ['path', { d: 'm9 10 3-3 3 3' }],
  ['path', { d: 'm9 14 3 3 3-3' }],
];
const NoteContainer = [
  ['rect', { x: '3', y: '5', width: '18', height: '15', rx: '1.5' }],
  ['path', { d: 'M3 8.5h18' }],
  ['path', { d: 'M7 12.5h8' }],
  ['path', { d: 'M7 16h5' }],
];
// Fit to width: arrows spreading out to the window's edges.
const PageWidth = [
  ['path', { d: 'M3 4v16' }],
  ['path', { d: 'M21 4v16' }],
  ['path', { d: 'M7 12h10' }],
  ['path', { d: 'm10 9-3 3 3 3' }],
  ['path', { d: 'm14 9 3 3-3 3' }],
];
// Actual size: "1:1" in a frame.
const Zoom100 = [
  ['rect', { x: '2', y: '4', width: '20', height: '16', rx: '2' }],
  ['path', { d: 'M5.5 9.5 7 8v8' }],
  ['path', { d: 'M15.5 9.5 17 8v8' }],
  ['path', { d: 'M12 10h.01' }],
  ['path', { d: 'M12 14h.01' }],
];
const Subpage = [
  ['path', { d: 'M4 5h10' }],
  ['path', { d: 'M8 12h12' }],
  ['path', { d: 'M8 19h12' }],
  ['path', { d: 'M4 9v6.5a1.5 1.5 0 0 0 1.5 1.5H6' }],
];
const PromotePage = [
  ['path', { d: 'M4 5h16' }],
  ['path', { d: 'M4 12h16' }],
  ['path', { d: 'M10 19h10' }],
  ['path', { d: 'm7 16-3 3 3 3' }],
];
const SectionGroup = [
  ['path', { d: 'M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z' }],
  ['path', { d: 'M8 11h8' }],
  ['path', { d: 'M8 15h5' }],
];
const PageTag = [
  ['path', { d: 'M5 4h9l5 5v11H5z' }],
  ['path', { d: 'M9 13l2 2 4-4' }],
];
const ImmersiveReader = [
  ['path', { d: 'M3 5.5A1.5 1.5 0 0 1 4.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4.5A1.5 1.5 0 0 1 3 16.5z' }],
  ['path', { d: 'M21 5.5A1.5 1.5 0 0 0 19.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h5.5a1.5 1.5 0 0 0 1.5-1.5z' }],
  ['path', { d: 'M6 9h3' }],
  ['path', { d: 'M15 9h3' }],
  ['path', { d: 'M15 13h3' }],
];
// Lucide's Table with its first row filled in.
const HeaderRow = [
  ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
  ['path', { d: 'M3 9V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4z', fill: 'currentColor' }],
  ['path', { d: 'M3 15h18' }],
  ['path', { d: 'M12 9v12' }],
];
const SwitchBackground = [
  ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
  ['path', { d: 'M12 3v18' }],
  ['path', { d: 'M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7z', fill: 'currentColor' }],
];

const ICONS = {
  notebooks: Library, search: Search, recent: Clock, plus: Plus,
  chevDown: ChevronDown, chevRight: ChevronRight, chevLeft: ChevronLeft, chevUp: ChevronUp,
  sort: ArrowDownWideNarrow, share: Share2, cloud: Cloud, cloudCheck: CloudCheck,
  cloudOff: CloudOff, cloudAlert: CloudAlert, sync: RefreshCw, undo: Undo2, redo: Redo2,
  more: Ellipsis, tellMe: Lightbulb, paste: ClipboardPaste, cut: Scissors, copy: Copy,
  formatPainter: Paintbrush, bold: Bold, italic: Italic, underline: Underline,
  strike: Strikethrough, fontColor: FontColor, highlight: Highlighter, clearFormat: RemoveFormatting,
  bullets: List, numbering: ListOrdered, outdent: ListIndentDecrease, indent: ListIndentIncrease,
  alignLeft: TextAlignStart, alignCenter: TextAlignCenter, alignRight: TextAlignEnd,
  subscript: Subscript, superscript: Superscript, lasso: LassoSelect, eraser: Eraser, pen: Pen,
  table: Table, file: Paperclip, picture: Image, screenshot: Camera, link: Link, equation: Sigma,
  date: Calendar, dateTime: CalendarClock, time: Clock, mic: Mic, pageColor: PaintBucket,
  trash: Trash2, zoomIn: ZoomIn, zoomOut: ZoomOut, fullPage: Maximize2, exitFullPage: Minimize2,
  reader: ImmersiveReader, readAloud: BookOpenText, moon: Moon, sun: Sun, monitor: Monitor,
  todoDone: SquareCheckBig, todo: Square, star: Star, question: CircleHelp, key: KeyRound,
  critical: CircleAlert, flag: Flag, film: Film, book: Book, music: Music, fileText: FileText,
  users: Users, mail: Mail, phone: Phone, phoneCall: PhoneCall, house: House, globe: Globe,
  briefcase: Briefcase, user: User, notebook: Notebook, notebookPen: NotebookPen, folder: Folder,
  folderPlus: FolderPlus, folderOpen: FolderOpen, newPage: FilePlus2, lock: Lock, unlock: LockOpen,
  history: History, x: X, check: Check, print: Printer, download: Download, upload: Upload,
  keyboard: Keyboard, info: Info, logout: LogOut, type: Type, shapes: Shapes, line: Minus,
  arrow: MoveRight, doubleArrow: ArrowLeftRight, rect: RectangleHorizontal, ellipse: Circle,
  triangle: Triangle, diamond: Diamond, moveVertical: MoveVertical,
  rowAbove: BetweenHorizontalStart, rowBelow: BetweenHorizontalEnd,
  colLeft: BetweenVerticalStart, colRight: BetweenVerticalEnd, sparkles: Sparkles,
  speaker: Volume2, pause: Pause, play: Play, stop: CircleStop, panel: PanelLeft, eye: Eye,
  eyeOff: EyeOff, quote: Quote, code: Code, fontSize: ALargeSmall, grow: AArrowUp, shrink: AArrowDown,
  grip: GripVertical, up: ArrowUp, down: ArrowDown, fileGeneric: File, audio: FileAudio, hand: Hand,
  bookmark: Bookmark, filter: ListFilter, restore: ArchiveRestore, external: ExternalLink,
  accessibility: Accessibility, template: LayoutTemplate, dashed: SquareDashed,
  collapse: ChevronsDownUp, expand: ChevronsUpDown, grid: Grid3x3, rows: Rows3, palette: Palette,
  penLine: PenLine, subpageArrow: CornerDownRight, translate: Languages, pilcrow: Pilcrow,
  pointer: MousePointer2, squarePlus: SquarePlus, video: Video,
  ruleLines: RuleLines, insertSpace: InsertSpace, container: NoteContainer, pageWidth: PageWidth,
  zoom100: Zoom100, subpage: Subpage, promote: PromotePage, sectionGroup: SectionGroup,
  findTags: PageTag, switchBackground: SwitchBackground, headerRow: HeaderRow,
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Returns an inline SVG element for the named icon, hidden from assistive tech.
 *
 * Commands that have a drawn glass icon (glass-icons.js: paste, bold, tags, pens and the rest of
 * the ribbon's commands) get it, in its own colours; interface glyphs (chevrons, close, checks,
 * arrows, grips, navigation and status) stay Lucide line icons in the current text colour. Pass
 * `{ plain: true }` where a command's name is used as a plain glyph (a status mark, a navigation
 * row, page content) to keep the Lucide one. Both carry the `icon` class; glass icons also `ico`.
 */
export function icon(name, size = 16, strokeWidth = 1.75, { plain = false } = {}) {
  if (!plain && hasGlassIcon(name)) return glassIcon(name, size);
  const node = ICONS[name];
  if (!node) throw new Error(`Unknown icon: ${name}`);
  const svg = createElement(node);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('stroke-width', strokeWidth ?? 1.75);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  return svg;
}

function glassIcon(name, size) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon ico');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = GLASS_ICONS[name];
  return svg;
}

export function hasIcon(name) {
  return Boolean(ICONS[name]) || hasGlassIcon(name);
}

/**
 * SVG markup for an icon, for CSS backgrounds and masks or HTML strings. Always the Lucide line
 * icon: an image outside the document cannot reach the glass icons' gradients and classes.
 */
export function iconMarkup(name, size = 16, color = 'currentColor', strokeWidth = 2) {
  const svg = icon(name, size, strokeWidth, { plain: true });
  svg.setAttribute('stroke', color);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return svg.outerHTML;
}
