import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cleanLabel(value) {
  return value
    .replace(/\.png$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function emptyDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await ensureDir(dir);
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function getDirectories(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function resolveLayerDirectory(sourceDir, layerName) {
  const target = layerName.trim().toLowerCase();
  const dirs = await getDirectories(sourceDir);
  const match = dirs.find((dir) => dir.trim().toLowerCase() === target);
  if (!match) {
    throw new Error(`Layer directory not found for "${layerName}" in ${sourceDir}`);
  }
  return path.join(sourceDir, match);
}

async function loadLayerItems(sourceDir, layerName) {
  const layerDir = await resolveLayerDirectory(sourceDir, layerName);
  const entries = await fs.readdir(layerDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
    .map((entry) => ({
      fileName: entry.name,
      filePath: path.join(layerDir, entry.name),
      value: cleanLabel(entry.name),
    }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName, "en"));

  if (!files.length) {
    throw new Error(`No PNG files in layer directory ${layerDir}`);
  }

  return {
    traitType: cleanLabel(layerName),
    files,
  };
}

function toAttributes(combo, traits) {
  return combo.map((pickedIndex, idx) => ({
    trait_type: traits[idx].traitType,
    value: traits[idx].files[pickedIndex].value,
  }));
}

function pickUniqueCombinations(traits, totalSupply, rand) {
  const maxUnique = traits.reduce((acc, trait) => acc * trait.files.length, 1);
  if (totalSupply > maxUnique) {
    throw new Error(
      `Requested totalSupply=${totalSupply} exceeds max unique combinations=${maxUnique}`
    );
  }

  const combinations = [];
  const seen = new Set();
  let guard = 0;
  const maxAttempts = totalSupply * 1000;

  while (combinations.length < totalSupply) {
    guard += 1;
    if (guard > maxAttempts) {
      throw new Error("Failed to generate enough unique combinations");
    }

    const picks = traits.map((trait) => Math.floor(rand() * trait.files.length));
    const key = picks.join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    combinations.push(picks);
  }

  return combinations;
}

async function composeImage(outputPath, combo, traits) {
  const basePath = traits[0].files[combo[0]].filePath;
  const overlays = [];
  for (let i = 1; i < combo.length; i += 1) {
    overlays.push({ input: traits[i].files[combo[i]].filePath });
  }
  await sharp(basePath).composite(overlays).png({ compressionLevel: 9 }).toFile(outputPath);
}

async function writeJson(filePath, content) {
  await fs.writeFile(filePath, JSON.stringify(content, null, 2));
}

async function main() {
  const configPath = path.resolve("config.json");
  if (!(await fileExists(configPath))) {
    throw new Error(`Missing config file: ${configPath}`);
  }

  const configRaw = await fs.readFile(configPath, "utf8");
  const config = JSON.parse(configRaw);
  const {
    sourceDir,
    outputDir,
    totalSupply,
    collectionName,
    description,
    imageBaseUri,
    externalUrl,
    sellerFeeBasisPoints,
    feeRecipient,
    seed,
    layers,
  } = config;

  if (!sourceDir || !outputDir || !totalSupply || !collectionName || !description || !layers?.length) {
    throw new Error("Invalid config.json. Required: sourceDir, outputDir, totalSupply, collectionName, description, layers");
  }

  const imagesDir = path.join(outputDir, "images");
  const metadataDir = path.join(outputDir, "metadata");
  await emptyDir(imagesDir);
  await emptyDir(metadataDir);

  const traits = [];
  for (const layerName of layers) {
    const trait = await loadLayerItems(sourceDir, layerName);
    traits.push(trait);
  }

  const rand = mulberry32(Number(seed) || Date.now());
  const combos = pickUniqueCombinations(traits, Number(totalSupply), rand);

  for (let tokenId = 1; tokenId <= combos.length; tokenId += 1) {
    const combo = combos[tokenId - 1];
    const imageOut = path.join(imagesDir, `${tokenId}.png`);
    await composeImage(imageOut, combo, traits);

    const attributes = toAttributes(combo, traits);
    const metadata = {
      name: `${collectionName} #${tokenId}`,
      description,
      image: `${imageBaseUri}${tokenId}.png`,
      attributes,
    };
    if (externalUrl && String(externalUrl).trim()) {
      metadata.external_url = String(externalUrl).trim();
    }

    await writeJson(path.join(metadataDir, `${tokenId}.json`), metadata);

    if (tokenId % 100 === 0 || tokenId === combos.length) {
      console.log(`Generated ${tokenId}/${combos.length}`);
    }
  }

  const contractMetadata = {
    name: collectionName,
    description,
    image: `${imageBaseUri}collection.png`,
    seller_fee_basis_points: Number(sellerFeeBasisPoints) || 0,
    fee_recipient: feeRecipient || "0x0000000000000000000000000000000000000000",
  };

  if (externalUrl && String(externalUrl).trim()) {
    contractMetadata.external_link = String(externalUrl).trim();
  }

  await writeJson(path.join(outputDir, "contract.json"), contractMetadata);
  await writeJson(path.join(outputDir, "mint-plan.json"), {
    generatedAt: new Date().toISOString(),
    totalSupply: combos.length,
    sourceDir,
    outputDir,
    layers: traits.map((trait) => ({
      traitType: trait.traitType,
      count: trait.files.length,
    })),
    imageBaseUri,
    seed,
  });

  console.log("Done.");
  console.log(`Images: ${imagesDir}`);
  console.log(`Metadata: ${metadataDir}`);
  console.log(`Contract metadata: ${path.join(outputDir, "contract.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
