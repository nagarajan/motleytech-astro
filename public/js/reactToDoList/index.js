class App extends React.Component {
  constructor() {
    super();
    let itemLists = [['Todo', 'Take flying lessons'], ['Doing', 'Looking at this Todo list'], ['Done', 'Published a post about it']];
    itemLists[0] = [...itemLists[0], ...'So Many Todos!'.split(' ')];
    this.state = {
      itemLists: itemLists
    };
  }

  componentDidMount() {
    this.populateStateFromLocalStorage();
  }

  populateStateFromLocalStorage() {
    let stateData = window.localStorage.getItem('todoList');

    if (stateData) {
      try {
        stateData = JSON.parse(stateData);
        super.setState(stateData);
      } catch (e) {
        window.localStorage.setItem('todoList', JSON.stringify(this.state));
      }
    }
  }

  setState(newState) {
    super.setState(newState);
    window.localStorage.setItem('todoList', JSON.stringify(this.state));
  }

  moveLeft(stList, index) {
    const lists = this.state.itemLists;
    const item = lists[stList][index];
    lists[stList].splice(index, 1);
    lists[stList - 1].push(item);
    this.setState({
      itemLists: lists
    });
  }

  moveRight(stList, index) {
    const lists = this.state.itemLists;
    const item = lists[stList][index];
    lists[stList].splice(index, 1);
    lists[stList + 1].push(item);
    this.setState({
      itemLists: lists
    });
  }

  addItem(column, item) {
    const lists = this.state.itemLists;
    lists[column].push(item);
    this.setState({
      itemLists: lists
    });
  }

  deleteItem(column, index) {
    const lists = this.state.itemLists;
    lists[column] = [...lists[column].slice(0, index), ...lists[column].slice(index + 1)];
    this.setState({
      itemLists: lists
    });
  }

  setItem(column, index, item) {
    const lists = this.state.itemLists;
    lists[column][index] = item;
    this.setState({
      itemLists: lists
    });
  }

  clearList(column) {
    const lists = this.state.itemLists;

    if (lists[column].length > 2) {
      const yes = window.prompt('Enter y/yes to clear list', 'y');

      if (!['y', 'yes'].includes(yes)) {
        return;
      }
    }

    lists[column] = lists[column].slice(0, 1);
    this.setState({
      itemLists: lists
    });
  }

  render() {
    return /*#__PURE__*/React.createElement("div", {
      className: "appContainer"
    }, /*#__PURE__*/React.createElement(Board, {
      itemLists: this.state.itemLists,
      moveLeft: (s, i) => this.moveLeft(s, i),
      moveRight: (s, i) => this.moveRight(s, i),
      addItem: (c, i) => this.addItem(c, i),
      setItem: (c, i, item) => this.setItem(c, i, item),
      deleteItem: (c, i) => this.deleteItem(c, i),
      clearList: c => this.clearList(c)
    }));
  }

}

class Board extends React.Component {
  isFirstColumn(column) {
    return column === 0 ? true : false;
  }

  isLastColumn(column) {
    return column === this.props.itemLists.length - 1 ? true : false;
  }

  render() {
    return /*#__PURE__*/React.createElement("div", {
      className: "board"
    }, this.props.itemLists.map((itemList, column) => {
      return /*#__PURE__*/React.createElement(ItemList, {
        items: itemList,
        first: this.isFirstColumn(column),
        last: this.isLastColumn(column),
        moveLeft: this.props.moveLeft,
        moveRight: this.props.moveRight,
        column: column,
        addItem: this.props.addItem,
        setItem: this.props.setItem,
        deleteItem: this.props.deleteItem,
        clearList: this.props.clearList
      });
    }));
  }

}

class ItemList extends React.Component {
  onAddItem() {
    const item = window.prompt('Add new item');

    if (item !== null) {
      this.props.addItem(this.props.column, item);
    }
  }

  editText(index) {
    console.log(index);
    let item = this.props.items[index];
    item = window.prompt('Editing item', item);

    if (item !== null) {
      this.props.setItem(this.props.column, index, item);
    }
  }

  render() {
    const leftArrow = i => /*#__PURE__*/React.createElement("div", {
      className: "arrow",
      onClick: () => this.props.moveLeft(this.props.column, i)
    }, " ", /*#__PURE__*/React.createElement("p", null, "\u2190"), " ");

    const rightArrow = i => /*#__PURE__*/React.createElement("div", {
      className: "arrow",
      onClick: () => this.props.moveRight(this.props.column, i)
    }, " ", /*#__PURE__*/React.createElement("p", null, "\u2192"), " ");

    return /*#__PURE__*/React.createElement("div", {
      className: "itemList"
    }, /*#__PURE__*/React.createElement("div", {
      className: "item header",
      onClick: () => this.editText(0)
    }, /*#__PURE__*/React.createElement(Item, {
      content: this.props.items[0]
    })), this.props.items.slice(1).map((item, idx) => {
      return /*#__PURE__*/React.createElement("div", {
        className: "item todos"
      }, this.props.first ? /*#__PURE__*/React.createElement("div", {
        className: "arrow"
      }) : leftArrow(idx + 1), /*#__PURE__*/React.createElement(Item, {
        content: item,
        editText: () => this.editText(idx + 1)
      }), this.props.last ? /*#__PURE__*/React.createElement("div", {
        className: "arrow"
      }) : rightArrow(idx + 1), /*#__PURE__*/React.createElement("div", {
        className: "arrow",
        onClick: () => this.props.deleteItem(this.props.column, idx + 1)
      }, " ", /*#__PURE__*/React.createElement("p", null, 'x'), " "));
    }), /*#__PURE__*/React.createElement("div", {
      className: "toolbar"
    }, /*#__PURE__*/React.createElement("div", {
      onClick: () => this.onAddItem()
    }, "+ Add item"), /*#__PURE__*/React.createElement("div", {
      onClick: () => this.props.clearList(this.props.column)
    }, "Delete all -")));
  }

}

class Item extends React.Component {
  render() {
    return /*#__PURE__*/React.createElement("div", {
      className: "itemContent",
      onClick: this.props.editText
    }, /*#__PURE__*/React.createElement("p", null, this.props.content));
  }

}

ReactDOM.render( /*#__PURE__*/React.createElement(App, null), document.querySelector('#appContainer'));
