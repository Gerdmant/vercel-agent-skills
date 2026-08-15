#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const schema = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
const baseUrl = process.argv[2];
const outputDirectory = 'dist';
const archiveEnvironment = {
  ...process.env,
  GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
  GIT_AUTHOR_EMAIL: 'agent-skills@vercel.com',
  GIT_AUTHOR_NAME: 'Agent Skills',
  GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
  GIT_COMMITTER_EMAIL: 'agent-skills@vercel.com',
  GIT_COMMITTER_NAME: 'Agent Skills',
};

if (!baseUrl) {
  throw new Error(
    'Usage: node scripts/build-discovery-index.mjs <artifact-base-url>',
  );
}

const readMetadata = (path) => {
  const source = readFileSync(path, 'utf8');
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (!frontmatter) throw new Error(`Missing frontmatter in ${path}`);

  const lines = frontmatter.split(/\r?\n/);
  const name = lines.find((line) => line.startsWith('name:'))?.slice(5).trim();
  const descriptionLine = lines.findIndex((line) =>
    line.startsWith('description:'),
  );
  if (!name || descriptionLine === -1) {
    throw new Error(`Missing name or description in ${path}`);
  }

  const inlineDescription = lines[descriptionLine].slice(12).trim();
  const descriptionLines = [];
  for (
    let index = descriptionLine + 1;
    index < lines.length && /^\s/.test(lines[index]);
    index++
  ) {
    descriptionLines.push(lines[index].trim());
  }
  const description = inlineDescription
    ? inlineDescription.startsWith('"')
      ? JSON.parse(inlineDescription)
      : inlineDescription.replaceAll('\\"', '"')
    : descriptionLines.join(' ');

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || !description) {
    throw new Error(`Invalid name or description in ${path}`);
  }

  return { name, description };
};

const createArchive = (directory, name) => {
  const tree = execFileSync(
    'git',
    ['rev-parse', `HEAD:skills/${directory}`],
    { encoding: 'utf8' },
  ).trim();
  const commit = execFileSync('git', ['commit-tree', tree], {
    encoding: 'utf8',
    env: archiveEnvironment,
    input: 'Agent Skills archive\n',
  }).trim();
  const tar = execFileSync('git', [
    'archive',
    '--format=tar',
    `--prefix=${name}/`,
    commit,
  ]);
  return execFileSync('gzip', ['-n', '-9', '-c'], { input: tar });
};

rmSync(outputDirectory, { force: true, recursive: true });
mkdirSync(outputDirectory);

const skills = readdirSync('skills', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map(({ name: directory }) => {
    const metadata = readMetadata(join('skills', directory, 'SKILL.md'));
    const artifact = createArchive(directory, metadata.name);
    const filename = `${metadata.name}.tar.gz`;
    writeFileSync(join(outputDirectory, filename), artifact);

    return {
      ...metadata,
      type: 'archive',
      url: `${baseUrl.replace(/\/$/, '')}/${filename}`,
      digest: `sha256:${createHash('sha256').update(artifact).digest('hex')}`,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(
  join(outputDirectory, 'index.json'),
  `${JSON.stringify({ $schema: schema, skills }, null, 2)}\n`,
);

console.log(`Published ${skills.length} skills to ${outputDirectory}`);
