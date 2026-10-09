import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface RawDocument { name: string; fields?: Record<string, unknown>; createTime?: string; updateTime?: string }
interface AuthUser { localId: string; emailVerified?: boolean; disabled?: boolean; customAttributes?: string; [field: string]: unknown }
export interface OperationTarget { projectId: string; firestoreOrigin?: string; authOrigin?: string }
interface BackupManifest {
  schema: 'kilog-backup-v1'; projectId: string; database: '(default)'; createdAt: string; completedAt: string;
  readTime: string | null; consistency: 'readTime' | 'emulator-sequential'; documents: number; missingParents: number;
  rootCollections: string[]; authUsers: number; documentHash: string; authHash: string;
}
interface Change { path: string; before: RawDocument | null; fields: Record<string, unknown> | null }
export interface OperationPlan {
  schema: 'kilog-operation-v1'; kind: 'migrate-roles' | 'recover-admin' | 'restore'; projectId: string;
  backupHash: string; createdAt: string; changes: Change[]; skipped: { path: string; reason: string }[];
}
interface Journal { schema: 'kilog-journal-v1'; projectId: string; planHash: string; changes: Change[]; after: (RawDocument | null)[]; state: 'prepared' | 'committed' | 'rolled-back' }
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backupRoot = resolve(workspace, 'output', 'backups');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const fieldHash = (document: RawDocument | null) => hash(canonical(document ? document.fields || {} : null));
export const planHash = (plan: OperationPlan) => hash(canonical(plan));
function loopback(origin: string) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('Emulator origin must be a loopback HTTP origin.');
  return url.origin;
}
export function validateTarget(target: OperationTarget) {
  if (target.firestoreOrigin || target.authOrigin) {
    if (!/^demo-kilog-operations-[a-z0-9-]+$/.test(target.projectId) || !target.firestoreOrigin || !target.authOrigin) throw new Error('Operations emulator requires its own demo-kilog-operations-* project and both explicit loopback origins.');
    return { ...target, firestoreOrigin: loopback(target.firestoreOrigin), authOrigin: loopback(target.authOrigin) };
  }
  if (target.projectId !== 'kilo-g') throw new Error('Production project must be exactly kilo-g.');
  return target;
}
function safePath(path: string) {
  const parts = path.split('/');
  if (!path || parts.length % 2 || parts.some(part => !part || part === '.' || part === '..')) throw new Error('Invalid Firestore document path.');
  return path;
}
function uid(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\/\u0000-\u001f]/.test(value) && !['.', '..'].includes(value); }
const string = (value: string) => ({ stringValue: value });
const number = (value: number) => ({ integerValue: String(value) });
const timestamp = (value: string) => ({ timestampValue: value });

// The existing Firebase CLI session is the sole production credential source.
async function cliToken() {
  const moduleName = 'firebase-tools/lib/auth.js';
  const auth = await import(moduleName) as {
    getProjectDefaultAccount(directory: string): { tokens: { refresh_token?: string; scopes?: string[] } } | undefined;
    getAccessToken(refreshToken: string, scopes: string[]): Promise<{ access_token?: string }>;
  };
  const account = auth.getProjectDefaultAccount(workspace);
  if (!account?.tokens?.refresh_token) throw new Error('Existing Firebase CLI login is required.');
  try {
    const tokens = await auth.getAccessToken(account.tokens.refresh_token, account.tokens.scopes || ['https://www.googleapis.com/auth/cloud-platform']);
    if (!tokens?.access_token) throw new Error();
    return tokens.access_token as string;
  } catch { throw new Error('Firebase CLI credentials could not be refreshed; no operation was performed.'); }
}

export function createOperationsClient(input: OperationTarget, fetcher: typeof fetch = fetch) {
  const target = validateTarget(input), emulator = !!target.firestoreOrigin;
  const prefix = `projects/${target.projectId}/databases/(default)/documents`;
  const firestore = target.firestoreOrigin || 'https://firestore.googleapis.com';
  const auth = target.authOrigin ? `${target.authOrigin}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  const resource = (path = '') => `${prefix}${path ? `/${path}` : ''}`;
  const encoded = (path = '') => resource(path).split('/').map(encodeURIComponent).join('/');
  async function request(url: string, method = 'GET', body?: unknown, missing = false) {
    const response = await fetcher(url, { method, headers: { Authorization: `Bearer ${emulator ? 'owner' : await cliToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if (missing && response.status === 404) return null;
    if (!response.ok) throw new Error(`Firebase operation failed with HTTP ${response.status}; no response body or credentials were logged.`);
    return await response.json();
  }
  async function users(): Promise<AuthUser[]> {
    const result: AuthUser[] = [];
    let page = '';
    do {
      const query = new URLSearchParams({ maxResults: '1000', ...(page ? { nextPageToken: page } : {}) });
      const data = await request(`${auth}/v1/projects/${target.projectId}/accounts:batchGet?${query}`);
      result.push(...(data.users || [])); page = data.nextPageToken || '';
    } while (page);
    return result;
  }
  async function get(path: string): Promise<RawDocument | null> { return request(`${firestore}/v1/${encoded(safePath(path))}`, 'GET', undefined, true); }
  async function collections(path = '', readTime?: string) {
    const values: string[] = []; let page = '';
    do {
      const result = await request(`${firestore}/v1/${encoded(path)}:listCollectionIds`, 'POST', { pageSize: 100, ...(page ? { pageToken: page } : {}), ...(readTime ? { readTime } : {}) });
      values.push(...(result.collectionIds || [])); page = result.nextPageToken || '';
    } while (page);
    return values;
  }
  async function* documents(collection: string, readTime?: string): AsyncGenerator<RawDocument> {
    let page = '';
    do {
      const query = new URLSearchParams({ pageSize: '100', showMissing: 'true', ...(page ? { pageToken: page } : {}), ...(readTime ? { readTime } : {}) });
      const result = await request(`${firestore}/v1/${encoded(collection)}?${query}`);
      for (const document of result.documents || []) yield document;
      page = result.nextPageToken || '';
    } while (page);
  }
  function path(document: RawDocument) {
    if (!document.name.startsWith(`${prefix}/`)) throw new Error('Snapshot document belongs to another project or database.');
    return safePath(document.name.slice(prefix.length + 1));
  }
  async function commit(changes: Change[]) {
    if (!changes.length) return [];
    if (changes.length > 400) throw new Error('Operation exceeds the bounded 400-write atomic commit; split the reviewed recovery selection.');
    const writes = changes.map(change => {
      const currentDocument = change.before ? { updateTime: change.before.updateTime } : { exists: false };
      if (change.before && !change.before.updateTime) throw new Error('A recovery precondition requires updateTime.');
      return change.fields === null ? { delete: resource(safePath(change.path)), currentDocument } : { update: { name: resource(safePath(change.path)), fields: change.fields }, currentDocument };
    });
    const result = await request(`${firestore}/v1/${encoded()}:commit`, 'POST', { writes });
    return result.writeResults as { updateTime?: string }[];
  }
  return { target, emulator, prefix, resource, path, users, get, collections, documents, commit };
}
export type OperationsClient = ReturnType<typeof createOperationsClient>;

function privateLocation(path: string) {
  const absolute = resolve(path), rel = relative(backupRoot, absolute);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error('Backup files must be inside this workspace output/backups.');
  for (let parent = dirname(absolute); parent.startsWith(backupRoot); parent = dirname(parent)) {
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw new Error('Backup directories cannot be symlinks.');
    if (parent === backupRoot) break;
  }
  return absolute;
}
const aclScript = `
$ErrorActionPreference='Stop'
$target=$env:KILOG_BACKUP_DIRECTORY
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($env:KILOG_SET_BACKUP_ACL -eq '1') {
  $acl=Get-Acl -LiteralPath $target
  $acl.SetAccessRuleProtection($true,$false)
  foreach($rule in @($acl.Access)){[void]$acl.RemoveAccessRuleSpecific($rule)}
  $acl.SetOwner($identity.User)
  $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity.User,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $target -AclObject $acl
}
$acl=Get-Acl -LiteralPath $target
if(-not $acl.AreAccessRulesProtected){throw 'Backup ACL inherits permissions'}
$rules=@($acl.Access)
if($rules.Count -ne 1 -or $rules[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $identity.User.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].IsInherited){throw 'Backup ACL is not current-user only'}
if((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Backup directory is a reparse point'}
`;
function windowsAcl(path: string, set = false) {
  // A PowerShell 7 parent may pass module paths incompatible with Windows PowerShell 5.
  const env = { ...process.env, PSModulePath: `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\Modules`, KILOG_BACKUP_DIRECTORY: path, KILOG_SET_BACKUP_ACL: set ? '1' : '' };
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', aclScript], { env, stdio: 'pipe' });
}
export function protectDirectory(path: string) {
  const absolute = privateLocation(resolve(path, 'manifest.json'));
  execFileSync('git', ['check-ignore', '--quiet', '--no-index', relative(workspace, absolute)], { cwd: workspace, stdio: 'pipe' });
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') windowsAcl(dirname(absolute), true);
  else chmodSync(dirname(absolute), 0o700);
  if (realpathSync(dirname(absolute)).toLowerCase() !== dirname(absolute).toLowerCase()) throw new Error('Backup directory resolves outside its explicit workspace path.');
  return dirname(absolute);
}
function verifyDirectory(path: string) {
  privateLocation(resolve(path, 'manifest.json'));
  if (process.platform === 'win32') windowsAcl(path);
  else if (statSync(path).mode & 0o077 || statSync(path).uid !== process.getuid?.()) throw new Error('Backup directory must be owned and readable only by the current user.');
  const actual = realpathSync(path), expected = resolve(path);
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error('Backup directory resolves outside the expected path.');
}
function writePrivate(path: string, value: unknown, replace = false) {
  const destination = privateLocation(path); verifyDirectory(dirname(destination));
  const temporary = `${destination}.${randomUUID()}.tmp`;
  if (!replace && existsSync(destination)) throw new Error('A backup or plan file would be overwritten.');
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, destination);
}

export async function exportBackup(client: OperationsClient, directory = resolve(backupRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`), maximumDocuments = 20000) {
  const destination = protectDirectory(directory), documentFile = privateLocation(resolve(destination, 'documents.ndjson'));
  if (existsSync(documentFile) || existsSync(resolve(destination, 'manifest.json'))) throw new Error('Export requires a new backup directory.');
  if (!Number.isSafeInteger(maximumDocuments) || maximumDocuments < 1 || maximumDocuments > 50000) throw new Error('Export document budget must be 1..50000; check remaining Firestore Usage first.');
  writeFileSync(documentFile, '', { mode: 0o600, flag: 'wx' });
  const createdAt = new Date().toISOString(), readTime = client.emulator ? undefined : new Date(Date.now() - 5000).toISOString();
  const rootCollections = await client.collections('', readTime), queue = [...rootCollections], digest = createHash('sha256');
  let documents = 0, missingParents = 0;
  for (let index = 0; index < queue.length; index++) {
    if (Date.now() - Date.parse(createdAt) > 55 * 60000) throw new Error('Export exceeded the safe readTime window; incomplete files must not be used.');
    for await (const document of client.documents(queue[index], readTime)) {
      const path = client.path(document);
      if (document.updateTime) {
        if (++documents > maximumDocuments) throw new Error('Export document budget exceeded; incomplete files must not be used.');
        const line = `${JSON.stringify({ ...document, fields: document.fields || {} })}\n`;
        writeFileSync(documentFile, line, { flag: 'a', mode: 0o600 }); digest.update(line);
      } else missingParents++;
      for (const collection of await client.collections(path, readTime)) queue.push(`${path}/${collection}`);
    }
  }
  const users = await client.users(), authData = { users };
  writePrivate(resolve(destination, 'auth.json'), authData);
  const manifest: BackupManifest = { schema: 'kilog-backup-v1', projectId: client.target.projectId, database: '(default)', createdAt, completedAt: new Date().toISOString(),
    readTime: readTime || null, consistency: client.emulator ? 'emulator-sequential' : 'readTime', documents, missingParents, rootCollections,
    authUsers: users.length, documentHash: digest.digest('hex'), authHash: hash(JSON.stringify(authData)) };
  writePrivate(resolve(destination, 'manifest.json'), manifest);
  verifyDirectory(destination);
  return { directory: destination, manifest };
}

export async function readBackup(directory: string, client: OperationsClient, selected?: string[]) {
  verifyDirectory(directory);
  for (const file of ['manifest.json', 'documents.ndjson', 'auth.json']) if (lstatSync(resolve(directory, file)).isSymbolicLink()) throw new Error('Backup files cannot be symlinks.');
  const manifest: BackupManifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
  if (manifest.schema !== 'kilog-backup-v1' || manifest.projectId !== client.target.projectId || manifest.database !== '(default)') throw new Error('Invalid backup manifest or target project.');
  const documents = new Map<string, RawDocument>(), seen = new Set<string>(), selection = selected ? new Set(selected) : null, digest = createHash('sha256');
  const lines = createInterface({ input: createReadStream(resolve(directory, 'documents.ndjson')), crlfDelay: Infinity });
  for await (const line of lines) {
    digest.update(`${line}\n`); const document: RawDocument = JSON.parse(line), path = client.path(document);
    if (!document.updateTime || seen.has(path)) throw new Error('Invalid or duplicate snapshot document.');
    seen.add(path); if (!selection || selection.has(path)) documents.set(path, document);
  }
  const auth = JSON.parse(readFileSync(resolve(directory, 'auth.json'), 'utf8')) as { users: AuthUser[] };
  if (seen.size !== manifest.documents || digest.digest('hex') !== manifest.documentHash || hash(JSON.stringify(auth)) !== manifest.authHash || auth.users.length !== manifest.authUsers) throw new Error('Backup integrity check failed.');
  return { manifest, documents, users: auth.users, backupHash: hash(canonical(manifest)) };
}

function eligibleUsers(users: AuthUser[]) {
  return users.filter(user => {
    let claims: Record<string, unknown> = {}; try { claims = JSON.parse(user.customAttributes || '{}'); } catch { return false; }
    return uid(user.localId) && user.emailVerified === true && user.disabled !== true && (claims?.admin === true || claims?.role === 'admin');
  });
}
function roleChanges(client: OperationsClient, plan: OperationPlan, admins: string[], registry: RawDocument | null) {
  const changeId = `ops_${randomUUID()}`, actor = admins[0], previous = registry?.fields;
  const previousAdmins = (previous?.adminUids as { arrayValue?: { values?: { stringValue?: string }[] } } | undefined)?.arrayValue?.values?.map(value => value.stringValue!);
  if (registry && (!previousAdmins?.length || previousAdmins.length > 32 || new Set(previousAdmins).size !== previousAdmins.length || previousAdmins.some(value => !uid(value)) || !uid((previous?.bootstrapUid as { stringValue?: unknown })?.stringValue) || typeof (previous?.initializedAt as { timestampValue?: unknown })?.timestampValue !== 'string')) throw new Error('Existing registry requires manual schema repair before recovery.');
  const nextAdmins = [...new Set([...(previousAdmins || []), ...admins])];
  if (nextAdmins.length > 32 || !admins.length) throw new Error('Registry must contain 1..32 explicit verified UIDs.');
  const oldVersion = previous ? Number((previous.version as { integerValue?: string })?.integerValue) : 0;
  if (!Number.isSafeInteger(oldVersion) || oldVersion < 0 || previous && oldVersion < 1) throw new Error('Registry version is invalid.');
  plan.changes.push({ path: 'system/authorization', before: registry, fields: { adminUids: { arrayValue: { values: nextAdmins.map(string) } },
    bootstrapUid: previous?.bootstrapUid || string(actor), initializedAt: previous?.initializedAt || timestamp(plan.createdAt), version: number(oldVersion + 1), lastChangeId: string(changeId) } });
  for (const [index, target] of admins.entries()) {
    const id = index ? `ops_${randomUUID()}` : changeId;
    plan.changes.push({ path: `accountAccess/${target}`, before: null, fields: { blocked: { booleanValue: false }, updatedAt: timestamp(plan.createdAt), updatedBy: string(actor), changeId: string(id) } },
      { path: `memberships/${target}`, before: null, fields: { companyId: { nullValue: null }, active: { booleanValue: false }, version: number(1), updatedAt: timestamp(plan.createdAt), updatedBy: string(actor), changeId: string(id) } },
      { path: `accessAudit/${id}`, before: null, fields: { actorUid: string(actor), targetUid: string(target), action: string(registry || index ? 'role' : 'bootstrap'), role: string('admin'), companyId: { nullValue: null }, blocked: { booleanValue: false }, createdAt: timestamp(plan.createdAt), registryVersion: number(oldVersion + 1) } });
  }
}
export async function prepareMigration(client: OperationsClient, directory: string) {
  const backup = await readBackup(directory, client, []);
  const plan: OperationPlan = { schema: 'kilog-operation-v1', kind: 'migrate-roles', projectId: client.target.projectId, backupHash: backup.backupHash, createdAt: new Date().toISOString(), changes: [], skipped: [] };
  const registry = await client.get('system/authorization');
  if (registry) { plan.skipped.push({ path: 'system/authorization', reason: 'Existing registry is authoritative; no automatic merge.' }); return plan; }
  const current = new Map(eligibleUsers(await client.users()).map(user => [user.localId, user]));
  const admins = eligibleUsers(backup.users).map(user => user.localId).filter(value => current.has(value)).sort();
  if (!admins.length) { plan.skipped.push({ path: 'system/authorization', reason: 'No enabled, verified legacy admin UID; owner bootstrap remains available.' }); return plan; }
  if (new Set(admins).size !== admins.length || admins.length > 32) throw new Error('Legacy administrator UID set requires manual review.');
  roleChanges(client, plan, admins, null);
  for (const admin of admins) if (await client.get(`accountDeletion/${admin}`)) throw new Error('A legacy administrator is being deleted; migration requires manual review.');
  for (const change of plan.changes) if (await client.get(change.path)) throw new Error('New role data appeared; take a fresh backup and review instead of overwriting it.');
  return plan;
}
export async function prepareAdminRecovery(client: OperationsClient, directory: string, adminUid: string) {
  if (!uid(adminUid)) throw new Error('An explicit valid Auth UID is required.');
  const backup = await readBackup(directory, client, []), users = await client.users();
  const user = users.find(value => value.localId === adminUid);
  if (!user || user.emailVerified !== true || user.disabled === true) throw new Error('Recovery UID must be an existing, enabled, verified Auth account.');
  if (await client.get(`accountDeletion/${adminUid}`)) throw new Error('Recovery UID is being deleted; select another explicitly verified Auth UID.');
  const registry = await client.get('system/authorization');
  const plan: OperationPlan = { schema: 'kilog-operation-v1', kind: 'recover-admin', projectId: client.target.projectId, backupHash: backup.backupHash, createdAt: new Date().toISOString(), changes: [], skipped: [] };
  roleChanges(client, plan, [adminUid], registry);
  for (const change of plan.changes.filter(value => value.path !== 'system/authorization')) {
    change.before = await client.get(change.path);
    if (change.path.startsWith('accessAudit/') && change.before) throw new Error('Audit identifier collision.');
    if (change.path.startsWith('memberships/') && change.before) change.fields!.version = number(Number((change.before.fields?.version as { integerValue?: string })?.integerValue || 0) + 1);
  }
  return plan;
}
export async function prepareRestore(client: OperationsClient, directory: string, selected: string[], expectedDirectory?: string) {
  const backup = await readBackup(directory, client, selected), expected = expectedDirectory ? await readBackup(expectedDirectory, client, selected) : null;
  const plan: OperationPlan = { schema: 'kilog-operation-v1', kind: 'restore', projectId: client.target.projectId, backupHash: backup.backupHash, createdAt: new Date().toISOString(), changes: [], skipped: [] };
  for (const path of [...new Set(selected.map(safePath))]) {
    const original = backup.documents.get(path), current = await client.get(path), observed = expected?.documents.get(path) || null;
    if (!original) { plan.skipped.push({ path, reason: 'Not present in the selected source snapshot.' }); continue; }
    if (fieldHash(current) === fieldHash(original)) { plan.skipped.push({ path, reason: 'Already equal to the source snapshot.' }); continue; }
    if (current && (!observed || current.updateTime !== observed.updateTime || fieldHash(current) !== fieldHash(observed))) { plan.skipped.push({ path, reason: 'Current data differs from the explicitly expected snapshot; fresh changes preserved.' }); continue; }
    plan.changes.push({ path, before: current, fields: original.fields || {} });
  }
  return plan;
}
export function savePlan(directory: string, plan: OperationPlan) {
  const path = resolve(directory, `plan-${plan.kind}-${randomUUID()}.json`); writePrivate(path, plan); return { path, hash: planHash(plan) };
}
export async function applyPlan(client: OperationsClient, plan: OperationPlan, approval: string, journalFile: string) {
  verifyDirectory(dirname(journalFile)); privateLocation(journalFile);
  if (plan.schema !== 'kilog-operation-v1' || plan.projectId !== client.target.projectId || approval !== planHash(plan)) throw new Error('The exact reviewed plan hash and target project are required.');
  if (plan.changes.length === 0) return { changed: 0, state: 'no-op' };
  if (new Set(plan.changes.map(change => change.path)).size !== plan.changes.length) throw new Error('Plan has duplicate document paths.');
  if (plan.changes.some(change => change.fields === null)) throw new Error('Apply only writes reviewed snapshot fields; deletions are limited to guarded rollback.');
  if (!['migrate-roles', 'recover-admin', 'restore'].includes(plan.kind) || plan.changes.some(change => change.before && change.before.name !== client.resource(change.path))) throw new Error('Invalid operation kind or snapshot identity.');
  if (plan.kind !== 'restore' && plan.changes.some(change => !/^(system\/authorization|accountAccess\/[^/]+|memberships\/[^/]+|accessAudit\/[^/]+)$/.test(change.path) || change.fields === null)) throw new Error('Role operations may only update canonical authorization documents.');
  if (plan.kind !== 'restore') {
    const users = await client.users();
    for (const change of plan.changes.filter(value => value.path.startsWith('accountAccess/'))) {
      const user = users.find(value => value.localId === change.path.slice('accountAccess/'.length));
      if (!user || user.emailVerified !== true || user.disabled === true || plan.kind === 'migrate-roles' && !eligibleUsers([user]).length) throw new Error('Auth eligibility changed since plan review; no writes performed.');
      if (await client.get(`accountDeletion/${user.localId}`)) throw new Error('Auth account is being deleted; no recovery writes performed.');
    }
  }
  const journal: Journal = { schema: 'kilog-journal-v1', projectId: plan.projectId, planHash: approval, changes: plan.changes, after: [], state: 'prepared' };
  if (existsSync(journalFile)) {
    const old: Journal = JSON.parse(readFileSync(journalFile, 'utf8'));
    if (old.planHash !== approval || old.projectId !== plan.projectId) throw new Error('Journal belongs to another reviewed plan.');
    if (old.state === 'committed' || old.state === 'rolled-back') return { changed: 0, state: old.state };
  } else writePrivate(journalFile, journal);
  // A prepared journal has no trusted post-commit timestamps. Never absorb newer equal data.
  const current = await Promise.all(plan.changes.map(change => client.get(change.path)));
  if (!current.every((document, index) => document?.updateTime === plan.changes[index].before?.updateTime && fieldHash(document) === fieldHash(plan.changes[index].before))) throw new Error('Current data differs from the reviewed preconditions; an unsealed journal requires manual review.');
  const receipts = await client.commit(plan.changes);
  journal.after = await Promise.all(plan.changes.map(change => client.get(change.path)));
  if (receipts.length !== journal.after.length || journal.after.some((document, index) => !document || !receipts[index].updateTime || document.updateTime !== receipts[index].updateTime)) throw new Error('Commit finished, but newer data appeared before journal sealing; the prepared journal requires manual review.');
  journal.state = 'committed';
  writePrivate(journalFile, journal, true);
  return { changed: plan.changes.length, state: journal.state };
}
export async function rollback(client: OperationsClient, journalFile: string, approval: string) {
  verifyDirectory(dirname(journalFile));
  const journal: Journal = JSON.parse(readFileSync(journalFile, 'utf8'));
  if (journal.schema !== 'kilog-journal-v1' || journal.projectId !== client.target.projectId || journal.planHash !== approval || journal.state === 'prepared') throw new Error('A sealed journal and exact reviewed plan hash are required for rollback.');
  if (journal.state === 'rolled-back') return { changed: 0, conflicts: 0 };
  const changes: Change[] = [];
  for (let index = 0; index < journal.changes.length; index++) {
    const original = journal.changes[index], after = journal.after[index], current = await client.get(original.path);
    if (!after || !current || current.updateTime !== after.updateTime || fieldHash(current) !== fieldHash(after)) return { changed: 0, conflicts: 1 };
    changes.push({ path: original.path, before: current, fields: original.before ? original.before.fields || {} : null });
  }
  await client.commit(changes); journal.state = 'rolled-back'; writePrivate(journalFile, journal, true);
  return { changed: changes.length, conflicts: 0 };
}

async function main() {
  const [command, ...input] = process.argv.slice(2), options = new Map<string, string>();
  for (let index = 0; index < input.length; index += 2) {
    if (!input[index].startsWith('--') || !input[index + 1] || options.has(input[index])) throw new Error('Use unique --option value pairs.');
    options.set(input[index], input[index + 1]);
  }
  const allowed = ['--project', '--firestore-emulator', '--auth-emulator', '--directory', '--budget', '--plan', '--approve', '--journal', '--uid', '--select', '--expected'];
  if ([...options.keys()].some(key => !allowed.includes(key))) throw new Error('Unknown operation option.');
  if (!['export', 'dry-run', 'recover-admin', 'restore-preview', 'apply', 'rollback'].includes(command)) throw new Error('Commands: export, dry-run, recover-admin, restore-preview, apply, rollback. All require --project. apply/rollback require the exact --approve plan hash.');
  const projectId = options.get('--project') || '', client = createOperationsClient({ projectId, firestoreOrigin: options.get('--firestore-emulator'), authOrigin: options.get('--auth-emulator') });
  const directory = options.get('--directory');
  if (command === 'export') {
    const result = await exportBackup(client, directory, Number(options.get('--budget') || 20000));
    console.log(JSON.stringify({ directory: result.directory, documents: result.manifest.documents, authUsers: result.manifest.authUsers, legacyAdmins: eligibleUsers((await readBackup(result.directory, client, [])).users).length })); return;
  }
  if (command === 'apply' || command === 'rollback') {
    const journal = options.get('--journal'); if (!journal) throw new Error('An explicit protected --journal path is required.');
    if (command === 'rollback') { console.log(JSON.stringify(await rollback(client, journal, options.get('--approve') || ''))); return; }
    const file = options.get('--plan'); if (!file) throw new Error('An explicit protected --plan file is required.');
    verifyDirectory(dirname(file)); const plan: OperationPlan = JSON.parse(readFileSync(file, 'utf8'));
    console.log(JSON.stringify(await applyPlan(client, plan, options.get('--approve') || '', journal))); return;
  }
  if (!directory) throw new Error('A completed protected --directory backup is required.');
  const plan = command === 'dry-run' ? await prepareMigration(client, directory) : command === 'recover-admin' ? await prepareAdminRecovery(client, directory, options.get('--uid') || '') : await prepareRestore(client, directory, (options.get('--select') || '').split(',').filter(Boolean), options.get('--expected'));
  console.log(JSON.stringify({ ...savePlan(directory, plan), kind: plan.kind, writes: plan.changes.length, skipped: plan.skipped.length }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Operation failed safely. Check the project, protected backup, reviewed plan hash, CLI access, and remaining quota. Credentials and private data were not logged.'); process.exitCode = 1; });
