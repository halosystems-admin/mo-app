#!/usr/bin/env node
import 'dotenv/config';
import { spawnSync } from 'node:child_process';

const port = process.env.PORT || '3001';
const url = `http://localhost:${port}/api/health`;
const result = spawnSync('npx', ['wait-on', url], { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
