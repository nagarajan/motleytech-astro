import { useEffect } from 'react';
import { loadScript, loadStylesheet } from './scriptLoader';

export default function TodoBoardApp() {
  useEffect(() => {
    async function boot() {
      loadStylesheet('/css/reactToDoList/app.css');
      await loadScript('/js/react.production.min.js');
      await loadScript('/js/react-dom.production.min.js');
      await loadScript('/js/reactToDoList/index.js');
    }
    boot().catch((error) => {
      console.error('Unable to start todo board app', error);
    });
  }, []);

  return <div id="appContainer">You need JavaScript to run this program</div>;
}
