// Procedural prisoner wagon. Local frame: forward = -Z, up = +Y, origin on the ground between the
// axles. Outputs node names the runtime relies on:
//   cart_body, wheel_fl, wheel_fr, wheel_rl, wheel_rr, seat_0..seat_3, driver_seat, hitch
import { MeshBuilder } from "../lib/gltf.mjs";
import { box, cylinder } from "./shapes.mjs";
import { rng } from "./world.mjs";

export const CART = {
  wheelRadius: 0.58,
  axleFront: -1.15,
  axleRear: 1.15,
  track: 0.86, // half distance between wheels
  floorY: 0.92,
  length: 3.6,
  width: 1.56,
};

export function buildCart() {
  const R = rng(77);
  const wood = new MeshBuilder();
  const iron = new MeshBuilder();
  const { floorY, length, width } = CART;
  const hl = length / 2, hw = width / 2;

  // chassis beams
  for (const x of [-hw + 0.12, hw - 0.12]) box(wood, [x, floorY - 0.14, 0], [0.12, 0.14, length + 0.1], [0, 0, 0], { tile: 1.1 });
  for (const z of [-hl + 0.1, -0.6, 0.6, hl - 0.1]) box(wood, [0, floorY - 0.13, z], [width, 0.1, 0.12]);
  // floor planks, slightly irregular
  const nPlanks = 7;
  for (let i = 0; i < nPlanks; i++) {
    const x = -hw + (i + 0.5) * (width / nPlanks);
    box(wood, [x, floorY - 0.03 + (R() - 0.5) * 0.008, 0], [width / nPlanks - 0.012, 0.05, length], [0, 0, (R() - 0.5) * 0.01], {
      tile: 1.2,
      uvOffset: [R() * 4, R()],
    });
  }
  // side walls: three boards each side, posts
  for (const side of [-1, 1]) {
    const x = side * (hw - 0.03);
    for (let b = 0; b < 3; b++)
      box(wood, [x, floorY + 0.1 + b * 0.16, 0], [0.05, 0.14, length], [0, 0, 0], { tile: 1.2, uvOffset: [R() * 3, R()] });
    for (const z of [-hl + 0.05, -hl / 3, hl / 3, hl - 0.05]) box(wood, [x, floorY + 0.28, z], [0.09, 0.62, 0.09]);
    // top rail
    box(wood, [x, floorY + 0.6, 0], [0.1, 0.05, length + 0.06]);
    // benches inside, along the sides
    box(wood, [side * (hw - 0.28), floorY + 0.42, 0.25], [0.36, 0.06, length - 0.9], [0, 0, 0], { tile: 1.3 });
    for (const z of [-0.85, 0.25, 1.35]) box(wood, [side * (hw - 0.28), floorY + 0.2, z], [0.3, 0.42, 0.06]);
    // iron straps
    for (const z of [-hl + 0.3, hl - 0.3]) box(iron, [x + side * 0.03, floorY + 0.28, z], [0.012, 0.5, 0.05]);
  }
  // rear board (lower) and front board (taller)
  box(wood, [0, floorY + 0.22, hl - 0.02], [width, 0.4, 0.05]);
  box(wood, [0, floorY + 0.32, -hl + 0.02], [width, 0.6, 0.05]);
  // driver bench at the front, raised
  box(wood, [0, floorY + 0.72, -hl + 0.32], [width - 0.1, 0.06, 0.38]);
  for (const x of [-hw + 0.15, hw - 0.15]) box(wood, [x, floorY + 0.37, -hl + 0.32], [0.08, 0.66, 0.3]);
  // shafts to the horse
  for (const side of [-1, 1]) {
    box(wood, [side * 0.42, floorY - 0.12, -hl - 1.35], [0.08, 0.08, 3.0], [0.06, side * -0.06, 0], { tile: 1.5 });
  }
  box(wood, [0, floorY - 0.15, -hl - 0.2], [0.9, 0.08, 0.08]);
  // axles
  for (const z of [CART.axleFront, CART.axleRear]) cylinder(iron, [0, CART.wheelRadius, z], 0.04, CART.track * 2 + 0.18, [0, 0, Math.PI / 2], { sides: 8 });
  // axle blocks
  for (const z of [CART.axleFront, CART.axleRear])
    for (const x of [-hw + 0.12, hw - 0.12]) box(wood, [x, (floorY - 0.2 + CART.wheelRadius) / 2 + 0.05, z], [0.14, floorY - 0.2 - CART.wheelRadius + 0.2, 0.18]);

  const wheel = buildWheel();
  return { wood, iron, wheel };
}

/** Wheel in its own local frame (axis = X). */
function buildWheel() {
  const R = CART.wheelRadius;
  const wood = new MeshBuilder();
  const iron = new MeshBuilder();
  const segs = 14;
  // felloes: short boxes around the rim
  for (let i = 0; i < segs; i++) {
    const a = ((i + 0.5) / segs) * Math.PI * 2;
    const r = R - 0.05;
    const len = 2 * Math.PI * r / segs + 0.01;
    box(wood, [0, Math.cos(a) * r, Math.sin(a) * r], [0.07, 0.08, len], [a, 0, 0]);
    // iron tyre
    box(iron, [0, Math.cos(a) * (R - 0.005), Math.sin(a) * (R - 0.005)], [0.075, 0.012, len + 0.01], [a, 0, 0]);
  }
  // spokes
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = (R - 0.1) / 2 + 0.06;
    box(wood, [0, Math.cos(a) * r, Math.sin(a) * r], [0.035, R - 0.16, 0.045], [a, 0, 0]);
  }
  // hub
  cylinder(wood, [0, 0, 0], 0.09, 0.2, [0, 0, Math.PI / 2], { sides: 10, tile: 0.5 });
  cylinder(iron, [0, 0, 0], 0.095, 0.05, [0, 0, Math.PI / 2], { sides: 10 });
  return { wood, iron };
}

/** Seat anchors in cart space (eye positions for sitting characters, facing the cart centre). */
export const SEATS = [
  // [x, y(seat surface), z, yaw]; yaw 0 faces -Z, RH yaw about +Y
  { name: "seat_0", p: [0.5, CART.floorY + 0.45, 0.95], yaw: Math.PI / 2 }, // right rear: the player
  { name: "seat_1", p: [-0.5, CART.floorY + 0.45, 0.95], yaw: -Math.PI / 2 }, // left rear, facing player
  { name: "seat_2", p: [-0.5, CART.floorY + 0.45, -0.35], yaw: -Math.PI / 2 }, // left front
  { name: "seat_3", p: [0.5, CART.floorY + 0.45, -0.35], yaw: Math.PI / 2 }, // right front
  { name: "driver_seat", p: [0, CART.floorY + 0.75, -CART.length / 2 + 0.32], yaw: 0 },
];
