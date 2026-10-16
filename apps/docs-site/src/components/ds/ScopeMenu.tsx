// Top bar menu for the design system preview scope (brand x density). A hydrated island (client:idle): DS Popover
// with two DS SegmentedControls. State lives in scripts/shell.ts; this island asks for changes with
// `bridge:set-scope` and follows `bridge:scope` (components/ds/scope.ts).
import { Button, Popover, PopoverContent, PopoverTrigger, SegmentedControl } from '@bridge-ds/react';
import { ChevronDown } from 'lucide-react';
import { requestScope, useScope } from './scope';

interface Option {
  value: string;
  label: string;
}

export interface ScopeMenuProps {
  brands: Option[];
  densities: Option[];
}

export default function ScopeMenu({ brands, densities }: ScopeMenuProps) {
  const scope = useScope();
  const label = (list: Option[], v: string) => list.find((o) => o.value === v)?.label ?? v;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="secondary" size="sm" iconEnd={ChevronDown} aria-label="Design system preview: brand and density" title="Brand and density of the design system previews" />
        }
      >
        <span className="shell-scope-trigger">
          <span className="scope-swatch" aria-hidden="true"></span>
          <span className="scope-label">
            <span>{label(brands, scope.brand)}</span>
            <span className="scope-dot" aria-hidden="true"></span>
            <span>{label(densities, scope.density)}</span>
          </span>
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        arrow={false}
        title="Previews use"
        description="Applies to every design system preview on the site. The Bridge app chrome stays the same."
        className="shell-pop"
      >
        <div className="shell-scope-groups">
          <p className="shell-pop-label" id="scope-brand-label">
            Brand
          </p>
          <SegmentedControl
            aria-labelledby="scope-brand-label"
            size="sm"
            fullWidth
            value={scope.brand}
            onValueChange={(brand) => requestScope({ brand })}
            items={brands.map((b) => ({
              value: b.value,
              label: b.label,
              leading: <span className="scope-chip" data-theme="light" data-brand={b.value} data-scope-fixed="" />,
            }))}
          />
          <p className="shell-pop-label" id="scope-density-label">
            Density
          </p>
          <SegmentedControl
            aria-labelledby="scope-density-label"
            size="sm"
            fullWidth
            value={scope.density}
            onValueChange={(density) => requestScope({ density })}
            items={densities}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
