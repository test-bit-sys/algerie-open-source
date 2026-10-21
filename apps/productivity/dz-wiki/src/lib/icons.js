/**
 * Icons are Lucide (ISC license), imported one by one so only what is used
 * ships. icon('name') returns an inline SVG hidden from screen readers;
 * buttons carry their own accessible names.
 */
import * as L from 'lucide';

const UI = {
  plus: L.Plus, search: L.Search, home: L.House, clock: L.Clock, star: L.Star, starOff: L.StarOff, trash: L.Trash2,
  settings: L.Settings, share: L.Share2, users: L.Users, user: L.User, chevronRight: L.ChevronRight, chevronDown: L.ChevronDown,
  chevronLeft: L.ChevronLeft, chevronUp: L.ChevronUp, chevronsLeft: L.ChevronsLeft, more: L.Ellipsis, moreVertical: L.EllipsisVertical,
  grip: L.GripVertical, copy: L.Copy, link: L.Link, link2: L.Link2, arrowUpRight: L.ArrowUpRight, externalLink: L.ExternalLink,
  pencil: L.Pencil, h1: L.Heading1, h2: L.Heading2, h3: L.Heading3, type: L.Type, text: L.Text, pilcrow: L.Pilcrow, list: L.List,
  listOrdered: L.ListOrdered, listTodo: L.ListTodo, squareCheck: L.SquareCheckBig, square: L.Square, quote: L.Quote, textQuote: L.TextQuote,
  minus: L.Minus, code: L.Code, codeXml: L.CodeXml, image: L.Image, imagePlus: L.ImagePlus, table: L.Table, table2: L.Table2, database: L.Database,
  kanban: L.SquareKanban, grid: L.LayoutGrid, layoutList: L.LayoutList, calendar: L.Calendar, calendarDays: L.CalendarDays, hash: L.Hash,
  tags: L.Tags, circleChevronDown: L.CircleChevronDown, loader: L.Loader, atSign: L.AtSign, phone: L.Phone, bold: L.Bold, italic: L.Italic,
  underline: L.Underline, strike: L.Strikethrough, highlighter: L.Highlighter, palette: L.Palette, baseline: L.Baseline, x: L.X, check: L.Check,
  sun: L.Sun, moon: L.Moon, monitor: L.Monitor, logOut: L.LogOut, undo: L.Undo2, redo: L.Redo2, download: L.Download, upload: L.Upload,
  history: L.History, rotateCcw: L.RotateCcw, cloud: L.Cloud, cloudOff: L.CloudOff, cloudCheck: L.CloudCheck, refresh: L.RefreshCw,
  lock: L.Lock, lockOpen: L.LockOpen, globe: L.Globe, eye: L.Eye, panelLeft: L.PanelLeft, panelLeftClose: L.PanelLeftClose, menu: L.Menu,
  smile: L.Smile, shapes: L.Shapes, info: L.Info, alert: L.CircleAlert, triangleAlert: L.TriangleAlert, lightbulb: L.Lightbulb,
  bookmark: L.Bookmark, filter: L.ListFilter, arrowUpDown: L.ArrowUpDown, arrowUp: L.ArrowUp, arrowDown: L.ArrowDown, arrowLeft: L.ArrowLeft,
  arrowRight: L.ArrowRight, maximize: L.Maximize2, minimize: L.Minimize2, moveHorizontal: L.MoveHorizontal, filePlus: L.FilePlus,
  file: L.File, fileText: L.FileText, folderInput: L.FolderInput, cornerUpLeft: L.CornerUpLeft, cornerDownRight: L.CornerDownRight,
  keyboard: L.Keyboard, help: L.CircleHelp, sparkles: L.Sparkles, inbox: L.Inbox, messageSquare: L.MessageSquareText, messageCircle: L.MessageCircle,
  send: L.SendHorizontal, eyeOff: L.EyeOff, columns: L.Columns3, rows: L.Rows3, toggleRight: L.ToggleRight, indent: L.ListIndentIncrease,
  outdent: L.ListIndentDecrease, wrapText: L.WrapText, alignLeft: L.TextAlignStart, gripHorizontal: L.GripHorizontal, layoutTemplate: L.LayoutTemplate,
  printer: L.Printer, fileDown: L.FileDown, fileUp: L.FileUp, circle: L.Circle, circleCheck: L.CircleCheck, userPlus: L.UserPlus, userMinus: L.UserMinus,
  logIn: L.LogIn, ban: L.Ban, keyboardOff: L.KeyboardOff, caseSensitive: L.CaseSensitive, fullWidth: L.MoveHorizontal, smallText: L.ALargeSmall,
};

/** Icons offered for pages, in picker order. */
export const PAGE_ICONS = [
  'fileText', 'notebookPen', 'bookOpen', 'book', 'library', 'newspaper', 'bookmark', 'lightbulb', 'sparkles', 'star', 'heart', 'flag',
  'target', 'rocket', 'zap', 'flame', 'trophy', 'medal', 'crown', 'gem', 'gift', 'puzzle', 'compass', 'map', 'mapPin', 'globe',
  'house', 'building', 'briefcase', 'wallet', 'piggyBank', 'chartBar', 'chartLine', 'chartPie', 'shoppingCart', 'receipt', 'calculator',
  'calendar', 'calendarDays', 'calendarCheck', 'clock', 'alarmClock', 'hourglass', 'timer', 'listTodo', 'clipboardList', 'clipboardCheck',
  'kanban', 'table', 'database', 'layers', 'box', 'package', 'archive', 'inbox', 'folder', 'folderOpen', 'paperclip', 'pin', 'tag',
  'users', 'user', 'userRound', 'contact', 'messageCircle', 'mail', 'phone', 'megaphone', 'bell', 'send',
  'code', 'terminal', 'bug', 'cpu', 'server', 'laptop', 'smartphone', 'wifi', 'gitBranch', 'braces', 'binary', 'bot', 'wrench', 'hammer', 'cog', 'shield', 'key', 'lock',
  'pencil', 'pen', 'brush', 'palette', 'camera', 'image', 'film', 'music', 'mic', 'headphones', 'gamepad', 'tv',
  'leaf', 'sprout', 'flower', 'trees', 'mountain', 'sun', 'moon', 'cloud', 'umbrella', 'snowflake', 'droplet', 'waves',
  'plane', 'car', 'bike', 'train', 'ship', 'tent', 'coffee', 'pizza', 'utensils', 'apple', 'cake', 'wine',
  'dumbbell', 'heartPulse', 'stethoscope', 'pill', 'brain', 'graduationCap', 'school', 'flask', 'atom', 'telescope', 'microscope', 'dna',
  'cat', 'dog', 'bird', 'fish', 'pawPrint', 'smile', 'laugh', 'ghost', 'circle', 'square', 'triangle', 'hexagon',
];

const PAGE = {
  fileText: L.FileText, notebookPen: L.NotebookPen, bookOpen: L.BookOpen, book: L.Book, library: L.Library, newspaper: L.Newspaper,
  bookmark: L.Bookmark, lightbulb: L.Lightbulb, sparkles: L.Sparkles, star: L.Star, heart: L.Heart, flag: L.Flag, target: L.Target,
  rocket: L.Rocket, zap: L.Zap, flame: L.Flame, trophy: L.Trophy, medal: L.Medal, crown: L.Crown, gem: L.Gem, gift: L.Gift, puzzle: L.Puzzle,
  compass: L.Compass, map: L.Map, mapPin: L.MapPin, globe: L.Globe, house: L.House, building: L.Building2, briefcase: L.Briefcase,
  wallet: L.Wallet, piggyBank: L.PiggyBank, chartBar: L.ChartColumn, chartLine: L.ChartLine, chartPie: L.ChartPie, shoppingCart: L.ShoppingCart,
  receipt: L.Receipt, calculator: L.Calculator, calendar: L.Calendar, calendarDays: L.CalendarDays, calendarCheck: L.CalendarCheck,
  clock: L.Clock, alarmClock: L.AlarmClock, hourglass: L.Hourglass, timer: L.Timer, listTodo: L.ListTodo, clipboardList: L.ClipboardList,
  clipboardCheck: L.ClipboardCheck, kanban: L.SquareKanban, table: L.Table, database: L.Database, layers: L.Layers, box: L.Box,
  package: L.Package, archive: L.Archive, inbox: L.Inbox, folder: L.Folder, folderOpen: L.FolderOpen, paperclip: L.Paperclip, pin: L.Pin,
  tag: L.Tag, users: L.Users, user: L.User, userRound: L.CircleUserRound, contact: L.Contact, messageCircle: L.MessageCircle, mail: L.Mail,
  phone: L.Phone, megaphone: L.Megaphone, bell: L.Bell, send: L.Send, code: L.Code, terminal: L.SquareTerminal, bug: L.Bug, cpu: L.Cpu,
  server: L.Server, laptop: L.Laptop, smartphone: L.Smartphone, wifi: L.Wifi, gitBranch: L.GitBranch, braces: L.Braces, binary: L.Binary,
  bot: L.Bot, wrench: L.Wrench, hammer: L.Hammer, cog: L.Cog, shield: L.Shield, key: L.KeyRound, lock: L.Lock, pencil: L.Pencil,
  pen: L.PenTool, brush: L.Brush, palette: L.Palette, camera: L.Camera, image: L.Image, film: L.Film, music: L.Music, mic: L.Mic,
  headphones: L.Headphones, gamepad: L.Gamepad2, tv: L.Tv, leaf: L.Leaf, sprout: L.Sprout, flower: L.Flower2, trees: L.Trees,
  mountain: L.Mountain, sun: L.Sun, moon: L.Moon, cloud: L.Cloud, umbrella: L.Umbrella, snowflake: L.Snowflake, droplet: L.Droplet,
  waves: L.Waves, plane: L.Plane, car: L.Car, bike: L.Bike, train: L.TrainFront, ship: L.Ship, tent: L.Tent, coffee: L.Coffee,
  pizza: L.Pizza, utensils: L.Utensils, apple: L.Apple, cake: L.CakeSlice, wine: L.Wine, dumbbell: L.Dumbbell, heartPulse: L.HeartPulse,
  stethoscope: L.Stethoscope, pill: L.Pill, brain: L.Brain, graduationCap: L.GraduationCap, school: L.School, flask: L.FlaskConical,
  atom: L.Atom, telescope: L.Telescope, microscope: L.Microscope, dna: L.Dna, cat: L.Cat, dog: L.Dog, bird: L.Bird, fish: L.Fish,
  pawPrint: L.PawPrint, smile: L.Smile, laugh: L.Laugh, ghost: L.Ghost, circle: L.Circle, square: L.Square, triangle: L.Triangle, hexagon: L.Hexagon,
};

const ALL = { ...PAGE, ...UI };

/** Words people might search for to find an icon. */
export function iconLabel(name) {
  return name.replace(/([A-Z])/g, ' $1').toLowerCase();
}

export function hasIcon(name) {
  // Own properties only: names like "constructor" come from shared documents.
  return typeof name === 'string' && Object.hasOwn(ALL, name);
}

export function icon(name, size = 16, { stroke = 1.75, cls = '' } = {}) {
  const node = hasIcon(name) ? ALL[name] : UI.fileText;
  const svg = L.createElement(node);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('stroke-width', stroke);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  if (cls) svg.classList.add(...cls.split(' '));
  return svg;
}

/** A page's icon (or the default document icon). */
export function pageIcon(page, size = 16) {
  const wrap = document.createElement('span');
  wrap.className = 'page-icon';
  if (page?.icon?.color) wrap.dataset.color = page.icon.color;
  const name = page?.icon?.name || (page?.kind === 'database' ? 'database' : 'fileText');
  wrap.append(icon(hasIcon(name) ? name : 'fileText', size));
  if (!page?.icon) wrap.classList.add('default');
  return wrap;
}
