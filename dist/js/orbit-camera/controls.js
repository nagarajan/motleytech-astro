
let renderer;
let canvas;
let camera;
let scene;

const objects = [];
const highlightGroup = new THREE.Group();

const xaxis = new THREE.Vector3(1, 0, 0);
const yaxis = new THREE.Vector3(0, 1, 0);
const zaxis = new THREE.Vector3(0, 0, 1);
const radius = 10;
const fov = 40;
const tanfov = Math.tan(fov * Math.PI / 360.0);


function initCamera() {
  const aspect = 2;  // the canvas default
  const near = 0.1;
  const far = 10000;
  camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(100, -100, 300);
  camera.lookAt(0, 0, 0);
}

function initLights() {
  const color = 0xFFFFFF;
  const intensity = 1;
  const light = new THREE.PointLight(color, intensity);
  light.position.set(0,0,200)
  scene.add(light);

  const light1 = new THREE.PointLight(color, intensity);
  light1.position.set(100,200,-200)
  scene.add(light1);
}

function initObjects() {
  const geometry = new THREE.SphereBufferGeometry( radius, 13, 13 );
  const yellowMat = new THREE.MeshPhongMaterial( {color: 0xffff00} );
  const redMat = new THREE.MeshPhongMaterial( {color: 0xff0000} );
  const greenMat = new THREE.MeshPhongMaterial( {color: 0x00ff00} );
  const blueMat = new THREE.MeshPhongMaterial( {color: 0x0000ff} );
  const magentaMat = new THREE.MeshPhongMaterial( {color: 0xff00ff} );
  const cyanMat = new THREE.MeshPhongMaterial( {color: 0x00ffff} );
  const lblueMat = new THREE.MeshPhongMaterial( {color: 0x6060ff} );

  let sphere
  sphere = new THREE.Mesh( geometry, yellowMat );
  sphere.position.set(0, 0, 0);
  objects.push(sphere);
  scene.add(sphere)

  sphere = new THREE.Mesh( geometry, redMat );
  sphere.position.set(100, 0, 0);
  objects.push(sphere);
  scene.add(sphere)

  sphere = new THREE.Mesh( geometry, blueMat );
  sphere.position.set(0, 0, 100);
  objects.push(sphere);
  scene.add(sphere)

  sphere = new THREE.Mesh( geometry, greenMat );
  sphere.position.set(0, 50, 0);
  objects.push(sphere);
  scene.add(sphere)

  sphere = new THREE.Mesh( geometry, magentaMat );
  sphere.position.set(0, -50, 0);
  objects.push(sphere);
  scene.add(sphere)

  sphere = new THREE.Mesh( geometry, cyanMat );
  sphere.position.set(-100, 0, 0);
  objects.push(sphere);
  scene.add(sphere);

  sphere = new THREE.Mesh( geometry, lblueMat );
  sphere.position.set(0, 0, -100);
  objects.push(sphere);
  scene.add(sphere);

  scene.add( highlightGroup );
}

function createRenderLoop() {
  function render(time) {
    time *= 0.001;
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}

function initEventHandlers() {
  function onWindowResize() {
    const width = 800.0;
    const height = 600.0;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize( width, height );
  }
  window.addEventListener( 'resize', onWindowResize, false );
  onWindowResize()

  canvas.addEventListener('contextmenu', event => event.preventDefault());
}

function initOrbitCam() {
  const diffToAngle = 0.01;
  const hscale = 1.05;
  const highlightMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.2,
  });
  let isMouseButtonDown = -1;
  let mouseDownPos;
  let rightDownDragging = false;
  let savedCamPos;
  let savedCamLookAt = new THREE.Vector3();
  let orbitTarget;
  let zoomTarget;

  function absScrDist(pos1, pos2) {
    return Math.abs(pos1[0] - pos2[0]) + Math.abs(pos1[1] - pos2[1]);
  }

  function addHighlight(obj) {
    const objCopy = obj.clone();
    objCopy.material = highlightMat;
    objCopy.scale.set(hscale, hscale, hscale);
    highlightGroup.add(objCopy);
  }

  function emptyHighlightGroup() {
    highlightGroup.children.slice(0).forEach(child => {
      highlightGroup.remove(child);
    })
  }

  function getTarget(camera, event, highlight=false) {
    const [x, y] = [event.offsetX, event.offsetY];
    const [cw, ch] = [canvas.width, canvas.height];
    const mouse3D = new THREE.Vector3( ( x / cw ) * 2 - 1,
                                      -( y / ch ) * 2 + 1,
                                      0.5 );
    const raycaster =  new THREE.Raycaster();
    raycaster.setFromCamera( mouse3D, camera );
    const intersects = raycaster.intersectObjects( objects );
    const nv = new THREE.Vector3();
    camera.getWorldDirection(nv);
    console.log({ raycaster, intersects, nv });
    if ( intersects.length > 0 ) {
      if (highlight) {
        addHighlight(intersects[0].object);
      }
      return intersects[0].object.position.clone();
    }

    return camera.position.clone().add(raycaster.ray.direction.clone().multiplyScalar(300));
  }

  function zoom(camera, target, direction) {
    const camPos = camera.position.clone();

    const newCamPos = camPos
    .sub(target)
    .multiplyScalar(direction === 'in' ? 0.85 : 1.15)
    .add(target);
    camera.position.set(...newCamPos.toArray());

    camera.updateProjectionMatrix();
}

  function onCanvasMouseWheel(event) {
    zoomTarget = getTarget(camera, event, false);
    console.log(event);
    event.preventDefault();
    event.stopPropagation();

    const up = event.deltaY > 1;
    const down = event.deltaY < -1;

    if (up) {
        zoom(camera, zoomTarget, 'out');
    }
    if (down) {
        zoom(camera, zoomTarget, 'in');
    }
  }
  canvas.addEventListener("mousewheel", onCanvasMouseWheel, false);

  function onCanvasMouseDown(event) {
    isMouseButtonDown = event.button;
    mouseDownPos = [event.offsetX, event.offsetY];
    orbitTarget = getTarget(camera, event, true);
    event.preventDefault();
    event.stopPropagation();
  }
  canvas.addEventListener("mousedown", onCanvasMouseDown, false);

  function onCanvasMouseUp(event) {
    isMouseButtonDown = -1;
    rightDownDragging = false;
    emptyHighlightGroup();
    event.preventDefault();
    event.stopPropagation();
  }
  canvas.addEventListener("mouseup", onCanvasMouseUp, false);

  function onCanvasMouseMove(event) {
    if (rightDownDragging === false) {
      if (isMouseButtonDown === 2) {
        const currPos = [event.offsetX, event.offsetY];
        const dragDist = absScrDist(mouseDownPos, currPos);
        if (dragDist >= 5) {
          rightDownDragging = true;
          savedCamPos = camera.position.clone();
          camera.getWorldDirection( savedCamLookAt );
        }
      }
    } else {
      const xdiff = event.offsetX - mouseDownPos[0];
      const ydiff = event.offsetY - mouseDownPos[1];
      const yAngle = xdiff * diffToAngle;
      const xAngle = ydiff * diffToAngle;
      orbit(-xAngle, -yAngle, savedCamPos.clone(), savedCamLookAt.clone(), orbitTarget)
    }
  }
  canvas.addEventListener("mousemove", onCanvasMouseMove, false);

  function orbit(xRot, yRot, camPos, camLookAt, target) {
    const newXAxis = camLookAt.clone();
    const lx = camLookAt.x;
    const lz = camLookAt.z;
    // horizontal axis perpendicular to the camera lookat
    newXAxis.x = -lz;
    newXAxis.z = lx;
    newXAxis.y = 0;

    // the .sub() and .add() wrt target are to make sure we do rotations
    // wrt to the target position, and not to the origin
    const newCamPos = camPos
    .sub(target)
    .applyAxisAngle( newXAxis, xRot ) // up / down rotation
    .applyAxisAngle( yaxis, yRot ) // left / right rotation
    .add(target);
    camera.position.set(...newCamPos.toArray());


    // rotate the lookat direction exactly equal to the rotation
    const relLookAt = camLookAt
    .applyAxisAngle( newXAxis, xRot )
    .applyAxisAngle( yaxis, yRot )
    .add(newCamPos);
    camera.lookAt(...relLookAt.toArray());

    camera.updateProjectionMatrix();
  }
}

function skyBox(scene) {
    let geometry = new THREE.CubeGeometry(9000, 9000, 9000);
    const cubeMaterials = [
        new THREE.MeshBasicMaterial({ map: new THREE.TextureLoader().load( "/images/orbit-camera/desert-right.png" ), side: THREE.DoubleSide }),
        new THREE.MeshBasicMaterial({ map: new THREE.TextureLoader().load( '/images/orbit-camera/desert-left.png' ), side: THREE.DoubleSide }),
        new THREE.MeshBasicMaterial({ map: new THREE.TextureLoader().load( '/images/orbit-camera/desert-top.png' ), side: THREE.DoubleSide }),
        new THREE.MeshBasicMaterial({ map: new THREE.TextureLoader().load( '/images/orbit-camera/desert-bottom.png' ), side: THREE.DoubleSide }),
        new THREE.MeshBasicMaterial({ map: new THREE.TextureLoader().load( '/images/orbit-camera/desert-front.png' ), side: THREE.DoubleSide }),
        new THREE.MeshBasicMaterial({ map: new THREE.TextureLoader().load( '/images/orbit-camera/desert-back.png' ), side: THREE.DoubleSide })
    ];

    const cubeMaterial = new THREE.MeshFaceMaterial( cubeMaterials );
    const cube = new THREE.Mesh( geometry, cubeMaterial );
    scene.add(cube);
}

function setup() {
  canvas = document.querySelector('#playground');
  renderer = new THREE.WebGLRenderer({canvas});
  scene = new THREE.Scene();
  skyBox(scene);
//  scene.background = new THREE.Color( 0xf0c050 );
  initCamera();
  initLights();
  initObjects();
  initEventHandlers();
  initOrbitCam();
  createRenderLoop();
}

setup();
