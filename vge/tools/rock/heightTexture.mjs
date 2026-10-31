import sharp from 'sharp';

export async function loadHeightTexture(path) {
  const { data, info } = await sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true });
  const values = Float32Array.from(data, (v) => v / 255);
  const at = (x, y) => values[(((y % info.height) + info.height) % info.height) * info.width + (((x % info.width) + info.width) % info.width)];
  return (u, v) => {
    const x = u * info.width;
    const y = v * info.height;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
    const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}
