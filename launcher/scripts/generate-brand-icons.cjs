// Rasterize the editable vector source with macOS ImageIO; no network required.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const assets = path.resolve(__dirname, "../assets");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-icons-"));
try {
  execFileSync("sips", ["-s", "format", "png", path.join(assets, "icon.svg"), "--out", path.join(assets, "icon.png")]);
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = sizes.map(size => {
    const output = path.join(temp, `${size}.png`);
    execFileSync("sips", ["-z", String(size), String(size), path.join(assets, "icon.png"), "--out", output]);
    return fs.readFileSync(output);
  });
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  fs.writeFileSync(path.join(assets, "icon.ico"), Buffer.concat([header, ...images]));
  console.log("NEKODEX icon.png (1024px) and icon.ico (16–256px) generated.");
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
