import { useEffect } from 'react';
import { loadScript } from './scriptLoader';

type SudokuGlobal = {
  initialize: (tableDiv: string, progressDiv: string) => void;
  onReset: () => void;
  onSolve: () => void;
};

declare global {
  interface Window {
    sudokuSolver?: SudokuGlobal;
  }
}

export default function SudokuApp() {
  useEffect(() => {
    let mounted = true;
    async function boot() {
      await loadScript('https://code.jquery.com/jquery-3.7.1.min.js');
      await loadScript('/js/sudokuSolver.js');
      if (mounted && window.sudokuSolver) {
        window.sudokuSolver.initialize('#sudokudiv', '#progressbar');
      }
    }
    boot().catch((error) => {
      console.error('Unable to start sudoku app', error);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section>
      <div id="sudokudiv"></div>
      <div style={{ marginTop: '12px' }}>
        <button
          id="btnreset"
          className="btn btn-danger"
          type="button"
          onClick={() => window.sudokuSolver?.onReset()}
        >
          Reset
        </button>
        <button
          id="btnsolve"
          className="btn btn-info"
          type="button"
          style={{ marginLeft: '8px' }}
          onClick={() => window.sudokuSolver?.onSolve()}
        >
          Solve
        </button>
        <span id="statustext" style={{ marginLeft: '12px' }}></span>
      </div>
      <span id="errortext" style={{ color: 'red' }}></span>
    </section>
  );
}
