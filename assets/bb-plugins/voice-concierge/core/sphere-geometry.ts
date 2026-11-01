// A unit icosphere: an icosahedron whose faces are split into four, `detail` times, with every vertex pushed out to
// the sphere. Shared vertices are merged, so detail 5 is 10 242 vertices and 20 480 triangles (16-bit indices).

export interface SphereMesh {
  positions: Float32Array;
  indices: Uint16Array;
}

export function icosphere(detail: number): SphereMesh {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(normalize);
  let faces: number[][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let level = 0; level < detail; level++) {
    const mids = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let i = mids.get(key);
      if (i === undefined) {
        const [p, q] = [verts[a]!, verts[b]!];
        i = verts.push(normalize([(p[0]! + q[0]!) / 2, (p[1]! + q[1]!) / 2, (p[2]! + q[2]!) / 2])) - 1;
        mids.set(key, i);
      }
      return i;
    };
    faces = faces.flatMap(([a, b, c]) => {
      const [ab, bc, ca] = [mid(a!, b!), mid(b!, c!), mid(c!, a!)];
      return [[a!, ab, ca], [b!, bc, ab], [c!, ca, bc], [ab, bc, ca]];
    });
  }
  if (verts.length > 65_536) throw new Error(`icosphere detail ${detail} needs 32-bit indices`);
  return { positions: new Float32Array(verts.flat()), indices: new Uint16Array(faces.flat()) };
}

function normalize(v: number[]): number[] {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}
