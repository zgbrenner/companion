const navToggle = document.querySelector('[data-nav-toggle]');
const nav = document.querySelector('[data-nav]');

if (navToggle && nav) {
  navToggle.addEventListener('click', () => {
    const open = navToggle.getAttribute('aria-expanded') !== 'true';
    navToggle.setAttribute('aria-expanded', String(open));
    nav.dataset.open = String(open);
  });

  nav.addEventListener('click', (event) => {
    if (!(event.target instanceof HTMLAnchorElement)) return;
    navToggle.setAttribute('aria-expanded', 'false');
    nav.dataset.open = 'false';
  });
}

const showcase = document.querySelector('[data-showcase]');
if (showcase) {
  const tabs = [...showcase.querySelectorAll('[data-showcase-target]')];
  const panels = [...showcase.querySelectorAll('[data-showcase-panel]')];

  const activate = (tab) => {
    const target = tab.dataset.showcaseTarget;
    for (const candidate of tabs) candidate.setAttribute('aria-selected', String(candidate === tab));
    for (const panel of panels) panel.hidden = panel.id !== target;
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const offset = event.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(index + offset + tabs.length) % tabs.length];
      next.focus();
      activate(next);
    });
  }
}

for (const node of document.querySelectorAll('[data-year]')) {
  node.textContent = String(new Date().getFullYear());
}

for (const link of document.querySelectorAll('[data-store-unavailable]')) {
  link.addEventListener('click', (event) => event.preventDefault());
}
