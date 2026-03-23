---
title: "Orbit Camera for 3D scenes"
pubDate: 2016-08-13
category: "Blog"
tags: ["3D", "camera", "orbit"]
author: "Nagarajan"
description: "A set of orbit controls, which allow the object under the mouse pointer to be the 'object of interest' with respect to which the camera then rotates / zooms. <div style=\"display: flex; justify-content: center; margin-bottom: 15px\"><img style=\"width: 400px; border: 2px solid gray; padding: 10px; box-sizing: border-box\" src=\"/images/Orbit camera screenshot.webp\" /></div>"
legacySlug: "orbit-camera"
disqusIdentifier: "3dOrbitCamera"
---
Recently, I was playing with the [Zygote body Google Experiments](https://experiments.withgoogle.com/body-browser), and noticed that the supported camera controls were quite constrained. The zoom-in, zoom-out and rotation were all centered around the Y axis, rather than the object underneath the mouse pointer. This made it difficult to focus on parts relatively far from the Y axis (shoulders for example). The Y axis is effectively locked as the "object of interest".

We have already seen 'better' orbit controls in CAD software like AutoCAD, etc... so its clearly not a new idea - on the contrary, its has existed for as long as 3D CAD software - probably longer than the internet itself. Looking around at different free 3D graphics related programs online, this pattern seems to repeat itself (looking at other 3D chrome experiments, BlocksCAD3d, etc).

I decided to implement such a set of orbit controls, which allow the object under the mouse pointer to be the 'object of interest' with respect to which the camera then rotates / zooms.

The demo below shows such a set of controls at work. The crucial parts of the source code for the controls follows below the demo (built on top of three.js).

Controls:

- Right click to orbit
- Mouse wheel to zoom in/out.

<div class='3dSceneContainer'>
    <canvas id="playground" style="width: 800px; height 600px; display: block"></canvas>
</div>

Figuring out the exact rotations turned out to be a nice little challenge - however, the final solution was fairly straight forward (as it often happens in mathematical maniputations). The three.js matrix operations make it fairly easy to implement the new orbiting manipulations (once the required rotations have been figured out). The code is well commented and should be fairly self explanatory.

```

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

  // retrieve the target under the mouse pointer
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

```

The latest souce code for the above demo can be found in my github repo [here](https://github.com/nagarajan/motleytechpy3/blob/master/content/js/orbit-camera/controls.js). You can also look at the source code for this page - its all unminified.

Please feel free to go ahead and use it in your non-commercial code. Do drop me a line to let me know if are planning to use it (love to hear if someone found it useful). For commercial use, please contact me directly at my [email address](mailto:nag.rajan@gmail.com).

<link rel="stylesheet" href="/css/orbit-camera/app.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/110/three.min.js"></script>
<script src="/js/orbit-camera/controls.js"></script>
