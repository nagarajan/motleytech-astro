import { useEffect } from 'react';
import { loadScript, loadStylesheet } from './scriptLoader';

export default function BalancedTreeApp() {
  useEffect(() => {
    async function boot() {
      loadStylesheet('/css/balancedTree/app.css');
      await loadScript('/js/react.production.min.js');
      await loadScript('/js/react-dom.production.min.js');
      await loadScript('/js/balancedTree/app_transpiled.js');
    }
    boot().catch((error) => {
      console.error('Unable to start balanced tree app', error);
    });
  }, []);

  return <div id="root">You need JavaScript to run this program</div>;
}
