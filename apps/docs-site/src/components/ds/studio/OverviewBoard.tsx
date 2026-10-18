// The Studio Overview "In flight" board: four columns (Exploring, In review, Ready to ship, Next release), one DS
// Card per change with its title, what holds it (written on the card, a danger mark when it is blocked) and who is
// on it. Mounted by the Overview page script once GitHub answers (it repaints as statuses load). Columns and words:
// lib/overview-board.ts.
import { createRoot, type Root } from 'react-dom/client';
import { CircleAlert } from 'lucide-react';
import { Avatar, Badge, Card, CardBody, Icon, Link } from '@bridge-ds/react';
import { columnHeading, type BoardCard, type BoardColumn } from '../../../lib/overview-board';

function CardItem({ card }: { card: BoardCard }) {
  return (
    <li className="ov-bcard-item">
      <Card interactive padding="compact">
        <CardBody className="ov-bcard">
          <h4 className="t-body ov-bcard-title">
            <Link href={card.href} variant="subtle" data-card-primary>
              {card.title}
            </Link>
          </h4>
          <p className={`t-ui ov-bcard-note${card.tone === 'blocked' ? ' is-blocked' : ' t-muted'}`}>
            {card.tone === 'blocked' && (
              <span className="ov-bcard-mark">
                <Icon icon={CircleAlert} size="sm" />
              </span>
            )}
            <span>{card.note}</span>
          </p>
          {(card.who || card.badge) && (
            <div className="ov-bcard-foot">
              {card.who && (
                <span className="t-ui t-muted ov-bcard-who">
                  <Avatar name={card.who} src={`https://github.com/${card.who}.png?size=48`} size="xs" decorative />@{card.who}
                </span>
              )}
              {card.badge && <Badge tone="info">{card.badge}</Badge>}
            </div>
          )}
        </CardBody>
      </Card>
    </li>
  );
}

export function OverviewBoard({ columns }: { columns: BoardColumn[] }) {
  return (
    <div className="ov-board">
      {columns.map((col) => (
        <section key={col.id} className={`ov-col${col.cards.length ? '' : ' is-empty'}`} aria-label={columnHeading(col)}>
          <h3 className="t-ui ov-col-head">
            <span>{col.label}</span>
            <span className="t-muted ov-col-count">{col.cards.length}</span>
          </h3>
          {col.cards.length ? (
            <ul className="ov-col-list">
              {col.cards.map((c) => (
                <CardItem key={c.key} card={c} />
              ))}
            </ul>
          ) : (
            <p className="t-ui t-muted ov-col-empty">{col.empty}</p>
          )}
        </section>
      ))}
    </div>
  );
}

/** Mounts the board into `el` once; later calls repaint it. */
export function paintOverviewBoard(el: HTMLElement, columns: BoardColumn[], root?: Root | null): Root {
  const r = root ?? createRoot(el);
  r.render(<OverviewBoard columns={columns} />);
  return r;
}
