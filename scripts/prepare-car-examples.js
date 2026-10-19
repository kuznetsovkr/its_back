const path = require("node:path");
const fs = require("node:fs/promises");
const sharp = require("sharp");

const prepare = async (source, destination) => {
  if (!source || !destination) throw new Error("Usage: node scripts/prepare-car-examples.js <source> <destination>");
  await fs.mkdir(destination, { recursive: true });
  for (const [name, key] of [["photo_2026-10-19_00-06-41.jpg", "simple"],
    ["photo_2026-10-19_00-06-56.jpg", "medium"], ["photo_2026-10-19_00-06-59.jpg", "complex"]]) {
    const result = await sharp(path.join(source, name)).rotate().resize({ width: 720, withoutEnlargement: true })
      .webp({ quality: 82, effort: 6 }).toFile(path.join(destination, `${key}.webp`));
    console.log(`${key}: ${result.width}x${result.height}, ${result.size} bytes`);
  }
};
if (require.main === module) prepare(process.argv[2], process.argv[3]).catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepare };
