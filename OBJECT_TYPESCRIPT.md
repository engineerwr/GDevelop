# TypeScript scripts on objects

Open an object in the editor and select **TypeScript**. Code in this tab is
attached to the object definition and runs independently for every instance.
The source is saved in the project. The editor compiles it to JavaScript for
preview and export.

```ts
let distance = 0;

function onCreate(self: gdjs.RuntimeObject, scene: gdjs.RuntimeScene): void {
  self.setX(100);
}

function onUpdate(
  self: gdjs.RuntimeObject,
  scene: gdjs.RuntimeScene,
  dt: number
): void {
  distance += 120 * dt;
  self.setX(100 + distance);
}

function onDestroy(self: gdjs.RuntimeObject, scene: gdjs.RuntimeScene): void {
  // Called when the instance leaves the scene.
}
```

`dt` is elapsed time in seconds. `onCreate` runs when an instance is created,
`onUpdate` runs before the scene events on each frame, and `onDestroy` runs when
the instance leaves the scene. Top-level variables such as `distance` above
have a separate value for each instance. The runtime API is available as
`gdjs`. Scripts are plain TypeScript files without imports or exports.

After changing the C++ object model or the bindings, rebuild `GDevelop.js`
before starting the IDE. A prebuilt IDE bundle will not contain the new object
script methods.
