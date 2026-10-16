import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Button } from '../Button';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders a banner-free header with an h1, lead, meta and actions', async () => {
    render(
      <main>
        <PageHeader title="Spacing" lead="A 4 px base scale." meta="Updated 3 days ago" actions={<Button variant="secondary">Edit in Studio</Button>} />
      </main>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Spacing' })).toBeInTheDocument();
    expect(screen.getByText('A 4 px base scale.')).toBeInTheDocument();
    expect(screen.getByText('Updated 3 days ago')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit in Studio' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('takes the lead from children and supports a level 2 title', () => {
    render(<PageHeader title="Overview" headingLevel={2}>Read the system.</PageHeader>);
    expect(screen.getByRole('heading', { level: 2, name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('Read the system.')).toBeInTheDocument();
  });

  it('omits empty slots', () => {
    const { container } = render(<PageHeader title="Install" />);
    expect(container.querySelectorAll('header > *')).toHaveLength(1);
  });
});
