import { useMemo } from 'react';
import { CoreAdmin, CustomRoutes, Resource, memoryStore } from 'ra-core';
import { Route } from 'react-router';
import { ThemeProvider, ToastProvider, TooltipProvider } from '@bridge-ds/react';
import { PreferencesProvider, usePreferences } from './preferences';
import { createDataProvider } from './data/dataProvider';
import { createI18nProvider } from './i18n/i18nProvider';
import { AppShell } from './shell/AppShell';
import { Dashboard } from './resources/dashboard/Dashboard';
import { orders } from './resources/orders';
import { customers } from './resources/customers';
import { products } from './resources/products';
import { categories } from './resources/categories';
import { reviews } from './resources/reviews';
import { invoices } from './resources/invoices';
import { Segments } from './resources/segments/Segments';

function Admin() {
  const { tenant, theme, density, locale, dataVersion } = usePreferences();
  // One provider per tenant and data version: switching shops swaps datasets, a reset starts over.
  const dataProvider = useMemo(() => createDataProvider(tenant), [tenant, dataVersion]);
  const i18nProvider = useMemo(() => createI18nProvider(locale), [locale]);
  const store = useMemo(() => memoryStore(), [tenant]);

  return (
    <ThemeProvider asRoot theme={theme} brand={tenant.brand} density={density}>
      <TooltipProvider>
        <ToastProvider>
          <CoreAdmin
            key={`${tenant.id}-${locale}-${dataVersion}`}
            dataProvider={dataProvider}
            i18nProvider={i18nProvider}
            store={store}
            layout={AppShell}
            dashboard={Dashboard}
            title={tenant.name}
            disableTelemetry
          >
            <CustomRoutes>
              <Route path="/segments" element={<Segments />} />
            </CustomRoutes>
            <Resource name="orders" {...orders} />
            <Resource name="invoices" {...invoices} />
            <Resource name="customers" {...customers} />
            <Resource name="products" {...products} />
            <Resource name="categories" {...categories} />
            <Resource name="reviews" {...reviews} />
          </CoreAdmin>
        </ToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

export function App() {
  return (
    <PreferencesProvider>
      <Admin />
    </PreferencesProvider>
  );
}
