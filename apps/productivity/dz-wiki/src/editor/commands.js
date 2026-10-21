/** Block types offered in the "/" menu and in "Turn into". */
export const INSERTABLE = [
  { type: 'paragraph', label: 'Text', icon: 'pilcrow', keywords: 'text paragraph plain', description: 'Plain text' },
  { type: 'h1', label: 'Heading 1', icon: 'h1', keywords: 'heading title h1 big', description: 'Big section heading', shortcut: '#' },
  { type: 'h2', label: 'Heading 2', icon: 'h2', keywords: 'heading subtitle h2', description: 'Medium section heading', shortcut: '##' },
  { type: 'h3', label: 'Heading 3', icon: 'h3', keywords: 'heading h3 small', description: 'Small section heading', shortcut: '###' },
  { type: 'bulleted', label: 'Bulleted list', icon: 'list', keywords: 'bullet unordered list ul', description: 'A simple list', shortcut: '-' },
  { type: 'numbered', label: 'Numbered list', icon: 'listOrdered', keywords: 'numbered ordered list ol', description: 'A list with numbers', shortcut: '1.' },
  { type: 'todo', label: 'To-do list', icon: 'squareCheck', keywords: 'todo task check checkbox', description: 'Track tasks', shortcut: '[]' },
  { type: 'toggle', label: 'Toggle list', icon: 'chevronRight', keywords: 'toggle collapse expand details', description: 'Hide content inside', shortcut: '>' },
  { type: 'quote', label: 'Quote', icon: 'quote', keywords: 'quote blockquote citation', description: 'Set text apart', shortcut: '"' },
  { type: 'callout', label: 'Callout', icon: 'lightbulb', keywords: 'callout note tip info warning', description: 'Make text stand out' },
  { type: 'code', label: 'Code', icon: 'codeXml', keywords: 'code snippet pre monospace', description: 'A code snippet', shortcut: '```' },
  { type: 'divider', label: 'Divider', icon: 'minus', keywords: 'divider line separator hr', description: 'Separate sections', shortcut: '---' },
  { type: 'table', label: 'Table', icon: 'table', keywords: 'table grid rows columns', description: 'A simple table' },
  { type: 'image', label: 'Image', icon: 'image', keywords: 'image picture photo upload', description: 'Upload or link an image' },
  { type: 'bookmark', label: 'Web bookmark', icon: 'bookmark', keywords: 'bookmark link url web embed', description: 'Save a link' },
];

export const PAGE_COMMANDS = [
  { action: 'page', label: 'Page', icon: 'fileText', keywords: 'page subpage new child', description: 'A page inside this one' },
  { action: 'database', label: 'Database', icon: 'database', keywords: 'database table board kanban collection', description: 'A table of pages' },
  { action: 'mention', label: 'Link to page', icon: 'arrowUpRight', keywords: 'link mention page reference', description: 'Link to another page' },
];

export const TEXT_TYPES = new Set(['paragraph', 'h1', 'h2', 'h3', 'bulleted', 'numbered', 'todo', 'toggle', 'quote', 'callout', 'code']);

export const PLACEHOLDERS = {
  paragraph: "Write something, or type '/' for commands",
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  bulleted: 'List',
  numbered: 'List',
  todo: 'To-do',
  toggle: 'Toggle',
  quote: 'Quote',
  callout: 'Write something',
  code: 'Code',
};

export const CODE_LANGUAGES = ['Plain text', 'Bash', 'C', 'C++', 'C#', 'CSS', 'Go', 'HTML', 'Java', 'JavaScript', 'JSON', 'Kotlin', 'Markdown', 'PHP', 'Python', 'Ruby', 'Rust', 'SQL', 'Swift', 'TypeScript', 'YAML'];

/** Markdown typed at the start of a paragraph, then a space. */
export const SHORTCUTS = [
  [/^#$/, { type: 'h1' }],
  [/^##$/, { type: 'h2' }],
  [/^###$/, { type: 'h3' }],
  [/^[-*+]$/, { type: 'bulleted' }],
  [/^1[.)]$/, { type: 'numbered' }],
  [/^\[ ?\]$/, { type: 'todo', checked: false }],
  [/^\[x\]$/i, { type: 'todo', checked: true }],
  [/^>$/, { type: 'toggle' }],
  [/^["“]$/, { type: 'quote' }],
];
