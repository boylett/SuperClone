#!/usr/bin/env node

const { execSync } = require('node:child_process');
const { existsSync, mkdirSync, rmSync, readdirSync, renameSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const distDir = join(root, 'dist');
const outDir = join(root, 'out');
const pkg = require(join(root, 'package.json'));

function run(cmd) {
	console.log(`\x1b[36m> ${cmd}\x1b[0m`);
	execSync(cmd, { cwd: root, stdio: 'inherit' });
}

function clean() {
	for (const dir of [distDir, outDir]) {
		if (existsSync(dir)) {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	mkdirSync(distDir, { recursive: true });
}

function compile() {
	run('npx tsc -p ./');
}

function packageVsix() {
	const fileName = `${pkg.name}-${pkg.version}.vsix`;
	const target = join(distDir, fileName);

	run(`npx vsce package --out "${target}"`);

	return target;
}

function main() {
	console.log(`\x1b[35mBuilding ${pkg.displayName || pkg.name} v${pkg.version}\x1b[0m`);

	clean();
	compile();

	const vsix = packageVsix();
	const size = (statSync(vsix).size / 1024).toFixed(1);

	console.log(`\x1b[32m\nPackaged: ${vsix} (${size} KB)\x1b[0m`);
}

main();
