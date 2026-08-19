/**
 * Vendors the Solidity dependencies into contracts/lib.
 *
 * Foundry normally pulls these in as git submodules, but this repo keeps them
 * out of version control and fetches pinned release tarballs instead, so a
 * clone does not need submodule wrangling to run `forge test`.
 *
 * Usage: pnpm contracts:install
 */
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {readdirSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contracts = join(here, "..", "contracts");
const lib = join(contracts, "lib");
const tmp = join(contracts, ".libtmp");

const DEPENDENCIES = [
  {
    name: "openzeppelin-contracts",
    url: "https://github.com/OpenZeppelin/openzeppelin-contracts/archive/refs/tags/v5.7.0.zip",
    unpacked: "openzeppelin-contracts-5.7.0",
  },
  {
    name: "forge-std",
    url: "https://github.com/foundry-rs/forge-std/archive/refs/tags/v1.16.2.zip",
    unpacked: "forge-std-1.16.2",
  },
  {
    // forge-std imports ds-test, which has no tagged releases.
    name: "ds-test",
    url: "https://github.com/dapphub/ds-test/archive/refs/heads/master.zip",
    unpacked: "ds-test-master",
  },
];

async function install(dependency) {
  const target = join(lib, dependency.name);
  if (existsSync(target) && process.argv.includes("--skip-existing")) {
    console.log(`- ${dependency.name} already present, skipping`);
    return;
  }

  console.log(`- fetching ${dependency.name}`);
  const response = await fetch(dependency.url);
  if (!response.ok) {
    throw new Error(`${dependency.url} responded ${response.status}`);
  }

  const archive = join(tmp, `${dependency.name}.zip`);
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));

  // bsdtar ships with Windows 10+, macOS and most Linux images, and reads zips.
  execFileSync("tar", ["-xf", archive, "-C", tmp], {stdio: "inherit"});
  rmSync(archive, {force: true});

  const extracted = join(tmp, dependency.unpacked);
  if (!existsSync(extracted)) {
    const found = readdirSync(tmp).join(", ");
    throw new Error(`expected ${dependency.unpacked} in the archive, found: ${found}`);
  }

  rmSync(target, {recursive: true, force: true});
  renameSync(extracted, target);
}

async function main() {
  mkdirSync(lib, {recursive: true});
  rmSync(tmp, {recursive: true, force: true});
  mkdirSync(tmp, {recursive: true});

  try {
    for (const dependency of DEPENDENCIES) {
      await install(dependency);
    }
  } finally {
    rmSync(tmp, {recursive: true, force: true});
  }

  console.log("\nContract libraries installed. Run `forge test` in contracts/.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
