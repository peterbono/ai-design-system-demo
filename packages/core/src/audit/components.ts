// Component classification: DS package, foreign UI libraries, native elements, re-created DS components.

const FOREIGN_PREFIXES = [
  '@mui/material', '@mui/joy', '@mui/lab', '@mui/x-', '@mui/base', '@material-ui/', 'antd', '@ant-design/pro-', '@chakra-ui/', '@radix-ui/react-',
  '@headlessui/', '@mantine/', 'react-bootstrap', 'reactstrap', '@nextui-org/', '@heroui/', 'react-admin', 'ra-ui-materialui', 'ra-input-rich-text',
  '@fluentui/', 'primereact', 'semantic-ui-react', '@blueprintjs/', '@ariakit/', 'react-aria-components', '@base-ui/react', '@base-ui-components/',
  '@ark-ui/', 'evergreen-ui', 'grommet', 'rsuite', '@adobe/react-spectrum', '@react-spectrum/', 'vaul', 'cmdk', 'sonner', 'react-select', 'react-modal',
];
const ICON_PREFIXES = ['@mui/icons-material', '@material-ui/icons', '@ant-design/icons', '@radix-ui/react-icons', 'lucide-react', 'react-icons', '@heroicons/', '@tabler/icons-react', '@phosphor-icons/', 'react-feather'];
const SHADCN_RE = /(^|\/)components\/ui(\/|$)/;

/** Rendered by UI libraries but not UI: providers, routers, data wrappers. */
const NON_VISUAL = new Set(['Admin', 'AdminContext', 'AdminUI', 'Resource', 'CustomRoutes', 'Route', 'Routes', 'Router', 'BrowserRouter', 'Translate', 'CssBaseline', 'ScopedCssBaseline', 'GlobalStyles', 'StyledEngineProvider', 'Fragment', 'Suspense', 'StrictMode', 'ErrorBoundary', 'WithRecord', 'WithListContext', 'Portal', 'NoSsr', 'ClickAwayListener', 'Fade', 'Grow', 'Slide', 'Zoom', 'Collapse', 'Transition', 'TrapFocus', 'FocusTrap', 'Slot', 'VisuallyHidden']);
export const isNonVisual = (name: string) => NON_VISUAL.has(name) || /(Provider|Context|Consumer|Controller)$/.test(name);

const prefixMatch = (mod: string, p: string) => (p.endsWith('/') || p.endsWith('-') ? mod.startsWith(p) : mod === p || mod.startsWith(`${p}/`));

export type ModuleKind = 'ds' | 'foreign' | 'icons' | 'shadcn' | 'local' | 'other';

/** Package name of an import specifier: @scope/name or name. */
export function packageName(mod: string): string {
  const parts = mod.split('/');
  return mod.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

export function classifyModule(mod: string, dsPackages: string[], extraForeign: string[] = []): ModuleKind {
  if (dsPackages.some((p) => mod === p || mod.startsWith(`${p}/`))) return 'ds';
  if (ICON_PREFIXES.some((p) => prefixMatch(mod, p))) return 'icons';
  if (SHADCN_RE.test(mod) && (mod.startsWith('.') || mod.startsWith('@/') || mod.startsWith('~/') || mod.startsWith('src/') || mod.startsWith('components/'))) return 'shadcn';
  if ([...FOREIGN_PREFIXES, ...extraForeign].some((p) => prefixMatch(mod, p))) return 'foreign';
  if (mod.startsWith('.') || mod.startsWith('@/') || mod.startsWith('~/') || mod.startsWith('src/')) return 'local';
  return 'other';
}

/** Library label used in the report. */
export function libraryLabel(mod: string, kind: ModuleKind): string {
  return kind === 'shadcn' ? 'shadcn/ui (local)' : kind === 'local' ? 'local' : packageName(mod);
}

const EQUIVALENTS: [RegExp, string[]][] = [
  [/^(Icon)?Button$|^LoadingButton$|^SaveButton$|^(Create|Edit|Delete|Show|Export|List|Refresh|Clone)Button$/, ['Button']],
  [/^IconButton$|^Fab$/, ['IconButton', 'Button']],
  [/^(Toggle)?ButtonGroup$|^ToggleButton$/, ['ButtonGroup']],
  [/^Number(Input|Field)$/, ['NumberField', 'Input']],
  [/^(TextField|TextInput|Input|InputBase|OutlinedInput|FilledInput|PasswordInput|SearchInput|DateInput|DateTimeInput)$/, ['Input', 'Field']],
  [/^(Textarea|TextareaAutosize|RichTextInput)$/, ['Textarea']],
  [/^(Autocomplete|AutocompleteInput|AutocompleteArrayInput|Combobox|Command)$/, ['Combobox', 'Select']],
  [/^(Select|NativeSelect|SelectInput|SelectArrayInput)$/, ['Select']],
  [/^(Switch|BooleanInput|NullableBooleanInput)$/, ['Switch']],
  [/^(Checkbox|BooleanField)$/, ['Checkbox']],
  [/^CheckboxGroupInput$/, ['CheckboxGroup']],
  [/^(Radio|RadioGroup|RadioButtonGroupInput)$/, ['RadioGroup']],
  [/^Slider$/, ['Slider']],
  [/^(AlertDialog|Confirm)$/, ['AlertDialog', 'Dialog']],
  [/^(Dialog|Modal|DialogTitle|DialogContent|DialogActions|DialogContentText)$/, ['Dialog']],
  [/^(Drawer|SwipeableDrawer|Sheet)$/, ['Drawer']],
  [/^(Popover|Popper|HoverCard)$/, ['Popover']],
  [/^Tooltip$/, ['Tooltip']],
  [/^(Menu|MenuItem|MenuList|DropdownMenu.*)$/, ['Menu']],
  [/^(Tabs|Tab|TabList|TabPanel|TabbedForm|TabbedShowLayout)$/, ['Tabs']],
  [/^(Card|CardContent|CardHeader|CardActions|CardMedia|Paper)$/, ['Card']],
  [/^Avatar$/, ['Avatar']],
  [/^Badge$/, ['Badge']],
  [/^(Chip|Tag|ChipField)$/, ['Tag', 'Badge']],
  [/^(Alert|AlertTitle|Callout)$/, ['Alert']],
  [/^(Snackbar|Toast|Toaster|Notification)$/, ['Toast']],
  [/^(CircularProgress|Spinner|Loading|LoadingIndicator)$/, ['Spinner', 'Progress']],
  [/^(LinearProgress|Progress)$/, ['Progress']],
  [/^Skeleton$/, ['Skeleton']],
  [/^(Divider|Separator)$/, ['Divider']],
  [/^(Accordion|AccordionSummary|AccordionDetails|Collapsible)$/, ['Accordion']],
  [/^(Table|TableBody|TableCell|TableRow|TableHead|TableContainer|TableFooter|Datagrid|DataGrid|DataTable)$/, ['Table']],
  [/^(Pagination|TablePagination)$/, ['Pagination']],
  [/^(Breadcrumbs|Breadcrumb)$/, ['Breadcrumb']],
  [/^Link$/, ['Link']],
  [/^Stack$/, ['Stack']],
  [/^(Grid|Grid2|ImageList)$/, ['Grid']],
  [/^Container$/, ['Container']],
  [/^(Form|SimpleForm)$/, ['Form']],
  [/^(FormControl|FormLabel|FormHelperText|FormControlLabel|InputLabel|Labeled|Label|FormField|FormItem)$/, ['Field']],
  [/^(Sidebar|SidebarNav|Menu|MenuItemLink|DashboardMenuItem)$/, ['SidebarNav']],
  [/^Kbd$/, ['Kbd']],
];

/** The DS component to use instead of a foreign one, when one fits. */
export function dsEquivalent(name: string, ds: Set<string>): string | undefined {
  const base = name.split('.').pop()!;
  if (ds.has(base)) return base;
  for (const [re, cands] of EQUIVALENTS) if (re.test(base)) return cands.find((c) => ds.has(c));
  return undefined;
}

/** The DS component that replaces a native element. */
export function nativeEquivalent(tag: string, type: string | undefined, ds: Set<string>): string | undefined {
  const pick = (...c: string[]) => c.find((x) => ds.has(x));
  switch (tag) {
    case 'button':
      return pick('Button');
    case 'input':
      if (type === 'checkbox') return pick('Checkbox', 'Switch');
      if (type === 'radio') return pick('RadioGroup');
      if (type === 'range') return pick('Slider');
      if (type === 'number') return pick('NumberField', 'Input');
      return pick('Input', 'Field');
    case 'select':
      return pick('Select', 'Combobox');
    case 'textarea':
      return pick('Textarea');
    case 'dialog':
      return pick('Dialog');
    case 'table':
      return pick('Table');
    default:
      return pick(tag[0]!.toUpperCase() + tag.slice(1));
  }
}
