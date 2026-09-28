// Reads STL, OBJ, 3MF and PLY files in the browser with Three.js' MIT-licensed loaders.
// Nothing is uploaded anywhere; loaders are fetched lazily so they cost nothing until used.

import * as THREE from 'three';
import type { RGB } from './analyze';
import type { MeshData } from './meshModel';

export const MESH_EXTENSIONS = ['stl', 'obj', '3mf', 'ply'] as const;
export const MAX_MESH_BYTES = 80 * 1024 * 1024;
export const MAX_TRIANGLES = 3_000_000;

export function meshExtension(name: string): (typeof MESH_EXTENSIONS)[number] | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return (MESH_EXTENSIONS as readonly string[]).includes(ext) ? (ext as (typeof MESH_EXTENSIONS)[number]) : null;
}

export async function loadMeshFile(file: File): Promise<MeshData> {
  const ext = meshExtension(file.name);
  if (!ext) throw new Error(`${file.name} isn't a supported 3D file. Use STL, OBJ, 3MF or PLY.`);
  if (file.size > MAX_MESH_BYTES) throw new Error(`${file.name} is larger than 80 MB. Try a lighter export.`);
  const name = file.name.replace(/\.[^.]+$/, '');
  let data: { positions: Float32Array; color: RGB | null };

  switch (ext) {
    case 'stl': {
      const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
      const geo = new STLLoader().parse(await file.arrayBuffer());
      data = { positions: soup(geo), color: null };
      break;
    }
    case 'ply': {
      const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');
      const geo = new PLYLoader().parse(await file.arrayBuffer());
      data = { positions: soup(geo), color: averageVertexColor(geo) };
      break;
    }
    case 'obj': {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
      data = fromGroup(new OBJLoader().parse(await file.text()));
      break;
    }
    case '3mf': {
      const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');
      data = fromGroup(new ThreeMFLoader().parse(await file.arrayBuffer()));
      break;
    }
  }
  const tris = data.positions.length / 9;
  if (!tris) throw new Error(`${file.name} has no triangles to print.`);
  if (tris > MAX_TRIANGLES) throw new Error(`${file.name} has ${tris.toLocaleString()} triangles; the limit is 3 million.`);
  // OBJ is conventionally Y-up; STL, 3MF and PLY from slicers and CAD are Z-up.
  return { ...data, name, format: ext.toUpperCase(), upAxis: ext === 'obj' ? 'y' : 'z' };
}

function soup(geo: THREE.BufferGeometry, matrix?: THREE.Matrix4): Float32Array {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const attr = g.getAttribute('position');
  const out = new Float32Array(attr.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < attr.count; i++) {
    v.fromBufferAttribute(attr, i);
    if (matrix) v.applyMatrix4(matrix);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  if (g !== geo) g.dispose();
  return out;
}

function fromGroup(group: THREE.Object3D): { positions: Float32Array; color: RGB | null } {
  group.updateMatrixWorld(true);
  const parts: Float32Array[] = [];
  let color: RGB | null = null;
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    parts.push(soup(mesh.geometry, mesh.matrixWorld));
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
    if (!color && mat?.color && !(mat.color.r === 1 && mat.color.g === 1 && mat.color.b === 1)) {
      const c = mat.color.clone().convertLinearToSRGB();
      color = [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
    }
    color ??= averageVertexColor(mesh.geometry);
  });
  const total = parts.reduce((s, p) => s + p.length, 0);
  const positions = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    positions.set(p, off);
    off += p.length;
  }
  return { positions, color };
}

function averageVertexColor(geo: THREE.BufferGeometry): RGB | null {
  const c = geo.getAttribute('color');
  if (!c || !c.count) return null;
  let r = 0, g = 0, b = 0;
  const step = Math.max(1, Math.floor(c.count / 5000));
  let n = 0;
  for (let i = 0; i < c.count; i += step) {
    r += c.getX(i);
    g += c.getY(i);
    b += c.getZ(i);
    n++;
  }
  const scale = c.normalized || c.array instanceof Float32Array ? 255 : 1;
  const col = new THREE.Color(r / n, g / n, b / n);
  if (scale === 255) col.convertLinearToSRGB();
  return [Math.round(col.r * scale), Math.round(col.g * scale), Math.round(col.b * scale)].map((v) => Math.max(0, Math.min(255, v))) as RGB;
}
