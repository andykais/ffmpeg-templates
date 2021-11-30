import type {  CanvasRenderingContext2D, Path2D } from 'https://deno.land/x/canvas@v1.3.0/src/types.ts'

// deno canvas's DOMPoint type is incomplete
type DOMPoint = {x: number; y: number; z: number; w: number}

type Radii = number | DOMPoint
class ContextExtended {
  constructor(private context: CanvasRenderingContext2D) {}

  roundRect(x: number, y: number, w: number, h: number, radii: Radii[]) {
    if (!([x, y, w, h].every((input) => Number.isFinite(input)))) {
      return;
    }
    radii = this.convertToArray(radii);
    let upperLeft, upperRight, lowerRight, lowerLeft;
    if (radii.length === 4) {
      upperLeft = toCornerPoint(radii[0]);
      upperRight = toCornerPoint(radii[1]);
      lowerRight = toCornerPoint(radii[2]);
      lowerLeft = toCornerPoint(radii[3]);
    } else if (radii.length === 3) {
      upperLeft = toCornerPoint(radii[0]);
      upperRight = toCornerPoint(radii[1]);
      lowerLeft = toCornerPoint(radii[1]);
      lowerRight = toCornerPoint(radii[2]);
    } else if (radii.length === 2) {
      upperLeft = toCornerPoint(radii[0]);
      lowerRight = toCornerPoint(radii[0]);
      upperRight = toCornerPoint(radii[1]);
      lowerLeft = toCornerPoint(radii[1]);
    } else if (radii.length === 1) {
      upperLeft = toCornerPoint(radii[0]);
      upperRight = toCornerPoint(radii[0]);
      lowerRight = toCornerPoint(radii[0]);
      lowerLeft = toCornerPoint(radii[0]);
    } else {
      throw new RangeError(`${ this.getErrorMessageHeader() } ${ radii.length } is not a valid size for radii sequence.`);
    }
    const corners = [upperLeft, upperRight, lowerRight, lowerLeft];
    let negativeCorner = corners.find(({
      x,
      y
    }) => x < 0 || y < 0);
    if (negativeCorner) {
      throw new RangeError(`${ this.getErrorMessageHeader() } Radius value ${ negativeCorner } is negative.`);
    }
    if (corners.some(({
        x,
        y
      }) => !Number.isFinite(x) || !Number.isFinite(y))) {
      return;
    }

    fixOverlappingCorners(corners);

    console.log({ x, y, w, h })
    if (w < 0 && h < 0) {
      this.context.moveTo(x - upperLeft.x, y);
      this.context.ellipse(x + w + upperRight.x, y - upperRight.y, upperRight.x, upperRight.y, 0, -Math.PI * 1.5, -Math.PI);
      this.context.ellipse(x + w + lowerRight.x, y + h + lowerRight.y, lowerRight.x, lowerRight.y, 0, -Math.PI, -Math.PI / 2);
      this.context.ellipse(x - lowerLeft.x, y + h + lowerLeft.y, lowerLeft.x, lowerLeft.y, 0, -Math.PI / 2, 0);
      this.context.ellipse(x - upperLeft.x, y - upperLeft.y, upperLeft.x, upperLeft.y, 0, 0, -Math.PI / 2);
    } else if (w < 0) {
      this.context.moveTo(x - upperLeft.x, y);
      this.context.ellipse(x + w + upperRight.x, y + upperRight.y, upperRight.x, upperRight.y, 0, -Math.PI / 2, -Math.PI, true);
      this.context.ellipse(x + w + lowerRight.x, y + h - lowerRight.y, lowerRight.x, lowerRight.y, 0, -Math.PI, -Math.PI * 1.5, true);
      this.context.ellipse(x - lowerLeft.x, y + h - lowerLeft.y, lowerLeft.x, lowerLeft.y, 0, Math.PI / 2, 0, true);
      this.context.ellipse(x - upperLeft.x, y + upperLeft.y, upperLeft.x, upperLeft.y, 0, 0, -Math.PI / 2, true);
    } else if (h < 0) {
      this.context.moveTo(x + upperLeft.x, y);
      this.context.ellipse(x + w - upperRight.x, y - upperRight.y, upperRight.x, upperRight.y, 0, Math.PI / 2, 0, true);
      this.context.ellipse(x + w - lowerRight.x, y + h + lowerRight.y, lowerRight.x, lowerRight.y, 0, 0, -Math.PI / 2, true);
      this.context.ellipse(x + lowerLeft.x, y + h + lowerLeft.y, lowerLeft.x, lowerLeft.y, 0, -Math.PI / 2, -Math.PI, true);
      this.context.ellipse(x + upperLeft.x, y - upperLeft.y, upperLeft.x, upperLeft.y, 0, -Math.PI, -Math.PI * 1.5, true);
    } else {
      // console.log('moveTo', x + upperLeft.x, y)
      this.context.moveTo(x + upperLeft.x, y);
      // this.context.lineTo(x + upperLeft.x + 50, y + 50)
      // console.log('ellipse', x + w - upperRight.x, y + upperRight.y, upperRight.x, upperRight.y, 0, -Math.PI / 2, 0)
      this.context.ellipse(x + w - upperRight.x, y + upperRight.y, upperRight.x, upperRight.y, 0, -Math.PI / 2, 0);
      this.context.ellipse(x + w - lowerRight.x, y + h - lowerRight.y, lowerRight.x, lowerRight.y, 0, 0, Math.PI / 2);
      this.context.ellipse(x + lowerLeft.x, y + h - lowerLeft.y, lowerLeft.x, lowerLeft.y, 0, Math.PI / 2, Math.PI);
      this.context.ellipse(x + upperLeft.x, y + upperLeft.y, upperLeft.x, upperLeft.y, 0, Math.PI, Math.PI * 1.5);
    }

    this.context.closePath();
    this.context.moveTo(x, y);

    function toCornerPoint(value: Radii): { x: number; y: number } {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return {
          x: value,
          y: value
        };
      }
      if (value && typeof value === "object") {
        return {
          x: value.x ?? 0,
          y: value.y ?? 0
        };
      }
      return {
        x: NaN,
        y: NaN
      };
    }

    function fixOverlappingCorners(corners: {x: number; y: number}[]) {
      const [upperLeft, upperRight, lowerRight, lowerLeft] = corners;
      const factors = [
        Math.abs(w) / (upperLeft.x + upperRight.x),
        Math.abs(h) / (upperRight.y + lowerRight.y),
        Math.abs(w) / (lowerRight.x + lowerLeft.x),
        Math.abs(h) / (upperLeft.y + lowerLeft.y)
      ];
      const minFactor = Math.min(...factors);

      if (minFactor <= 1) {
        for (const radii of corners) {
          radii.x *= minFactor;
          radii.y *= minFactor;
        }
      }
    }
  }

  convertToArray(value: Radii[]) {
    try {
      return [...value];
    } catch (err) {
      throw new TypeError(`${ this.getErrorMessageHeader() } The provided value cannot be converted to a sequence.`);
    }
  }


  getErrorMessageHeader() {
    return `Failed to execute 'roundRect'`;
  }

  // getConstructorName(instance) {
  //   return instance instanceof Path2D ? "Path2D" :
  //     instance instanceof globalThis?.CanvasRenderingContext2D ? "CanvasRenderingContext2D" :
  //     instance instanceof globalThis?.OffscreenCanvasRenderingContext2D ? "OffscreenCanvasRenderingContext2D" :
  //     instance?.constructor.name;
  // }
}
export { ContextExtended }
