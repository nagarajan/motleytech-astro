import { useEffect } from 'react';
import { loadScript, loadStylesheet } from './scriptLoader';

export default function MinesweeperApp() {
  useEffect(() => {
    async function boot() {
      loadStylesheet('/css/minesweeper/app.css');
      await loadScript('/js/react.production.min.js');
      await loadScript('/js/react-dom.production.min.js');
      await loadScript('/js/minesweeper/app-transpiled.js');
    }
    boot().catch((error) => {
      console.error('Unable to start minesweeper app', error);
    });
  }, []);

  return <div id="minesweeper"></div>;
}
