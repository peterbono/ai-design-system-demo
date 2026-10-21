// The profile card the two walkers carry in the closing (Horizon). A DS Card made interactive: the whole plate is one
// link to Florian's LinkedIn (the Connect button is that link, its hit area stretched over the card), so there is a
// single tab stop, a large target, and the hover lift and focus ring of the Card. Rendered statically, no client JS.
// The avatar is the DS initials Avatar: there is no photo of Florian in the repo, so none is shown.
import { Avatar, Card } from '@bridge-ds/react';
import { ExternalLink } from 'lucide-react';
import ButtonLink from '../ds/ButtonLink';

const NAME = 'Florian Gouloubi';
const ROLE = 'Senior Product Designer';
const LINKEDIN = 'https://www.linkedin.com/in/floriangouloubi/';

export default function HpConnectCard() {
  return (
    <Card interactive padding="none" className="hp-fgcard">
      <div className="hp-fg-id">
        <Avatar name={NAME} size="lg" decorative />
        <span className="hp-pt">
          <strong>{NAME}</strong>
          <small>{ROLE}</small>
        </span>
      </div>
      <ButtonLink
        variant="secondary"
        size="sm"
        fullWidth
        iconEnd={ExternalLink}
        href={LINKEDIN}
        target="_blank"
        rel="noopener"
        aria-label={`Connect on LinkedIn with ${NAME} (opens in a new tab)`}
        data-card-primary=""
        className="hp-connect"
      >
        Connect on LinkedIn
      </ButtonLink>
    </Card>
  );
}
