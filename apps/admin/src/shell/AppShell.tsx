import { useEffect, useState, type ReactNode } from 'react';
import { LinkBase, useGetList, useLocation, useTranslate } from 'ra-core';
import {
  AlertDialog,
  AlertDialogContent,
  Avatar,
  Badge,
  Drawer,
  DrawerContent,
  IconButton,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Select,
  SidebarNav,
  SidebarNavItem,
  SidebarNavSection,
  Tooltip,
  useToast,
} from '@bridge-ds/react';
import {
  ChartPie,
  FileText,
  FolderTree,
  Image,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  MessageSquareText,
  Moon,
  RotateCcw,
  Rows3,
  Rows4,
  ShoppingBag,
  Sun,
  Users,
} from 'lucide-react';
import { Notifier } from '../ra-bridge';
import { usePreferences } from '../preferences';
import { TENANT_LIST, isTenantId } from '../tenants';
import { GlobalSearch } from './GlobalSearch';
import { resetTenantData } from '../data/dataProvider';
import styles from './AppShell.module.css';

/** ra-core layout: Bridge SidebarNav on the left, a header with search and display settings, content. */
export function AppShell({ children }: { children?: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const translate = useTranslate();
  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skip}>
        {translate('shell.skip', { _: 'Skip to content' })}
      </a>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarInner}>
          <TenantBlock />
          <Navigation />
          <DemoNote />
        </div>
      </aside>
      <div className={styles.column}>
        <Header onOpenNav={() => setNavOpen(true)} />
        <main id="main" className={styles.content} tabIndex={-1}>
          {children}
        </main>
      </div>
      <Drawer open={navOpen} onOpenChange={setNavOpen} side="start">
        <DrawerContent title={<TenantBlock compact />} size="sm" closeLabel={translate('shell.close_menu', { _: 'Close menu' })}>
          <div className={styles.drawerTenant}>
            <TenantSelect />
          </div>
          <Navigation />
          <DemoNote />
        </DrawerContent>
      </Drawer>
      <Notifier />
    </div>
  );
}

function TenantBlock({ compact = false }: { compact?: boolean }) {
  const { tenant } = usePreferences();
  const translate = useTranslate();
  return (
    <div className={compact ? styles.tenantCompact : styles.tenant}>
      <span className={styles.mark} aria-hidden="true">
        {tenant.mark}
      </span>
      <span className={styles.tenantText}>
        <span className={styles.tenantName}>{tenant.name}</span>
        {!compact && <span className={styles.tenantTagline}>{translate(`shell.tagline_${tenant.id}`, { _: tenant.tagline })}</span>}
      </span>
    </div>
  );
}

function Navigation() {
  const translate = useTranslate();
  const { pathname } = useLocation();
  const { total: pendingOrders } = useGetList('orders', { filter: { status: 'ordered' }, pagination: { page: 1, perPage: 1 } });
  const { total: pendingReviews } = useGetList('reviews', { filter: { status: 'pending' }, pagination: { page: 1, perPage: 1 } });
  const is = (path: string) => (path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(path + '/'));
  const item = (to: string, icon: typeof ShoppingBag, label: string, count?: number) => (
    <SidebarNavItem key={to} icon={icon} active={is(to)} count={count || undefined} render={<LinkBase to={to} />}>
      {label}
    </SidebarNavItem>
  );
  return (
    <SidebarNav aria-label={translate('shell.nav', { _: 'Main' })} className={styles.nav}>
      <SidebarNavSection>{item('/', LayoutDashboard, translate('nav.dashboard'))}</SidebarNavSection>
      <SidebarNavSection title={translate('nav.sales')}>
        {item('/orders', ShoppingBag, translate('nav.orders'), pendingOrders)}
        {item('/invoices', FileText, translate('nav.invoices'))}
      </SidebarNavSection>
      <SidebarNavSection title={translate('nav.catalog')}>
        {item('/products', Image, translate('nav.products'))}
        {item('/categories', FolderTree, translate('nav.categories'))}
      </SidebarNavSection>
      <SidebarNavSection title={translate('nav.customers_section')}>
        {item('/customers', Users, translate('nav.customers'))}
        {item('/segments', ChartPie, translate('nav.segments'))}
        {item('/reviews', MessageSquareText, translate('nav.reviews'), pendingReviews)}
      </SidebarNavSection>
    </SidebarNav>
  );
}

function DemoNote() {
  const translate = useTranslate();
  return (
    <div className={styles.demoNote}>
      <Badge tone="info" size="sm">
        {translate('shell.demo_badge')}
      </Badge>
      <p>{translate('shell.demo_note')}</p>
    </div>
  );
}

function TenantSelect({ hideLabel = false }: { hideLabel?: boolean }) {
  const translate = useTranslate();
  const { tenantId, set } = usePreferences();
  return (
    <Select
      label={translate('shell.shop')}
      hideLabel={hideLabel}
      size="sm"
      value={tenantId}
      options={TENANT_LIST.map((t) => ({ value: t.id, label: t.name, description: translate(`shell.brand_${t.brand}`) }))}
      onValueChange={(v) => isTenantId(v) && set({ tenantId: v })}
    />
  );
}

function Header({ onOpenNav }: { onOpenNav: () => void }) {
  const translate = useTranslate();
  const { theme, density, tenant, locale, set, bumpDataVersion } = usePreferences();
  const [resetOpen, setResetOpen] = useState(false);
  const toast = useToast();
  const dark = theme === 'dark';
  const compact = density === 'compact';
  return (
    <header className={styles.header}>
      <IconButton className={styles.menuButton} icon={MenuIcon} variant="ghost" label={translate('shell.open_menu', { _: 'Open menu' })} onClick={onOpenNav} />
      <div className={styles.search}>
        <GlobalSearch />
      </div>
      <div className={styles.headerEnd}>
        <div className={styles.tenantSwitch}>
          <TenantSelect hideLabel />
        </div>
        <Tooltip content={translate(compact ? 'shell.density_comfortable' : 'shell.density_compact')}>
          <IconButton
            icon={compact ? Rows3 : Rows4}
            variant="ghost"
            size="sm"
            pressed={compact}
            label={translate('shell.compact_density', { _: 'Compact density' })}
            onClick={() => set({ density: compact ? 'comfortable' : 'compact' })}
          />
        </Tooltip>
        <Tooltip content={translate(dark ? 'shell.theme_light' : 'shell.theme_dark')}>
          <IconButton
            icon={dark ? Sun : Moon}
            variant="ghost"
            size="sm"
            label={translate(dark ? 'shell.theme_light' : 'shell.theme_dark')}
            onClick={() => set({ theme: dark ? 'light' : 'dark' })}
          />
        </Tooltip>
        <Menu>
          <MenuTrigger className={styles.account} aria-label={translate('shell.account', { _: 'Account and language' })}>
            <Avatar name="Alex Morgan" size="sm" decorative />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuGroup label="Alex Morgan">
              <MenuRadioGroup label={translate('shell.language')} value={locale} onValueChange={(v) => set({ locale: v === 'fr' ? 'fr' : 'en' })}>
                <MenuRadioItem value="en">English</MenuRadioItem>
                <MenuRadioItem value="fr">Français</MenuRadioItem>
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
            <MenuItem icon={RotateCcw} onClick={() => setResetOpen(true)}>
              {translate('shell.reset_data')}
            </MenuItem>
            <MenuItem icon={LogOut} disabled>
              {translate('shell.sign_out')}
            </MenuItem>
          </MenuContent>
        </Menu>
        <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
          <AlertDialogContent
            title={translate('shell.reset_title', { shop: tenant.name })}
            description={translate('shell.reset_description')}
            confirmLabel={translate('shell.reset_confirm')}
            cancelLabel={translate('bridge.form.cancel', { _: 'Cancel' })}
            onConfirm={() => {
              resetTenantData(tenant);
              bumpDataVersion();
              toast.success(translate('shell.reset_done', { shop: tenant.name }));
            }}
          />
        </AlertDialog>
      </div>
    </header>
  );
}
