// Dont make changes to this file. Change the app.js and use babel
// to transpile it online

"use strict";

const useState = React.useState;
const FLAGGED = 'f';
const MINE = 'm';
const CLOSED = 'c';
const EMPTY = 'e';
const BAD_FLAG = 'x';
const GAME_WON = 'win';
const GAME_LOST = 'loss';
const GAME_NOT_STARTED = 'not started';
const GAME_PLAYING = 'playing';
const prepad = (num, afterDecimal, total) => {
  const s = '000000' + num.toFixed(afterDecimal);
  return s.slice(s.length - total);
};
const getNeighboringPositions = (gameState, pos) => {
  const neighboringPositions = [];
  const {
    rows,
    columns,
    squares
  } = gameState;
  const [p1, p2] = [Math.floor(pos / columns), pos % columns];
  if (p1 > 0) {
    if (p2 > 0) {
      neighboringPositions.push((p1 - 1) * columns + p2 - 1);
    }
    neighboringPositions.push((p1 - 1) * columns + p2);
    if (p2 < columns - 1) {
      neighboringPositions.push((p1 - 1) * columns + p2 + 1);
    }
  }
  if (p2 > 0) {
    neighboringPositions.push(p1 * columns + p2 - 1);
  }
  if (p2 < columns - 1) {
    neighboringPositions.push(p1 * columns + p2 + 1);
  }
  if (p1 < rows - 1) {
    if (p2 > 0) {
      neighboringPositions.push((p1 + 1) * columns + p2 - 1);
    }
    neighboringPositions.push((p1 + 1) * columns + p2);
    if (p2 < columns - 1) {
      neighboringPositions.push((p1 + 1) * columns + p2 + 1);
    }
  }
  return neighboringPositions;
};
const getNeighboringFlaggedCount = (gameState, pos, nPositions) => {
  let flaggedCount = 0;
  const nPos = nPositions || getNeighboringPositions(gameState, pos);
  nPos.forEach(p => {
    if (gameState.squares[p] === FLAGGED) {
      flaggedCount += 1;
    }
  });
  return flaggedCount;
};
const createShadowMinefield = gameState => {
  gameState.shadowMinefield = [...Array(gameState.rows * gameState.columns).keys()].map(pos => {
    if (gameState.minePositions[pos]) {
      return MINE;
    }
    const numMines = getNeighboringMines(gameState, pos);
    if (numMines === 0) {
      return EMPTY;
    }
    return numMines;
  });
};
const fillMines = (gameState, firstPos) => {
  const totalLocations = gameState.rows * gameState.columns;
  const minePositions = {};
  let mines = 0;
  while (mines < gameState.nMines) {
    const newMine = Math.floor(Math.random() * totalLocations);
    if (newMine === firstPos || minePositions[newMine]) {
      continue;
    } else {
      minePositions[newMine] = true;
      mines += 1;
    }
  }
  gameState.minePositions = minePositions;
};
const getNeighboringMines = (gameState, pos) => {
  let mineCount = 0;
  const {
    minePositions
  } = gameState;
  const nPositions = getNeighboringPositions(gameState, pos);
  nPositions.forEach(p1 => {
    if (minePositions[p1]) {
      mineCount += 1;
    }
  });
  return mineCount;
};
const getNeighborsOfEmpty = (gameState, pos) => {
  const {
    rows,
    columns,
    shadowMinefield
  } = gameState;
  const positionsToExplore = [pos];
  const alreadyExplored = {};
  const neighbors = {};
  const handlePosition = newPosition => {
    const count = shadowMinefield[newPosition];
    if (count === EMPTY && !alreadyExplored[newPosition]) {
      positionsToExplore.push(newPosition);
    }
    neighbors[newPosition] = true;
  };
  while (positionsToExplore.length > 0) {
    const currentPosition = positionsToExplore.shift();
    alreadyExplored[currentPosition] = true;
    if (shadowMinefield[currentPosition] === EMPTY) {
      const nPositions = getNeighboringPositions(gameState, currentPosition);
      nPositions.forEach(handlePosition);
    }
  }
  delete neighbors[pos];
  return neighbors;
};
const exposeAllUnmarkedMines = gameState => {
  Object.keys(gameState.minePositions).forEach(pos => {
    if (gameState.squares[pos] === CLOSED) {
      gameState.squares[pos] = MINE;
    }
  });
  gameState.squares.forEach((v, p) => {
    if (!gameState.minePositions[p] && v === FLAGGED) {
      gameState.squares[p] = BAD_FLAG;
    }
  });
};
const MineFieldController = ({
  gameState,
  setGameState
}) => {
  const onLeftClick = pos => {
    if ([GAME_WON, GAME_LOST].includes(gameState.condition)) {
      return;
    }
    if (gameState.squares[pos] === CLOSED) {
      if (gameState.condition === GAME_NOT_STARTED) {
        gameState.condition = GAME_PLAYING;
        gameState.timeStarted = Date.now();
        fillMines(gameState, pos);
        createShadowMinefield(gameState);
        // todo : start the clock
      }

      if (gameState.shadowMinefield[pos] === MINE) {
        gameState.squares[pos] = MINE;
        gameState.firstMine = pos;
        gameState.condition = GAME_LOST;
        gameState.timeEnded = Date.now();
        exposeAllUnmarkedMines(gameState);
        // todo : stop the clock
      } else {
        const current = gameState.shadowMinefield[pos];
        if (current === EMPTY) {
          // get neighboring locations near empty positions
          const neighborsOfEmpty = getNeighborsOfEmpty(gameState, pos);
          // open neighboring positions
          Object.keys(neighborsOfEmpty).forEach(np => {
            if (gameState.squares[np] === CLOSED) {
              gameState.remainingSquares -= 1;
            }
            gameState.squares[np] = gameState.shadowMinefield[np];
          });
        }
        if (gameState.squares[pos] === CLOSED) {
          gameState.remainingSquares -= 1;
        }
        gameState.squares[pos] = current;
      }
      if (gameState.remainingSquares === 0) {
        gameState.condition = GAME_WON;
        gameState.timeEnded = Date.now();
      }
      if (gameState.remainingSquares < 0) {
        console.error('Remaining Squares less than 0', {
          remainingSquares
        });
      }
      setGameState({
        ...gameState
      });
    }
  };
  const onRightClick = (e, pos) => {
    e.preventDefault();
    if ([GAME_WON, GAME_LOST].includes(gameState.condition)) {
      return;
    }
    if (gameState.squares[pos] === CLOSED) {
      gameState.squares[pos] = FLAGGED;
      gameState.minesMarked += 1;
      setGameState({
        ...gameState
      });
    } else if (gameState.squares[pos] === FLAGGED) {
      gameState.squares[pos] = CLOSED;
      gameState.minesMarked -= 1;
      setGameState({
        ...gameState
      });
    }
  };
  const onDoubleClick = pos => {
    // if mines near pos == the number in pos, open all squares near pos
    const number = gameState.squares[pos];
    const nPositions = getNeighboringPositions(gameState, pos);
    const numFlagged = getNeighboringFlaggedCount(gameState, pos, nPositions);
    if (numFlagged === number) {
      // open all closed neighbors
      const {
        shadowMinefield,
        squares
      } = gameState;
      nPositions.forEach(p1 => {
        if (squares[p1] === CLOSED) {
          gameState.remainingSquares -= 1;
          squares[p1] = shadowMinefield[p1];
          if (squares[p1] === MINE) {
            if (gameState.condition !== GAME_LOST) {
              gameState.firstMine = pos;
              gameState.condition = GAME_LOST;
              gameState.timeEnded = Date.now();
              exposeAllUnmarkedMines(gameState);
            }
          } else {
            const current = gameState.shadowMinefield[p1];
            if (current === EMPTY) {
              // get neighboring locations near empty positions
              const neighborsOfEmpty = getNeighborsOfEmpty(gameState, p1);
              // open neighboring positions
              Object.keys(neighborsOfEmpty).forEach(noe => {
                if (gameState.squares[noe] === CLOSED) {
                  gameState.remainingSquares -= 1;
                }
                gameState.squares[noe] = gameState.shadowMinefield[noe];
              });
            }
          }
        }
      });
      if (gameState.remainingSquares === 0) {
        gameState.condition = GAME_WON;
        gameState.timeEnded = Date.now();
      }
      if (gameState.remainingSquares < 0) {
        console.error('Remaining Squares less than 0', {
          remainingSquares
        });
      }
      setGameState({
        ...gameState
      });
    }
  };
  return /*#__PURE__*/React.createElement(MineField, {
    gameState: gameState,
    onLeftClick: onLeftClick,
    onRightClick: onRightClick,
    onDoubleClick: onDoubleClick
  });
};
const dummyRightClick = e => {
  e.preventDefault();
};
const MineField = ({
  gameState,
  onLeftClick,
  onRightClick,
  onDoubleClick
}) => {
  return /*#__PURE__*/React.createElement("div", {
    className: "minefield",
    style: {
      width: gameState.columns * 20
    }
  }, gameState.squares.map((sq, i) => {
    return /*#__PURE__*/React.createElement(React.Fragment, null, sq === CLOSED && /*#__PURE__*/React.createElement("button", {
      onClick: event => {
        if (event.detail === 1) {
          onLeftClick(i);
        }
        if (event.detail === 2) {
          onDoubleClick(i);
        }
      },
      onContextMenu: e => onRightClick(e, i)
    }), sq === FLAGGED && /*#__PURE__*/React.createElement("button", {
      onContextMenu: e => onRightClick(e, i)
    }, "\u26F3\uFE0F"), sq === EMPTY && /*#__PURE__*/React.createElement("div", {
      onContextMenu: dummyRightClick
    }), sq === BAD_FLAG && /*#__PURE__*/React.createElement("button", {
      onContextMenu: dummyRightClick,
      style: {
        backgroundColor: 'red'
      }
    }, "x"), sq === MINE && /*#__PURE__*/React.createElement("div", {
      className: i === gameState.firstMine ? 'redMine' : 'normalMine',
      onContextMenu: dummyRightClick
    }, "\uD83D\uDCA5"), sq >= 1 && sq < 9 && /*#__PURE__*/React.createElement("div", {
      onContextMenu: dummyRightClick,
      onClick: event => {
        if (event.detail === 2) {
          onDoubleClick(i);
        }
      },
      style: {
        userSelect: 'none'
      }
    }, sq));
  }));
};
const ButtonsContainer = ({
  resetGameToSize
}) => {
  // 8x8 with 10 mines), Intermediate (16x16 with 40 mines), and Expert (16x30 with 99 mines).
  return /*#__PURE__*/React.createElement("div", {
    className: "buttonsContainer"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => resetGameToSize([8, 8, 10])
  }, "Beginner (8x8 with 10 mines)"), /*#__PURE__*/React.createElement("button", {
    onClick: () => resetGameToSize([16, 16, 40])
  }, "Intermediate (16x16 with 40 mines)"), /*#__PURE__*/React.createElement("button", {
    onClick: () => resetGameToSize([16, 30, 99])
  }, "Expert (16x30 with 99 mines)"));
};
const Timer = ({
  timeStarted,
  timeEnded
}) => {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [inTimer, setInTimer] = useState(undefined);
  React.useEffect(() => {
    if (!timeStarted && !timeEnded) {
      inTimer && window.clearInterval(inTimer);
      setInTimer(undefined);
    }
    if (timeStarted && !timeEnded && !inTimer) {
      const intervalTimer = window.setInterval(() => {
        setElapsedTime(prevElapsedTime => prevElapsedTime + 123);
      }, 123);
      setInTimer(intervalTimer);
      return () => window.clearInterval(intervalTimer);
    }
    if (timeStarted && timeEnded && inTimer) {
      window.clearInterval(inTimer);
      setInTimer(undefined);
    }
  }, [timeStarted, timeEnded]);
  let displayTime;
  if (timeEnded) {
    displayTime = (timeEnded - timeStarted) / 1000.0;
    if (inTimer) {
      window.clearInterval(inTimer);
      setInTimer(undefined);
    }
  } else {
    if (!timeStarted || !elapsedTime) {
      displayTime = 0;
    } else {
      displayTime = (Date.now() - timeStarted) / 1000;
    }
  }
  if (displayTime < 10) {
    displayTime = prepad(displayTime, 2, 4);
  } else if (displayTime < 100) {
    displayTime = prepad(displayTime, 1, 4);
  } else {
    displayTime = prepad(displayTime, 0, 3);
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "timer"
  }, /*#__PURE__*/React.createElement("span", null, "888"), /*#__PURE__*/React.createElement("span", null, displayTime));
};
const getNewGameState = gameSize => {
  const [rows, columns, nMines] = gameSize;
  return {
    rows,
    columns,
    nMines,
    condition: GAME_NOT_STARTED,
    minePositions: {},
    timeStarted: undefined,
    timeEnded: undefined,
    minesMarked: 0,
    firstMine: undefined,
    remainingSquares: rows * columns - nMines,
    squares: [...Array(rows * columns).keys()].map(x => CLOSED)
  };
};
const RemainingMinesCount = ({
  gameState
}) => {
  const count = gameState.nMines - gameState.minesMarked;
  let displayCount;
  if (count >= 0) {
    displayCount = prepad(count, 0, 3);
  } else {
    if (count >= -9) {
      displayCount = '-' + count;
    } else {
      displayCount = count;
    }
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "remainingMines"
  }, /*#__PURE__*/React.createElement("span", null, "888"), /*#__PURE__*/React.createElement("span", null, displayCount));
};
const App = () => {
  const [gameSize, setGameSize] = useState([8, 8, 10]);
  const [gameState, setGameState] = useState(getNewGameState(gameSize));
  const resetGameToSize = size => {
    setGameSize(size);
    setGameState(getNewGameState(size));
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ButtonsContainer, {
    resetGameToSize: resetGameToSize
  }), /*#__PURE__*/React.createElement("div", {
    className: "gameCenteringDiv"
  }, /*#__PURE__*/React.createElement("div", {
    className: "gameOuterWrapper"
  }, /*#__PURE__*/React.createElement("div", {
    className: "gameWrapper"
  }, /*#__PURE__*/React.createElement("div", {
    className: "gameControls"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(RemainingMinesCount, {
    gameState: gameState
  })), /*#__PURE__*/React.createElement("button", {
    className: "resetButton",
    onClick: () => resetGameToSize([...gameSize])
  }, gameState.condition === GAME_WON ? '😎' : gameState.condition === GAME_LOST ? '🙁' : '😐'), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Timer, {
    timeStarted: gameState.timeStarted,
    timeEnded: gameState.timeEnded
  }))), /*#__PURE__*/React.createElement(MineFieldController, {
    gameState: gameState,
    setGameState: setGameState
  })))));
};
const container = document.getElementById('minesweeper');
const root = ReactDOM.render( /*#__PURE__*/React.createElement(App, null), container);
