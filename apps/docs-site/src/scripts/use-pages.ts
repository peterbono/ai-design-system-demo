// Page scripts of the Library Use pages (components/ds/library/views/): Bridge's own static pages start them at load,
// a team's Library once the view is in the page.

/** How review works: a link to a section (#agent, #owner-override) opens it. */
export function initReviewPage(doc: Document = document) {
  const open = () => {
    const el = location.hash ? doc.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    const box = el?.closest('details.rw-sec') as HTMLDetailsElement | null;
    if (box && !box.open) {
      box.open = true;
      el!.scrollIntoView({ block: 'start' });
    }
  };
  open();
  window.addEventListener('hashchange', open);
}
