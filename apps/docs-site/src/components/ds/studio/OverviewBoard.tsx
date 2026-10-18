// The Studio Overview "In flight" board: four stages (Exploring, In review, Ready to ship, Next release). Wide
// screens: columns whose header links to the stage in Changes, at most two DS Cards each then "+N more"; an empty
// stage collapses to its header. Narrow screens: one DS Accordion row per stage with its count, the cards open on
// tap. A card: the title (token names in Plex Mono), one status pattern (icon and label: Blocked or You), what holds
// it, and who is on it (never the viewer). Mounted by the Overview page script. Words: lib/overview-board.ts.
import { createRoot, type Root } from 'react-dom/client';
import { ChevronRight, CircleAlert, CircleUserRound } from 'lucide-react';
import { Accordion, AccordionItem, Avatar, Button, Card, CardBody, Icon, Link } from '@bridge-ds/react';
import { columnHeading, columnMeta, splitTokens, visibleCards, type BoardCard, type BoardColumn } from '../../../lib/overview-board';

function Title({ text }: { text: string }) {
  return (
    <>
      {splitTokens(text).map((p, i) =>
        p.token ? (
          <code key={i} className="ov-token">
            {p.text}
          </code>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

function CardItem({ card }: { card: BoardCard }) {
  return (
    <li className="ov-bcard-item">
      <Card interactive padding="compact">
        <CardBody className="ov-bcard">
          <h4 className="t-body ov-bcard-title">
            <Link href={card.href} variant="subtle" data-card-primary>
              <Title text={card.title} />
            </Link>
          </h4>
          {card.status && (
            <p className={`t-ui ov-status is-${card.status.tone}`}>
              <span className="ov-status-mark">
                <Icon icon={card.status.tone === 'blocked' ? CircleAlert : CircleUserRound} size="sm" />
              </span>
              {card.status.label}
            </p>
          )}
          <p className="t-ui t-muted ov-bcard-note">{card.note}</p>
          {card.who && (
            <p className="t-ui t-muted ov-bcard-who">
              <Avatar name={card.who} src={`https://github.com/${card.who}.png?size=48`} size="xs" decorative />@{card.who}
            </p>
          )}
        </CardBody>
      </Card>
    </li>
  );
}

function Cards({ col }: { col: BoardColumn }) {
  const { shown, more } = visibleCards(col.cards);
  return (
    <>
      <ul className="ov-col-list">
        {shown.map((c) => (
          <CardItem key={c.key} card={c} />
        ))}
      </ul>
      {more && (
        <Button variant="ghost" size="sm" fullWidth render={<a href={col.href} />} aria-label={`${more} in ${col.label}`}>
          {more}
        </Button>
      )}
    </>
  );
}

export function OverviewBoard({ columns }: { columns: BoardColumn[] }) {
  return (
    <>
      <div className="ov-board">
        {columns.map((col) => (
          <section key={col.id} className={`ov-col${col.cards.length ? '' : ' is-empty'}`} aria-label={columnHeading(col)}>
            <h3 className="t-ui ov-col-head">
              <Link href={col.href} variant="subtle" className="ov-col-link">
                <span className="ov-col-name">{col.label}</span>
                <span className="t-muted ov-col-count">{columnMeta(col)}</span>
                <span className="ov-col-chev">
                  <Icon icon={ChevronRight} size="sm" />
                </span>
              </Link>
            </h3>
            {col.cards.length > 0 ? <Cards col={col} /> : <p className="t-ui t-muted ov-col-empty">{col.empty}</p>}
          </section>
        ))}
      </div>
      <div className="ov-board-m">
        <Accordion multiple headingLevel={3}>
          {columns.map((col) => (
            <AccordionItem
              key={col.id}
              value={col.id}
              title={
                <>
                  {col.label} <span className="t-muted ov-col-count">{columnMeta(col)}</span>
                </>
              }
            >
              {col.cards.length ? <Cards col={col} /> : <p className="t-ui t-muted ov-col-empty">{col.empty}</p>}
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </>
  );
}

/** Mounts the board into `el` once; later calls repaint it. */
export function paintOverviewBoard(el: HTMLElement, columns: BoardColumn[], root?: Root | null): Root {
  const r = root ?? createRoot(el);
  r.render(<OverviewBoard columns={columns} />);
  return r;
}
