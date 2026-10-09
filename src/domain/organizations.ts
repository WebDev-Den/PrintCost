import type { Timestamp } from 'firebase/firestore';

export type Role = 'user' | 'manager' | 'admin';
export interface AccessState { role: Role; companyId: string | null; blocked: boolean }
export interface DirectoryUser {
  uid: string; email: string; displayName: string; verified: boolean; updatedAt: Timestamp;
}
export interface Company {
  id: string; name: string; website: string; allowedDomains: string[]; status: 'active' | 'disabled';
  version: number; createdBy: string; createdAt: Timestamp; updatedAt: Timestamp; updatedBy: string; changeId: string;
}
export interface AccessAudit {
  actorUid: string; targetUid: string; action: 'bootstrap' | 'role' | 'block' | 'company' | 'delete';
  role: Role; companyId: string | null; blocked: boolean; createdAt: Timestamp; registryVersion: number;
}
export const BOOTSTRAP_EMAIL = 'web.developer.den@gmail.com';

export function deriveAccess(uid: string, verified: boolean, adminUids: string[], blocked: boolean,
  membership?: { active: boolean; companyId: string | null }, companyActive = true): AccessState {
  if (blocked || !verified) return { role: 'user', companyId: null, blocked };
  if (adminUids.includes(uid)) return { role: 'admin', companyId: null, blocked: false };
  if (membership?.active && membership.companyId && companyActive) return { role: 'manager', companyId: membership.companyId, blocked: false };
  return { role: 'user', companyId: null, blocked: false };
}

export function nextAdminUids(current: string[], targetUid: string, role: Role, blocked = false) {
  const next = current.filter(uid => uid !== targetUid);
  if (role === 'admin' && !blocked) next.push(targetUid);
  if (!next.length) throw new Error('Спершу призначте іншого адміністратора. Останнього адміністратора не можна позбавити доступу.');
  if (next.length > 32) throw new Error('Можна призначити до 32 адміністраторів.');
  return next;
}

export function validateCompany(input: Pick<Company, 'name' | 'website' | 'allowedDomains' | 'status'>) {
  const name = input.name.trim();
  if (!name || name.length > 200) throw new Error('Назва компанії має містити від 1 до 200 символів.');
  let url: URL;
  try { url = new URL(input.website); } catch { throw new Error('Вкажіть повну HTTPS-адресу сайту компанії.'); }
  if (url.protocol !== 'https:' || url.username || url.password || input.website.length > 2000) throw new Error('Сайт компанії має бути HTTPS-адресою без облікових даних.');
  const allowedDomains = [...new Set(input.allowedDomains.map(domain => domain.trim().toLowerCase()))];
  if (!allowedDomains.length || allowedDomains.length > 10 || allowedDomains.some(domain => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || domain.length > 253)) throw new Error('Вкажіть від 1 до 10 доменів магазинів без протоколу та шляху.');
  if (!['active', 'disabled'].includes(input.status)) throw new Error('Некоректний стан компанії.');
  return { name, website: url.href, allowedDomains, status: input.status };
}
