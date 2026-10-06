import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { legacySnapshotAddress } from '../../protocol/src/manifest';
import { normalizeTarget, ruleTypes, type RuleType } from './targets';
export { normalizeTarget, ruleTypes, type RuleType } from './targets';

const hex = /^[a-f0-9]{64}$/;
const rule = z.object({
  type: z.enum(ruleTypes),
  target: z.string().max(512),
  reason: z.string().max(500),
  actor: z.string().regex(hex),
  at: z.number().int(),
});
const actions = [
  'block',
  'unblock',
  'feature',
  'unfeature',
  'feature-up',
  'feature-down',
  'admin-add',
  'admin-remove',
  'backend-allow',
  'backend-revoke',
] as const;
const audit = rule.extend({
  action: z.enum(actions),
  revision: z.number().int(),
  requestId: z.string().regex(hex),
});
const schema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  rules: z.array(rule).max(10000),
  featured: z
    .array(rule.extend({ type: z.enum(['address', 'event']) }))
    .max(256)
    .default([]),
  admins: z.array(z.string().regex(hex)).max(32).default([]),
  backendCreators: z.array(z.string().regex(hex)).max(256).default([]),
  audit: z.array(audit).max(500),
  used: z.array(z.object({ id: z.string().regex(hex), expires: z.number().int() })).max(1000),
});
export type Policy = z.infer<typeof schema>;
const empty = (): Policy => ({
  version: 1,
  revision: 0,
  rules: [],
  featured: [],
  admins: [],
  backendCreators: [],
  audit: [],
  used: [],
});
export class PolicyError extends Error {
  constructor(
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}
export function policyPath() {
  return process.env.SPACE_MODERATION_FILE ? resolve(process.env.SPACE_MODERATION_FILE) : null;
}
let cached: { path: string; stamp: string; policy: Policy; keys: Set<string> } | undefined;
export function readPolicy(path = policyPath()) {
  if (!path) return empty();
  try {
    const stat = statSync(path);
    if (stat.size > 8 * 1024 * 1024) throw new Error();
    const stamp = `${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
    if (cached?.path === path && cached.stamp === stamp) return cached.policy;
    const policy = schema.parse(JSON.parse(readFileSync(path, 'utf8')));
    const keys = new Set<string>();
    for (const r of policy.rules) {
      if (normalizeTarget(r.type, r.target) !== r.target || keys.has(`${r.type}:${r.target}`))
        throw new Error();
      keys.add(`${r.type}:${r.target}`);
    }
    if (
      new Set(policy.admins).size !== policy.admins.length ||
      new Set(policy.backendCreators).size !== policy.backendCreators.length
    )
      throw new Error();
    const featured = new Set<string>();
    for (const r of policy.featured) {
      const key = `${r.type}:${r.target}`;
      if (normalizeTarget(r.type, r.target) !== r.target || featured.has(key)) throw new Error();
      featured.add(key);
    }
    cached = { path, stamp, policy, keys };
    return policy;
  } catch {
    throw new PolicyError('Moderation policy is unavailable.');
  }
}
export function blocked(type: RuleType, target: string) {
  const path = policyPath();
  if (!path) return false;
  readPolicy(path); // A configured but missing/corrupt policy fails closed.
  return cached!.keys.has(`${type}:${target}`);
}
export function manifestBlocked(event: {
  id: string;
  pubkey: string;
  kind: number;
  tags: string[][];
}) {
  if (blocked('pubkey', event.pubkey) || blocked('event', event.id)) return true;
  if (
    [35129, 15129].includes(event.kind) &&
    blocked(
      'address',
      `${event.kind}:${event.pubkey}:${event.kind === 15129 ? '' : (event.tags.find((t) => t[0] === 'd')?.[1] ?? '')}`,
    )
  )
    return true;
  const snapshotAddress = legacySnapshotAddress(event);
  if (snapshotAddress && blocked('address', snapshotAddress)) return true;
  return event.tags.some(
    (t) =>
      (t[0] === 'path' && !!t[2] && blocked('hash', t[2])) ||
      (t[0] === 'x' && !!t[1] && blocked('hash', t[1])),
  );
}
export function initializePolicy(path: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (!existsSync(path)) {
    try {
      writeFileSync(path, JSON.stringify(empty()), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  readPolicy(path);
}
/** Site curation never changes a creator's signed manifest or bypasses moderation. */
export function manifestFeatured(event: {
  id: string;
  pubkey: string;
  kind: number;
  tags: string[][];
}) {
  const address = [35129, 15129].includes(event.kind)
    ? `${event.kind}:${event.pubkey}:${event.kind === 15129 ? '' : (event.tags.find((t) => t[0] === 'd')?.[1] ?? '')}`
    : null;
  return readPolicy().featured.some((item) =>
    item.type === 'event'
      ? item.target === event.id
      : item.target === address || item.target === legacySnapshotAddress(event),
  );
}
export const actionSchema = z
  .object({
    action: z.enum(actions),
    type: z.enum(ruleTypes),
    target: z.string().min(1).max(4096),
    reason: z.string().trim().min(1).max(500),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (input) =>
      (!input.action.startsWith('feature') && input.action !== 'unfeature') ||
      ['address', 'event'].includes(input.type),
    'Only napplets and revisions can be featured.',
  )
  .refine(
    (input) => !input.action.startsWith('admin-') || input.type === 'pubkey',
    'Administrators must be public keys.',
  )
  .refine(
    (input) => !input.action.startsWith('backend-') || input.type === 'pubkey',
    'Backend creators must be public keys.',
  );
/** Environment keys are recovery administrators and cannot be removed through the UI. */
export function configuredAdmins() {
  return [
    ...new Set(
      (process.env.SPACE_ADMIN_PUBKEYS ?? '')
        .split(',')
        .filter((s) => s.trim())
        .map((s) => normalizeTarget('pubkey', s)),
    ),
  ];
}
export function effectiveAdmins(policy = readPolicy()) {
  return [...new Set([...configuredAdmins(), ...policy.admins])];
}
/** Operator bootstrap grants stay visible and cannot be removed by a browser edit. */
export function configuredBackendCreators() {
  return [
    ...new Set(
      (process.env.SPACE_DYNAMIC_CREATORS ?? '')
        .split(',')
        .filter((s) => s.trim())
        .map((s) => normalizeTarget('pubkey', s)),
    ),
  ];
}
export function effectiveBackendCreators(policy = readPolicy()) {
  const blockedAuthors = new Set(
    policy.rules.filter((r) => r.type === 'pubkey').map((r) => r.target),
  );
  return [...new Set([...configuredBackendCreators(), ...policy.backendCreators])].filter(
    (key) => !blockedAuthors.has(key),
  );
}
export type ModerationAction = z.infer<typeof actionSchema>;
/** One atomic document contains rules, replay receipts and the bounded audit trail. */
export function updatePolicy(
  input: ModerationAction,
  actor: string,
  requestId: string,
  now = Math.floor(Date.now() / 1000),
  authorize = false,
) {
  input = actionSchema.parse(input);
  const path = policyPath();
  if (!path) throw new PolicyError('Moderation is not configured.');
  const target = normalizeTarget(input.type, input.target);
  const lockPath = `${path}.lock`,
    temporary = `${path}.${process.pid}.tmp`;
  let lock: number;
  try {
    lock = openSync(lockPath, 'wx', 0o600);
  } catch {
    throw new PolicyError('Another policy update is in progress; retry.', 409);
  }
  try {
    const current = readPolicy(path);
    // Check again while holding the write lock: a revoked admin cannot race a request.
    if (
      (authorize || input.action.startsWith('admin-') || input.action.startsWith('backend-')) &&
      !effectiveAdmins(current).includes(actor)
    )
      throw new PolicyError('This account is not an administrator.', 403);
    if (current.used.some((r) => r.id === requestId && r.expires >= now))
      throw new PolicyError('This signed request was already used.', 409);
    if (input.revision !== current.revision)
      throw new PolicyError('Policy changed. Refresh before trying again.', 409);
    const used = current.used.filter((r) => r.expires >= now);
    if (used.length >= 1000) throw new PolicyError('Admin request budget exceeded.', 429);
    const rules = current.rules.filter(
      (r) =>
        !['block', 'unblock'].includes(input.action) ||
        r.type !== input.type ||
        r.target !== target,
    );
    const featured = current.featured.filter(
      (r) =>
        !['feature', 'unfeature'].includes(input.action) ||
        r.type !== input.type ||
        r.target !== target,
    );
    const admins = [...current.admins];
    const backendCreators = [...current.backendCreators];
    const item = { type: input.type, target, reason: input.reason, actor, at: now };
    if (input.action === 'block') rules.push(item);
    if (input.action === 'feature' && (item.type === 'address' || item.type === 'event'))
      featured.push({ ...item, type: item.type });
    if (['feature-up', 'feature-down'].includes(input.action)) {
      const position = featured.findIndex((r) => r.type === input.type && r.target === target);
      if (position < 0) throw new PolicyError('This selection is no longer featured.', 409);
      const next = position + (input.action === 'feature-up' ? -1 : 1);
      if (next < 0 || next >= featured.length)
        throw new PolicyError('This selection cannot move further.', 409);
      [featured[position], featured[next]] = [featured[next], featured[position]];
    }
    if (input.action === 'admin-add') {
      if (effectiveAdmins(current).includes(target))
        throw new PolicyError('This account is already an administrator.', 409);
      if (admins.length >= 32) throw new PolicyError('Administrator limit reached.', 409);
      admins.push(target);
    }
    if (input.action === 'admin-remove') {
      if (configuredAdmins().includes(target))
        throw new PolicyError('Recovery administrators are managed in server configuration.', 409);
      const position = admins.indexOf(target);
      if (position < 0) throw new PolicyError('This account is not an administrator.', 409);
      if (effectiveAdmins(current).length <= 1)
        throw new PolicyError('Keep at least one administrator.', 409);
      admins.splice(position, 1);
    }
    if (input.action === 'backend-allow') {
      if (current.rules.some((r) => r.type === 'pubkey' && r.target === target))
        throw new PolicyError(
          'Unblock this creator before granting backend deployment access.',
          409,
        );
      if (configuredBackendCreators().includes(target) || backendCreators.includes(target))
        throw new PolicyError('This account already has backend deployment access.', 409);
      if (backendCreators.length >= 256)
        throw new PolicyError('Backend creator limit reached.', 409);
      backendCreators.push(target);
    }
    if (input.action === 'backend-revoke') {
      if (configuredBackendCreators().includes(target))
        throw new PolicyError(
          'Operator-granted deployment access is managed in server configuration.',
          409,
        );
      const position = backendCreators.indexOf(target);
      if (position < 0) throw new PolicyError('This account has no backend deployment grant.', 409);
      backendCreators.splice(position, 1);
    }
    if (featured.length > 256) throw new PolicyError('Featured collection capacity reached.', 409);
    if (rules.length > 10000) throw new PolicyError('Block list capacity reached.', 409);
    const next: Policy = {
      version: 1,
      revision: current.revision + 1,
      rules,
      featured,
      admins,
      backendCreators,
      audit: [
        ...current.audit,
        { ...item, action: input.action, revision: current.revision + 1, requestId },
      ].slice(-500),
      used: [...used, { id: requestId, expires: now + 120 }],
    };
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized) > 8 * 1024 * 1024)
      throw new PolicyError('Policy storage capacity reached.', 409);
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(fd, serialized);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
    const dir = openSync(dirname(path), 'r');
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
    return next;
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
