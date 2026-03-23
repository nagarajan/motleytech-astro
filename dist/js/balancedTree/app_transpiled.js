// import React from 'react'
// import ReactDOM from 'react-dom'
// import './app.css'
const BASE_ANIM_DELAY = 2000;
let ANIM_DELAY = BASE_ANIM_DELAY;

class Node {
  constructor(data, nodeData) {
    this.data = data;
    this.left = null;
    this.right = null;
    this.parent = null;
    this.level = 0;
    this.nodeData = nodeData;
  }

  setLeft(node) {
    this.left = node;

    if (node) {
      node.parent = this;
    }
  }

  setRight(node) {
    this.right = node;

    if (node) {
      node.parent = this;
    }
  }

  *insert(node) {
    yield ['Compare', this.nodeData];

    if (node.data < this.data) {
      if (this.left) {
        yield ['Go left', this.nodeData];
        yield ['Go left', this.left.nodeData];
        yield* this.left.insert(node);
      } else {
        yield ['Insert at left', this.nodeData];
        this.setLeft(node);
        yield ['Inserted', node.nodeData];
      }
    } else {
      if (this.right) {
        yield ['Go right', this.nodeData];
        yield ['Go right', this.right.nodeData];
        yield* this.right.insert(node);
      } else {
        yield ['Insert at right', this.nodeData];
        this.setRight(node);
        yield ['Inserted', node.nodeData];
      }
    }

    yield ['Check Heights and Balance', this.nodeData];
    this.updateLevel();
    yield* this.balance();
  }

  updateLevel() {
    const [ll, rl] = this.getChildrenLevels();
    this.level = (ll > rl ? ll : rl) + 1;
  }

  getChildrenLevels() {
    const leftLevel = this.left ? this.left.level : -1;
    const rightLevel = this.right ? this.right.level : -1;
    return [leftLevel, rightLevel];
  }

  *balance() {
    const [ll, rl] = this.getChildrenLevels();

    if (ll - rl > 1) {
      yield* this.rotateRight();
    } else if (rl - ll > 1) {
      yield* this.rotateLeft();
    }
  }

  isLeftBigger() {
    const [ll, rl] = this.getChildrenLevels();
    return ll > rl;
  }

  isRightBigger() {
    const [ll, rl] = this.getChildrenLevels();
    return rl > ll;
  }

  *rotateLeft(recurse = true) {
    if (recurse && this.right !== null && this.right.isLeftBigger()) {
      yield* this.right.rotateRight(false);
    }

    yield ['Rotate left', this.nodeData];
    const newRoot = this.right;
    const parent = this.parent;
    this.setRight(newRoot.left);
    newRoot.setLeft(this);
    this === parent.left ? parent.setLeft(newRoot) : parent.setRight(newRoot);
    this.updateLevel();
    newRoot.updateLevel();
    yield ['Rotate left', this.nodeData];
  }

  *rotateRight(recurse = true) {
    if (recurse && this.left !== null && this.left.isRightBigger()) {
      yield* this.left.rotateLeft(false);
    }

    yield ['Rotate right', this.nodeData];
    const newRoot = this.left;
    const parent = this.parent;
    this.setLeft(newRoot.right);
    newRoot.setRight(this);
    this === parent.right ? parent.setRight(newRoot) : parent.setLeft(newRoot);
    this.updateLevel();
    newRoot.updateLevel();
    yield ['Rotate right', this.nodeData];
  }

  traverse() {
    const left = this.left ? this.left.traverse() : [];
    const right = this.right ? this.right.traverse() : [];
    return [...left, this.data, ...right];
  }

}

class BalancedBinaryTree {
  constructor(nodeData) {
    this.root = null;
    this.left = null;
    this.right = null;
    this.nodeData = nodeData;
  }

  setAll(node) {
    this.root = node;
    this.left = node;
    this.right = node;
    node.parent = this;
  }

  setRight(node) {
    this.setAll(node);
  }

  setLeft(node) {
    this.setAll(node);
  }

  *insert(node) {
    yield ['Inserting into tree', this.nodeData];

    if (this.root) {
      yield* this.root.insert(node);
    } else {
      this.setAll(node);
    }

    yield ['Completed Insertion', this.nodeData];
    return 'done';
  }

  traverse() {
    return this.root.traverse();
  }

  bft() {
    const toVisit = [this.root];
    const result = [];
    const level = {
      [this.root.data]: 0
    };
    let node;

    while (toVisit.length > 0) {
      node = toVisit.shift();
      result.push([node.data, level]);
      node.left && toVisit.push(node.left);
      node.right && toVisit.push(node.right);
    }

    return result;
  }

  getNodePositions() {
    if (!this.root) {
      return [];
    }

    const toVisit = [[this.root, 0, 0, this.root.level]];
    const result = [];

    while (toVisit.length > 0) {
      const [node, level, offset, height] = toVisit.shift();
      result.push([node, node.nodeData, level, offset, height]);
      node.left && toVisit.push([node.left, level + 1, offset * 2, node.left.level]);
      node.right && toVisit.push([node.right, level + 1, offset * 2 + 1, node.right.level]);
    }

    return result;
  }

}

const mapSpeedToDelay = {
  [-5]: 5,
  [-4]: 3,
  [-3]: 2,
  [-2]: 1.5,
  [-1]: 1.2,
  0: 1,
  1: 0.8,
  2: 0.6,
  3: 0.4,
  4: 0.3,
  5: 0.2,
  6: 0.1
};

class AnimateBBTree extends React.Component {
  constructor() {
    super();
    this.state = {
      inputValue: "6,43,96,70,52,78,4,16,8,49,15,9",
      animSpeed: 1
    };
    this.treeref = React.createRef();
    this.initialize();
  }

  dataChanged() {
    // this.treeref.current.innerHTML = ''
    this.cleanup();
    this.initialize();
    setTimeout(() => this.updateWaitingNodesPos(this.domData.waitingNodes), ANIM_DELAY / 2);
    setTimeout(() => this.animate(true), ANIM_DELAY * 2);
    this.forceUpdate();
  }

  _handleKeyDown(e) {
    if (e.key === 'Enter') {
      this.dataChanged();
    }
  }

  cleanup() {
    this.domData.refs.forEach(ref => {
      const style = ref.current.style;
      style.left = null;
      style.top = null;
      ref.current.children[0].style.display = 'none';
      ref.current.children[1].style.display = 'none';
      const value = ref.current.children[2].innerText;
      ref.current.children[2].innerText = value.split(' ')[0].trim();
    });
    this.headRef.current.children[0].style.display = 'none';
    this.headRef.current.children[1].style.display = 'none';
    this.domData.lineRefs.forEach(lr => {
      const style = lr.current.style;
      style.width = '0';
      style.height = '0';
      style.left = null;
      style.top = null;
    });

    if (this.animationTimer !== undefined) {
      clearTimeout(this.animationTimer);
      this.animationTimer = undefined;
    }
  }

  initialize() {
    this.finishedAnimating = true;

    if (this.animationTimer !== undefined) {
      clearTimeout(this.animationTimer);
      this.animationTimer = undefined;
    }

    this.data = this.state.inputValue.split(',').map(x => parseInt(x.trim()));
    this.headRef = React.createRef();
    const headData = {
      ref: this.headRef,
      value: -1,
      index: -1,
      ttIndex: 0
    };
    this.tree = new BalancedBinaryTree(headData);
    this.domData = {};
    this.initData();
  }

  initData() {
    const refs = this.data.map(n => React.createRef());
    const lineRefs = this.data.map(n => React.createRef());
    const lines = this.data.map((_, index) => this.getLine(lineRefs[index]));
    const nodes = this.data.map((n, index) => this.getNode(n, refs[index]));
    const nodesData = this.data.map((d, index) => {
      return {
        value: d,
        index,
        ref: refs[index],
        lineRef: lineRefs[index],
        ttIndex: 0
      };
    });
    const waitingNodes = Array.from(nodesData);
    this.domData = {
      nodes,
      lines,
      waitingNodes,
      head: this.getHead(),
      refs,
      lineRefs,
      nodesData
    };
  }

  getHead() {
    return /*#__PURE__*/React.createElement("div", {
      className: "head",
      "data-node-id": "head",
      ref: this.headRef,
      style: {
        top: '15%',
        left: '40%'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "nodeTooltip"
    }), /*#__PURE__*/React.createElement("div", {
      className: "tooltipArrow"
    }), /*#__PURE__*/React.createElement("div", {
      className: "headlabel"
    }, "Head"));
  }

  getNode(index, ref) {
    return /*#__PURE__*/React.createElement("div", {
      className: "node",
      "data-node-id": index,
      key: index,
      ref: ref
    }, /*#__PURE__*/React.createElement("div", {
      className: "nodeTooltip"
    }), /*#__PURE__*/React.createElement("div", {
      className: "tooltipArrow"
    }), /*#__PURE__*/React.createElement("div", {
      className: "nodeLabel"
    }, index));
  }

  getLine(ref) {
    return /*#__PURE__*/React.createElement("svg", {
      ref: ref,
      viewBox: "0 0 100 100",
      className: "parentLine",
      preserveAspectRatio: "none",
      style: {
        width: 0,
        height: 0,
        transform: 'scale(1,1)'
      }
    }, /*#__PURE__*/React.createElement("path", {
      className: "line",
      vectorEffect: "non-scaling-stroke",
      stroke: "black",
      strokeWidth: "2",
      fill: "transparent",
      d: "M 2 0 Q 2 50, 26 50 T 74 50 T 98, 100"
    }));
  }

  updateWaitingNodesPos(waitingNodes) {
    waitingNodes.forEach((nodeInfo, cIndex) => {
      const el = nodeInfo.ref.current;
      el.style = `top: 1em; left: ${cIndex * 4 + 2}em`;
    });
  }

  flashTooltip(nodeData, msg, duration) {
    const tooltipEl = nodeData.ref.current.children[0];
    nodeData.ref.current.children[1].style.display = 'block';
    tooltipEl.style.display = 'block';
    tooltipEl.innerText = msg;
    nodeData.ttIndex += 1;
    const count = nodeData.ttIndex;
    setTimeout(() => this.closeTooltip(nodeData, count), duration);
  }

  closeTooltip(nodeData, count) {
    if (nodeData.ttIndex !== count) {
      return;
    }

    if (!nodeData.ref.current) return;
    nodeData.ref.current.children[0].style.display = 'none';
    nodeData.ref.current.children[1].style.display = 'none';
  }

  getLocation(node) {
    const crect = node.nodeData.ref.current.getClientRects();
    return [crect[0].left, crect[0].top];
  }

  animate(popNode = false) {
    if (!this.finishedAnimating) {
      return;
    }

    const waitingNodes = this.domData.waitingNodes;
    let currentNodeData;

    if (popNode) {
      if (waitingNodes.length === 0) {
        return;
      }

      currentNodeData = waitingNodes.shift();
    }

    this.updateWaitingNodesPos(waitingNodes);

    const animationCallback = () => {
      if (this.finishedAnimating) {
        return;
      }

      const result = gen.next();
      const nodes = this.tree.getNodePositions();
      nodes.forEach(([node, nodeData, level, offset, height]) => {
        const el = nodeData.ref.current;
        let changed = false;
        const [top, left] = [`${level * 12 + 27}%`, `${100 * (offset + 0.5) / Math.pow(2, level)}%`];

        if (el.style.top !== top) {
          el.style.top = top;
          changed = true;
        }

        if (el.style.left !== left) {
          el.style.left = left;
          changed = true;
        }

        el.children[2].innerHTML = `${nodeData.value} <sub>${height}</sub>`;

        if (changed) {
          this.updateLine(node, node.parent);
        }
      });

      if (result.done) {
        this.finishedAnimating = true;
        setTimeout(() => this.animate(true), 0);
        return;
      }

      const [msg, nodeData] = result.value;

      if (['Inserting into tree', 'Compare', 'Go left', 'Go right', 'Insert at left', 'Insert at right'].includes(msg)) {
        let top = nodeData.ref.current.style.top;
        const leftp = nodeData.ref.current.style['left']; // remove % from the end

        const left = parseInt(leftp.slice(0, -1));
        const cStyle = currentNodeData.ref.current.style;
        cStyle.top = top;
        cStyle.left = `${left + 5}%`;
        this.flashTooltip(currentNodeData, msg, ANIM_DELAY);
      } else if (['Check Heights and Balance', 'Rotate left', 'Rotate right', 'Inserted', 'Completed Insertion'].includes(msg)) {
        this.flashTooltip(nodeData, msg, ANIM_DELAY);
      }

      this.animationTimer = setTimeout(animationCallback, ANIM_DELAY);
    };

    let gen;

    if (popNode) {
      this.finishedAnimating = false;
      gen = this.tree.insert(new Node(currentNodeData.value, currentNodeData));
      animationCallback();
    }
  }

  updateLine(node1, node2, color) {
    const [s1, s2] = [node1, node2].map(x => x.nodeData.ref.current.style);
    const [x1, y1] = [s1.left, s1.top].map(x => parseInt(x.slice(0, -1)));
    const [x2, y2] = [s2.left, s2.top].map(x => parseInt(x.slice(0, -1)));
    const rev = x1 < x2;
    let left = x1 < x2 ? x1 : x2;
    let top = y1 < y2 ? y1 : y2;
    let bottom = y1 < y2 ? y2 : y1;
    let right = x1 < x2 ? x2 : x1;
    const width = right - left;
    const height = bottom - top;
    const svg = node1.nodeData.lineRef.current;
    svg.style.width = `${width}%`;
    svg.style.height = `${height}%`;
    svg.style.left = `${left}%`;
    svg.style.top = `${top}%`;

    if (rev) {
      svg.style.transform = 'scale(-1, 1)';
    } else {
      svg.style.transform = 'scale(1, 1)';
    }
  }

  componentDidMount() {
    setTimeout(() => this.animate(true), ANIM_DELAY * 2);
    this.updateWaitingNodesPos(this.domData.waitingNodes);
  }

  onInputChange(e) {
    this.setState({
      inputValue: e.target.value
    });
  }

  onAnimSpeedChange(e) {
    ANIM_DELAY = BASE_ANIM_DELAY * mapSpeedToDelay[e.target.value];
    this.setState({
      animSpeed: e.target.value
    });
    let root = document.documentElement;
    root.style.setProperty('--transition-time', `${ANIM_DELAY * 0.0005}s`);
  }

  render() {
    return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "inline-input"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex-item1"
    }, /*#__PURE__*/React.createElement("label", null, "Input Data:"), /*#__PURE__*/React.createElement("input", {
      className: "inputField",
      value: this.state.inputValue,
      onChange: e => this.onInputChange(e),
      onKeyUp: e => this._handleKeyDown(e)
    })), /*#__PURE__*/React.createElement("div", {
      className: "flex-item2"
    }, /*#__PURE__*/React.createElement("label", null, "Animation Speed:"), /*#__PURE__*/React.createElement("input", {
      type: "range",
      min: "-5",
      max: "6",
      className: "speedslider",
      value: this.state.animSpeed,
      onChange: e => this.onAnimSpeedChange(e)
    }))), /*#__PURE__*/React.createElement("div", {
      className: "tree",
      ref: this.treeref
    }, this.domData.head, this.domData.nodes, this.domData.lines));
  }

}

class App extends React.Component {
  render() {
    return /*#__PURE__*/React.createElement("div", {
      className: "treeContainer"
    }, /*#__PURE__*/React.createElement(AnimateBBTree, null));
  }

}

ReactDOM.render( /*#__PURE__*/React.createElement(App, null), document.querySelector('#root'));
