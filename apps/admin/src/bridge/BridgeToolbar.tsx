// The Admin demo's Bridge toolbar: @bridge-ds/toolbar with what this build knows (vite.config.ts reads
// bridge.config.json and the deploy environment), the admin's own preferences (theme, shop) and its shops, and this
// build's token files for changes tried together.
import { useMemo } from 'react';
import { BridgeToolbar as Toolbar, type BridgeBuild, type ToolbarScope } from '@bridge-ds/toolbar';
import { usePreferences } from '../preferences';
import { isTenantId, TENANT_LIST } from '../tenants';

declare const __BRIDGE_BUILD__: BridgeBuild;

const SHOPS = TENANT_LIST.map((t) => ({ id: t.id, name: t.name, brand: t.brand }));

function useAdminScope(): ToolbarScope {
  const { theme, density, tenant, tenantId, set } = usePreferences();
  return useMemo(
    () => ({
      theme,
      density,
      brand: tenant.brand,
      shop: tenantId,
      set: (next) => set({ ...(next.theme ? { theme: next.theme } : {}), ...(next.shop && isTenantId(next.shop) ? { tenantId: next.shop } : {}) }),
    }),
    [theme, density, tenant.brand, tenantId, set],
  );
}

const latest = () => import('./latest').then((m) => m.latestBase(__BRIDGE_BUILD__.tokensRoot ?? 'packages/tokens/src'));

export function BridgeToolbar() {
  return <Toolbar build={__BRIDGE_BUILD__} scope={useAdminScope} shops={SHOPS} together={latest} />;
}
