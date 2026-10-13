/**
 * Browser editor types for scripts attached to objects. The desktop editor
 * loads the complete GDJS source tree for autocompletion instead.
 * Runtime implementations live in GDJS/Runtime.
 */
declare namespace gdjs {
  class Variable {
    getAsNumber(): number;
    setNumber(value: number): void;
    getAsString(): string;
    setString(value: string): void;
    getAsBoolean(): boolean;
    setBoolean(value: boolean): void;
    getChild(name: string | number): Variable;
  }

  class VariablesContainer {
    get(name: string): Variable;
    has(name: string): boolean;
  }

  class RuntimeObject {
    /** Object types can provide additional methods and properties. */
    [member: string]: any;
    getName(): string;
    getX(): number;
    setX(x: number): void;
    getY(): number;
    setY(y: number): void;
    setPosition(x: number, y: number): void;
    getAngle(): number;
    setAngle(angle: number): void;
    getWidth(): number;
    getHeight(): number;
    getVariables(): VariablesContainer;
    getRuntimeScene(): RuntimeScene;
    deleteFromScene(): void;
  }

  class RuntimeScene {
    /** Extensions can provide additional scene methods and properties. */
    [member: string]: any;
    getName(): string;
    getObjects(name: string): RuntimeObject[];
    createObject(name: string): RuntimeObject | null;
    getVariables(): VariablesContainer;
    /** Elapsed time since the previous frame, in milliseconds. */
    getElapsedTime(): number;
  }
}
