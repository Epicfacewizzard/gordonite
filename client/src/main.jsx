import { render } from 'preact';
import { App } from './app.jsx';
import './styles.css';

// Keep the toolbar above the on-screen keyboard even when the browser does not
// resize the layout viewport (the viewport meta asks Chrome to, this is the fallback).
function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${Math.round(covered)}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

// Unsent edits live in IndexedDB. Ask the browser not to evict this origin's storage under
// pressure (honoured on HTTPS / installed apps; harmless otherwise).
navigator.storage?.persist?.().catch(() => {});

trackKeyboard();
render(<App />, document.getElementById('app'));
