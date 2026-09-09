// Read-only helper invoked with the repository's existing TS resolver. No model.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { discoverAgents } from '../src/resources/extensions/subagent/agents.ts';

const root = fs.realpathSync(process.argv[2]);
const scout = discoverAgents(root, 'project').agents.find(a => a.name === 'scout');
if (!scout || scout.source !== 'project' || scout.filePath !== path.join(root, '.gsd/agents/scout.md')) throw new Error('Expected the workspace-local scout override');
const bytes = fs.readFileSync(scout.filePath);
const hash = value => createHash('sha256').update(value).digest('hex');
process.stdout.write(JSON.stringify({
  schemaVersion: 'gsd.scout-load/v1', evidenceKind: 'actual-loader-probe',
  definitionSha256: hash(bytes), loadedDefinitionSha256: hash(bytes), loadedPromptSha256: hash(scout.systemPrompt),
  source: scout.source, relativePath: '.gsd/agents/scout.md', tools: scout.tools,
  modelOverride: scout.model ?? null, effortOverride: scout.thinking ?? null,
}) + '\n');
