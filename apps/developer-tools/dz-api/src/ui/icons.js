/**
 * Icons are Lucide (ISC license), imported by name so only what is used
 * ships. icon('name') returns an inline SVG hidden from screen readers;
 * controls carry their own accessible names.
 */
import {
  Plus, Search, X, Check, ChevronRight, ChevronDown, ChevronLeft, ChevronUp, Ellipsis, EllipsisVertical, Folder, FolderOpen,
  FolderPlus, FilePlus, Layers, History, Settings, Sun, Moon, Monitor, LogOut, LogIn, Trash2, Copy, Pencil, Download, Upload,
  Import, Send, SendHorizontal, Save, Code, CodeXml, Braces, Cookie, Terminal, PanelLeft, PanelLeftClose, PanelBottom, PanelRight,
  PanelRightClose, Eye, EyeOff, Lock, LockOpen, Globe, Cloud, CloudOff, CloudCheck, RefreshCw, CircleAlert, TriangleAlert, Info,
  CircleCheck, CircleX, Circle, CircleSlash, Play, Square, Clock, Timer, Keyboard, CircleHelp, ExternalLink, Link, FileText, Filter,
  WrapText, ArrowDownUp, ArrowUpRight, Rows3, Columns2, GripVertical, Zap, Variable, Box, Menu, ListChecks, FileJson, Hash, Rocket,
  Maximize2, Minimize2, Star, Database, Server, ShieldCheck, KeyRound, ListTree, Paperclip, CornerDownLeft, Sparkles, MoveVertical,
  Plug, Unplug, ArrowUp, ArrowDown, ArrowDownToLine, Users, UserPlus, Share2, DoorOpen,
} from 'lucide';

const UI = {
  plus: Plus, search: Search, x: X, check: Check, chevronRight: ChevronRight, chevronDown: ChevronDown, chevronLeft: ChevronLeft,
  chevronUp: ChevronUp, more: Ellipsis, moreVertical: EllipsisVertical, folder: Folder, folderOpen: FolderOpen, folderPlus: FolderPlus,
  filePlus: FilePlus, collections: Layers, history: History, settings: Settings, sun: Sun, moon: Moon, monitor: Monitor, logOut: LogOut,
  logIn: LogIn, trash: Trash2, copy: Copy, pencil: Pencil, download: Download, upload: Upload, import: Import, send: Send,
  sendH: SendHorizontal, save: Save, code: Code, codeXml: CodeXml, braces: Braces, cookie: Cookie, terminal: Terminal,
  panelLeft: PanelLeft, panelLeftClose: PanelLeftClose, panelBottom: PanelBottom, panelRight: PanelRight, panelRightClose: PanelRightClose,
  eye: Eye, eyeOff: EyeOff, lock: Lock, lockOpen: LockOpen, globe: Globe, cloud: Cloud, cloudOff: CloudOff, cloudCheck: CloudCheck,
  refresh: RefreshCw, alert: CircleAlert, warning: TriangleAlert, info: Info, circleCheck: CircleCheck, circleX: CircleX, circle: Circle,
  circleSlash: CircleSlash, play: Play, stop: Square, clock: Clock, timer: Timer, keyboard: Keyboard, help: CircleHelp,
  externalLink: ExternalLink, link: Link, fileText: FileText, filter: Filter, wrap: WrapText, sort: ArrowDownUp, arrowUpRight: ArrowUpRight,
  rows: Rows3, columns: Columns2, grip: GripVertical, zap: Zap, variable: Variable, box: Box, menu: Menu, listChecks: ListChecks,
  fileJson: FileJson, hash: Hash, rocket: Rocket, maximize: Maximize2, minimize: Minimize2, star: Star, database: Database, server: Server,
  shield: ShieldCheck, key: KeyRound, tree: ListTree, paperclip: Paperclip, enter: CornerDownLeft, sparkles: Sparkles, moveV: MoveVertical, users: Users, userPlus: UserPlus, share: Share2, leave: DoorOpen,
  plug: Plug, unplug: Unplug, arrowUp: ArrowUp, arrowDown: ArrowDown, toBottom: ArrowDownToLine,
};

const NS = 'http://www.w3.org/2000/svg';

function build(nodes, size, strokeWidth) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attrs] of nodes) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

export function icon(name, size = 16, strokeWidth = 2) {
  if (name === 'github') return githubMark(size);
  const nodes = UI[name];
  if (!nodes) throw new Error(`Unknown icon: ${name}`);
  return build(nodes, size, strokeWidth);
}

/** The GitHub mark, used only to link to the project's repository. */
function githubMark(size) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute(
    'd',
    'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z',
  );
  svg.append(path);
  return svg;
}
